# CKS 모의 실기 문제

> CKS(Certified Kubernetes Security Specialist) 시험 대비 실전 문제 40선이다.
> 각 문제는 실제 시험과 유사한 시나리오 기반으로 구성되어 있다.
> 도메인별 비율: Cluster Setup(4), Cluster Hardening(6), System Hardening(6), Minimize Microservice Vulnerabilities(8), Supply Chain Security(8), Monitoring/Logging/Runtime Security(8)

---

## Cluster Setup (10%) - 4문제

### 문제 1. [Cluster Setup] NetworkPolicy - Default Deny All

`restricted` 네임스페이스에 default deny all NetworkPolicy를 적용하라. 이 네임스페이스의 모든 Pod에 대해 Ingress와 Egress 트래픽을 모두 차단해야 한다.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
kubectl config use-context cluster1
```
```yaml
# deny-all.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: restricted
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
```
```bash
kubectl apply -f deny-all.yaml

# 검증
kubectl get networkpolicy -n restricted
kubectl describe networkpolicy default-deny-all -n restricted
```

`podSelector: {}`는 해당 네임스페이스의 모든 Pod를 선택한다. `policyTypes`에 Ingress와 Egress를 모두 지정하고, 허용 규칙을 비워두면 모든 트래픽이 차단된다.
</details>

---

### 문제 2. [Cluster Setup] NetworkPolicy - DNS 허용 및 특정 Pod 간 통신 허용

`restricted` 네임스페이스에서 `app=frontend` 라벨이 있는 Pod가 DNS(포트 53)와 `app=backend` 라벨이 있는 Pod의 포트 8080으로만 Egress 통신할 수 있도록 NetworkPolicy를 작성하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend-egress
  namespace: restricted
spec:
  podSelector:
    matchLabels:
      app: frontend
  policyTypes:
  - Egress
  egress:
  - to: []
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  - to:
    - podSelector:
        matchLabels:
          app: backend
    ports:
    - protocol: TCP
      port: 8080
```
```bash
kubectl apply -f frontend-egress.yaml

# 검증: frontend에서 backend로 통신 가능한지 확인
kubectl -n restricted exec frontend-pod -- wget -qO- --timeout=2 http://backend-svc:8080
# (성공)

# frontend에서 외부로 통신 불가 확인
kubectl -n restricted exec frontend-pod -- wget -qO- --timeout=2 http://google.com
# (실패: 타임아웃)
```

DNS 허용을 위해 `to: []`(모든 대상)에 포트 53을 지정한다. DNS를 허용하지 않으면 서비스명으로 통신할 수 없다. backend로의 통신은 `podSelector`로 대상을 지정하고 포트 8080만 허용한다.
</details>

---

### 문제 3. [Cluster Setup] CIS Benchmark - kube-bench 실행 및 수정

마스터 노드에서 kube-bench를 실행하고, 다음 항목이 FAIL이면 PASS가 되도록 수정하라:
1. `1.2.1` - anonymous-auth가 false로 설정되어야 한다
2. `1.2.18` - insecure-bind-address가 설정되어 있지 않아야 한다
3. `1.2.20` - audit-log-path가 설정되어야 한다

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. 현재 상태 확인
kube-bench run --targets master --check 1.2.1,1.2.18,1.2.20

# 2. API server 매니페스트 백업
cp /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/kube-apiserver.yaml.bak

# 3. API server 매니페스트 수정
vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

수정할 플래그들:
```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    # 수정/추가할 항목:
    - --anonymous-auth=false
    # --insecure-bind-address 라인이 있으면 삭제
    - --audit-log-path=/var/log/kubernetes/audit/audit.log
    # audit-log 관련 volume mount도 추가 필요
    volumeMounts:
    - name: audit-log
      mountPath: /var/log/kubernetes/audit/
  volumes:
  - name: audit-log
    hostPath:
      path: /var/log/kubernetes/audit/
      type: DirectoryOrCreate
```
```bash
# 4. 로그 디렉토리 생성
mkdir -p /var/log/kubernetes/audit/

# 5. API server 재시작 대기
watch crictl ps | grep kube-apiserver

# 6. 재점검
kube-bench run --targets master --check 1.2.1,1.2.18,1.2.20
# 세 항목 모두 [PASS]로 표시되어야 한다
```

`--insecure-bind-address`는 해당 줄 자체를 삭제해야 한다. `--audit-log-path`를 추가할 때는 반드시 해당 경로에 대한 hostPath volume과 volumeMount도 함께 추가해야 한다.
</details>

---

### 문제 4. [Cluster Setup] 바이너리 검증

워커 노드 `node01`에서 kubelet 바이너리의 무결성을 확인하라. 공식 릴리스의 sha512 해시값과 비교하여 바이너리가 변조되지 않았는지 검증하라. kubelet 버전은 v1.29.0이다.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. 워커 노드에 SSH 접속
ssh node01

# 2. 현재 kubelet 바이너리의 해시값 계산
sha512sum /usr/bin/kubelet

# 3. 공식 해시값 다운로드
curl -LO https://dl.k8s.io/v1.29.0/bin/linux/amd64/kubelet.sha512

# 4. 해시값 비교
echo "$(cat kubelet.sha512)  /usr/bin/kubelet" | sha512sum --check
# OK 출력 시: 무결성 확인
# FAILED 출력 시: 바이너리 변조 의심

# 만약 변조된 경우, 공식 바이너리로 교체
curl -LO https://dl.k8s.io/v1.29.0/bin/linux/amd64/kubelet
chmod +x kubelet
mv kubelet /usr/bin/kubelet
systemctl restart kubelet
```

`sha512sum --check` 명령은 파일의 해시값을 계산하여 제공된 해시값과 비교한다. 결과가 `OK`이면 무결성이 확인된 것이고, `FAILED`이면 바이너리가 변조된 것이다.
</details>

---

## Cluster Hardening (15%) - 6문제

### 문제 5. [Cluster Hardening] RBAC - 과도한 권한 축소

`production` 네임스페이스에 `dev-team` Role이 있다. 이 Role은 모든 리소스에 대해 모든 권한(`*`)을 가지고 있다. 이를 수정하여 Pod와 Service에 대한 get, list, watch 권한만 허용하고, Deployment에 대한 get, list, watch, update 권한만 허용하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 현재 Role 확인
kubectl get role dev-team -n production -o yaml
```
```yaml
# 수정된 Role
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: dev-team
  namespace: production
rules:
- apiGroups: [""]
  resources: ["pods", "services"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list", "watch", "update"]
```
```bash
kubectl apply -f dev-team-role.yaml

# 검증
kubectl auth can-i delete pods --as=system:serviceaccount:production:dev-sa -n production
# no
kubectl auth can-i get pods --as=system:serviceaccount:production:dev-sa -n production
# yes
kubectl auth can-i update deployments.apps --as=system:serviceaccount:production:dev-sa -n production
# yes
kubectl auth can-i create deployments.apps --as=system:serviceaccount:production:dev-sa -n production
# no
```

`*` 와일드카드를 제거하고 필요한 verb와 resource만 명시적으로 나열하는 것이 최소 권한 원칙이다. Deployment는 `apps` apiGroup에 속하므로 별도로 지정해야 한다.
</details>

---

### 문제 6. [Cluster Hardening] ServiceAccount 보안

`web-app` 네임스페이스에서 실행 중인 `web-pod` Pod가 default ServiceAccount를 사용하고 있다. 다음 작업을 수행하라:
1. `web-sa`라는 새 ServiceAccount를 생성하고 `automountServiceAccountToken: false`를 설정하라
2. `web-pod`가 새 ServiceAccount를 사용하도록 수정하라

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. ServiceAccount 생성
kubectl create serviceaccount web-sa -n web-app --dry-run=client -o yaml > web-sa.yaml
```
```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: web-sa
  namespace: web-app
automountServiceAccountToken: false
```
```bash
kubectl apply -f web-sa.yaml

# 2. Pod 수정 (Pod는 직접 수정 불가하므로 삭제 후 재생성)
kubectl get pod web-pod -n web-app -o yaml > web-pod.yaml
```

web-pod.yaml을 수정:
```yaml
spec:
  serviceAccountName: web-sa
  automountServiceAccountToken: false
  containers:
  - name: web
    image: nginx:1.25
```
```bash
kubectl delete pod web-pod -n web-app
kubectl apply -f web-pod.yaml

# 검증: 토큰이 마운트되지 않았는지 확인
kubectl exec web-pod -n web-app -- ls /var/run/secrets/kubernetes.io/serviceaccount/
# No such file or directory
```

ServiceAccount의 `automountServiceAccountToken: false` 설정은 해당 SA를 사용하는 모든 Pod에 적용된다. Pod 레벨에서도 설정할 수 있으며, Pod 레벨 설정이 SA 레벨 설정보다 우선한다.
</details>

---

### 문제 7. [Cluster Hardening] API Server 접근 제한

API Server의 다음 보안 설정을 수정하라:
1. 익명 인증을 비활성화하라 (`--anonymous-auth=false`)
2. 인가 모드를 `Node,RBAC`로 설정하라
3. `NodeRestriction` admission plugin을 활성화하라

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. 매니페스트 백업
cp /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/kube-apiserver.yaml.bak

# 2. 매니페스트 수정
vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

수정할 플래그:
```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    - --anonymous-auth=false
    - --authorization-mode=Node,RBAC
    - --enable-admission-plugins=NodeRestriction,PodSecurity
    # ... 기존 플래그들
```
```bash
# 3. API server 재시작 대기
watch crictl ps | grep kube-apiserver

# 4. 정상 동작 확인
kubectl get nodes

# 5. 익명 접근 차단 확인
curl -k https://localhost:6443/api/v1/namespaces
# 401 Unauthorized (익명 접근 차단됨)
```

API server 매니페스트를 수정하면 kubelet이 변경을 감지하고 자동으로 API server를 재시작한다. 재시작에 30초~1분 정도 소요될 수 있다. `watch crictl ps`로 컨테이너 상태를 모니터링하라.
</details>

---

### 문제 8. [Cluster Hardening] kubeadm 업그레이드

클러스터의 컨트롤 플레인을 v1.28.5에서 v1.29.0으로 업그레이드하라. 컨트롤 플레인 노드에서 kubeadm, kubelet, kubectl을 모두 업그레이드해야 한다.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. 업그레이드 가능 버전 확인
kubeadm upgrade plan

# 2. kubeadm 업그레이드
apt-get update
apt-cache madison kubeadm | grep 1.29
apt-get install -y kubeadm=1.29.0-1.1

# 3. kubeadm 버전 확인
kubeadm version

# 4. 컨트롤 플레인 업그레이드
kubeadm upgrade apply v1.29.0

# 5. 노드 드레인
kubectl drain controlplane --ignore-daemonsets --delete-emptydir-data

# 6. kubelet, kubectl 업그레이드
apt-get install -y kubelet=1.29.0-1.1 kubectl=1.29.0-1.1

# 7. kubelet 재시작
systemctl daemon-reload
systemctl restart kubelet

# 8. 노드 uncordon
kubectl uncordon controlplane

# 9. 버전 확인
kubectl get nodes
# controlplane이 v1.29.0으로 표시되어야 한다
```

업그레이드는 반드시 한 마이너 버전씩 수행해야 한다. 컨트롤 플레인을 먼저 업그레이드한 후 워커 노드를 업그레이드한다. 워커 노드는 `kubeadm upgrade node` 명령을 사용한다.
</details>

---

### 문제 9. [Cluster Hardening] cluster-admin ClusterRoleBinding 감사

클러스터에서 `cluster-admin` ClusterRole에 바인딩된 모든 ClusterRoleBinding을 찾아라. 시스템 컴포넌트(system:으로 시작하는 주체)를 제외하고, 불필요하게 cluster-admin 권한을 가진 사용자나 ServiceAccount를 식별하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. cluster-admin에 바인딩된 모든 ClusterRoleBinding 찾기
kubectl get clusterrolebindings -o json | \
  jq -r '.items[] | select(.roleRef.name == "cluster-admin") |
  "\(.metadata.name): \(.subjects // [] | .[] | "\(.kind)/\(.name) (ns: \(.namespace // "cluster-wide"))")"'

# 2. 시스템 컴포넌트 제외하고 확인
kubectl get clusterrolebindings -o json | \
  jq -r '.items[] | select(.roleRef.name == "cluster-admin") |
  .subjects[]? | select(.name | startswith("system:") | not) |
  "\(.kind)/\(.name)"'

# 3. 불필요한 바인딩이 발견되면 삭제
kubectl delete clusterrolebinding <suspicious-binding-name>

# 4. 또는 더 제한적인 Role로 교체
kubectl create clusterrolebinding limited-access \
  --clusterrole=view \
  --user=jane \
  --dry-run=client -o yaml | kubectl apply -f -
```

`cluster-admin`은 모든 리소스에 대한 모든 권한을 가지는 매우 강력한 ClusterRole이다. 실제 운영 환경에서는 극소수의 관리자만 이 권한을 가져야 하며, 정기적으로 감사해야 한다.
</details>

---

### 문제 10. [Cluster Hardening] kubeconfig 보안

워커 노드 `node01`에서 `/root/.kube/config`에 저장된 kubeconfig 파일의 보안 문제를 해결하라:
1. 파일 권한을 소유자만 읽기/쓰기할 수 있도록 제한하라
2. 불필요한 context `old-cluster`를 제거하라

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. SSH 접속
ssh node01

# 2. 파일 권한 확인 및 수정
ls -la /root/.kube/config
# 644 또는 그보다 느슨한 권한이면 수정 필요

chmod 600 /root/.kube/config
ls -la /root/.kube/config
# -rw------- 확인

# 3. 불필요한 context 확인
kubectl config get-contexts --kubeconfig=/root/.kube/config

# 4. old-cluster context 삭제
kubectl config delete-context old-cluster --kubeconfig=/root/.kube/config

# 5. 관련 cluster/user 정보도 삭제
kubectl config delete-cluster old-cluster --kubeconfig=/root/.kube/config
kubectl config delete-user old-cluster-admin --kubeconfig=/root/.kube/config

# 6. 최종 확인
kubectl config get-contexts --kubeconfig=/root/.kube/config
```

kubeconfig 파일에는 클러스터 접근 자격 증명(인증서, 토큰 등)이 포함되어 있으므로, 파일 권한을 600(소유자만 읽기/쓰기)으로 설정해야 한다. 불필요한 context는 공격 표면을 줄이기 위해 제거해야 한다.
</details>

---

## System Hardening (15%) - 6문제

### 문제 11. [System Hardening] AppArmor 프로파일 적용

다음 AppArmor 프로파일을 `node01`에 로드하고, `secure-ns` 네임스페이스의 `nginx-pod` Pod에 적용하라. 프로파일은 모든 파일 쓰기를 거부하되 `/tmp`에만 쓰기를 허용해야 한다.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. node01에 SSH 접속하여 AppArmor 프로파일 생성
ssh node01
cat > /etc/apparmor.d/k8s-deny-write << 'EOF'
#include <tunables/global>

profile k8s-deny-write flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>

  file,

  deny /** w,
  /tmp/** rw,
}
EOF

# 2. 프로파일 로드
apparmor_parser -r /etc/apparmor.d/k8s-deny-write

# 3. 프로파일 확인
aa-status | grep k8s-deny-write

# 4. exit하여 컨트롤 플레인으로 돌아감
exit
```

Pod 정의 (annotation 방식, K8s 1.29 이하):
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx-pod
  namespace: secure-ns
  annotations:
    container.apparmor.security.beta.kubernetes.io/nginx: localhost/k8s-deny-write
spec:
  nodeName: node01  # AppArmor 프로파일이 로드된 노드에 스케줄링
  containers:
  - name: nginx
    image: nginx:1.25
    volumeMounts:
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: tmp
    emptyDir: {}
```

Pod 정의 (securityContext 방식, K8s 1.30+):
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx-pod
  namespace: secure-ns
spec:
  nodeName: node01
  containers:
  - name: nginx
    image: nginx:1.25
    securityContext:
      appArmorProfile:
        type: Localhost
        localhostProfile: k8s-deny-write
    volumeMounts:
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: tmp
    emptyDir: {}
```
```bash
kubectl apply -f nginx-pod.yaml

# 검증
kubectl exec nginx-pod -n secure-ns -- touch /root/test.txt
# Permission denied

kubectl exec nginx-pod -n secure-ns -- touch /tmp/test.txt
# (성공)
```

AppArmor 프로파일은 Pod가 스케줄링되는 노드에 미리 로드되어 있어야 한다. annotation의 컨테이너 이름(`nginx`)이 Pod spec의 컨테이너 이름과 정확히 일치해야 한다.
</details>

---

### 문제 12. [System Hardening] seccomp 프로파일 적용

`node01`의 `/var/lib/kubelet/seccomp/profiles/` 디렉토리에 커스텀 seccomp 프로파일을 생성하라. 이 프로파일은 `mkdir`과 `chmod` 시스템콜을 차단해야 한다. 그리고 `secure-pod`에 이 프로파일을 적용하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. node01에 SSH 접속
ssh node01

# 2. seccomp 프로파일 디렉토리 확인/생성
mkdir -p /var/lib/kubelet/seccomp/profiles

# 3. 커스텀 프로파일 생성
cat > /var/lib/kubelet/seccomp/profiles/no-mkdir-chmod.json << 'EOF'
{
  "defaultAction": "SCMP_ACT_ALLOW",
  "syscalls": [
    {
      "names": ["mkdir", "mkdirat", "chmod", "fchmod", "fchmodat"],
      "action": "SCMP_ACT_ERRNO",
      "errnoRet": 1
    }
  ]
}
EOF

# 4. exit하여 컨트롤 플레인으로 돌아감
exit
```
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
  namespace: default
spec:
  nodeName: node01
  securityContext:
    seccompProfile:
      type: Localhost
      localhostProfile: profiles/no-mkdir-chmod.json
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      allowPrivilegeEscalation: false
```
```bash
kubectl apply -f secure-pod.yaml

# 검증
kubectl exec secure-pod -- mkdir /tmp/testdir
# mkdir: cannot create directory '/tmp/testdir': Operation not permitted

kubectl exec secure-pod -- chmod 777 /tmp
# chmod: changing permissions of '/tmp': Operation not permitted

# 다른 작업은 정상 동작
kubectl exec secure-pod -- ls /
# (성공)
```

`defaultAction: SCMP_ACT_ALLOW`로 설정하면 기본적으로 모든 시스템콜을 허용하고, 명시적으로 차단할 시스템콜만 `SCMP_ACT_ERRNO`로 지정한다. `localhostProfile`의 경로는 `/var/lib/kubelet/seccomp/` 기준 상대 경로이다.
</details>

---

### 문제 13. [System Hardening] RuntimeDefault seccomp 적용

`production` 네임스페이스의 모든 Pod가 RuntimeDefault seccomp 프로파일을 사용하도록 Pod Security Admission을 설정하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 네임스페이스에 restricted 레벨 적용 (seccomp 필수)
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/warn=restricted \
  --overwrite
```

Restricted 레벨을 적용하면 seccomp 프로파일이 `RuntimeDefault` 또는 `Localhost`로 설정되지 않은 Pod는 생성이 거부된다.

```bash
# 검증: seccomp 미설정 Pod 생성 시도
kubectl run test --image=nginx -n production
# Error: violates PodSecurity "restricted:latest": ...
# seccompProfile.type must be "RuntimeDefault" or "Localhost"

# Restricted 준수 Pod
kubectl apply -f - << 'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: compliant-pod
  namespace: production
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
      runAsUser: 1000
      capabilities:
        drop: ["ALL"]
EOF
# (성공)
```

Pod Security Admission의 `restricted` 레벨은 seccomp 프로파일 설정을 필수로 요구한다. 이는 `RuntimeDefault`(컨테이너 런타임 기본 프로파일) 또는 `Localhost`(커스텀 프로파일)를 사용해야 한다는 의미이다.
</details>

---

### 문제 14. [System Hardening] 불필요한 서비스 비활성화

워커 노드 `node01`에서 보안 점검을 수행하라:
1. 실행 중인 서비스 목록을 확인하고, `rpcbind` 서비스가 실행 중이면 중지하고 비활성화하라
2. 열려 있는 포트를 확인하고, 포트 8888에서 리스닝 중인 프로세스를 찾아 종료하라

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. node01에 SSH 접속
ssh node01

# 2. rpcbind 서비스 상태 확인
systemctl status rpcbind

# 3. rpcbind 서비스 중지 및 비활성화
systemctl stop rpcbind
systemctl disable rpcbind

# 4. 확인
systemctl is-active rpcbind
# inactive
systemctl is-enabled rpcbind
# disabled

# 5. 열려 있는 포트 확인
ss -tlnp | grep 8888
# 또는
netstat -tlnp | grep 8888

# 6. 해당 포트에서 리스닝 중인 프로세스 PID 확인
ss -tlnp | grep 8888
# 출력 예: LISTEN 0 128 *:8888 *:* users:(("suspicious-proc",pid=12345,fd=3))

# 7. 프로세스 종료
kill -9 12345

# 8. 확인
ss -tlnp | grep 8888
# (출력 없음)
```

불필요한 서비스를 비활성화하는 것은 공격 표면을 줄이는 기본적인 보안 원칙이다. `systemctl disable`은 부팅 시 자동 시작을 방지하고, `systemctl stop`은 현재 실행 중인 서비스를 즉시 중지한다.
</details>

---

### 문제 15. [System Hardening] AppArmor - complain 모드에서 enforce 모드로 전환

`node01`에 `docker-default` AppArmor 프로파일이 complain 모드로 로드되어 있다. 이를 enforce 모드로 전환하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. node01에 SSH 접속
ssh node01

# 2. 현재 프로파일 상태 확인
aa-status
# docker-default (complain)

# 3. enforce 모드로 전환
aa-enforce /etc/apparmor.d/docker-default
# 또는
apparmor_parser -r /etc/apparmor.d/docker-default

# 4. 확인
aa-status | grep docker-default
# docker-default (enforce)
```

`complain` 모드는 정책 위반을 로그로 기록하기만 하고 차단하지 않는다. `enforce` 모드는 정책 위반 시 실제로 차단한다. 프로덕션 환경에서는 반드시 enforce 모드를 사용해야 한다.
</details>

---

### 문제 16. [System Hardening] kubelet 보안 설정

워커 노드 `node01`의 kubelet 설정을 강화하라:
1. 익명 인증을 비활성화하라
2. authorization 모드를 Webhook으로 설정하라
3. readOnlyPort를 비활성화하라 (0으로 설정)

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. node01에 SSH 접속
ssh node01

# 2. kubelet 설정 파일 백업
cp /var/lib/kubelet/config.yaml /var/lib/kubelet/config.yaml.bak

# 3. kubelet 설정 수정
vi /var/lib/kubelet/config.yaml
```

수정할 항목:
```yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
authentication:
  anonymous:
    enabled: false      # 익명 인증 비활성화
  webhook:
    enabled: true
authorization:
  mode: Webhook          # Webhook 인가 모드
readOnlyPort: 0          # 읽기 전용 포트 비활성화
```
```bash
# 4. kubelet 재시작
systemctl restart kubelet

# 5. kubelet 상태 확인
systemctl status kubelet

# 6. 익명 접근 차단 확인
curl -k https://localhost:10250/pods
# 401 Unauthorized

# 7. 읽기 전용 포트 차단 확인
curl http://localhost:10255/pods
# Connection refused (포트가 열리지 않음)
```

kubelet의 `readOnlyPort: 0`은 인증 없이 접근 가능한 10255 포트를 비활성화한다. `authentication.anonymous.enabled: false`는 인증되지 않은 요청을 거부한다. `authorization.mode: Webhook`은 API server에 인가를 위임한다.
</details>

---

## Minimize Microservice Vulnerabilities (20%) - 8문제

### 문제 17. [Microservice Vulnerabilities] Pod Security Admission - Baseline 적용

`staging` 네임스페이스에 Pod Security Admission을 적용하라:
- enforce 모드: baseline 레벨
- warn 모드: restricted 레벨
- audit 모드: restricted 레벨

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
kubectl label namespace staging \
  pod-security.kubernetes.io/enforce=baseline \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/warn-version=latest \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/audit-version=latest \
  --overwrite

# 검증
kubectl get namespace staging --show-labels

# 테스트: privileged Pod (baseline 위반, 거부됨)
kubectl run test --image=nginx -n staging --overrides='{
  "spec": {
    "containers": [{
      "name": "test",
      "image": "nginx",
      "securityContext": {"privileged": true}
    }]
  }
}'
# Error from server (Forbidden): ... violates PodSecurity "baseline:latest"

# 테스트: 일반 Pod (baseline 통과, restricted 경고)
kubectl run test --image=nginx -n staging
# Warning: would violate PodSecurity "restricted:latest": ...
# pod/test created (baseline은 통과하므로 생성됨, restricted 경고만 표시)
```

이 구성은 점진적 보안 강화 전략이다. baseline을 강제하여 명백한 보안 위반을 차단하고, restricted를 warn/audit으로 설정하여 추후 restricted로 전환할 때 영향 받는 워크로드를 사전에 파악할 수 있다.
</details>

---

### 문제 18. [Microservice Vulnerabilities] OPA Gatekeeper - 필수 라벨 정책

OPA Gatekeeper를 사용하여, 모든 Deployment에 `app` 라벨과 `team` 라벨이 반드시 포함되도록 하는 정책을 작성하고 적용하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```yaml
# ConstraintTemplate
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

      violation[{"msg": msg, "details": {"missing_labels": missing}}] {
        provided := {label | input.review.object.metadata.labels[label]}
        required := {label | label := input.parameters.labels[_]}
        missing := required - provided
        count(missing) > 0
        msg := sprintf("필수 라벨이 누락되었습니다: %v", [missing])
      }
---
# Constraint
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
  name: deployment-required-labels
spec:
  match:
    kinds:
    - apiGroups: ["apps"]
      kinds: ["Deployment"]
  parameters:
    labels:
    - "app"
    - "team"
```
```bash
kubectl apply -f constrainttemplate.yaml
kubectl apply -f constraint.yaml

# ConstraintTemplate이 준비될 때까지 잠시 대기
kubectl get constrainttemplate k8srequiredlabels

# 검증: 필수 라벨 없는 Deployment 생성 시도
kubectl create deployment test --image=nginx
# Error: 필수 라벨이 누락되었습니다: {"app", "team"}
# (app 라벨은 create deployment에서 자동 추가되므로 team만 누락될 수 있음)

# 올바른 Deployment
kubectl create deployment test --image=nginx --dry-run=client -o yaml | \
  kubectl label --local -f - team=backend -o yaml | \
  kubectl apply -f -
```

ConstraintTemplate은 Rego 코드로 정책 로직을 정의하고, Constraint는 해당 템플릿을 기반으로 구체적인 파라미터와 적용 범위를 지정한다. `input.review.object`가 검사 대상 쿠버네티스 리소스를 나타낸다.
</details>

---

### 문제 19. [Microservice Vulnerabilities] OPA Gatekeeper - 허용 레지스트리 제한

OPA Gatekeeper를 사용하여, Pod에서 사용하는 컨테이너 이미지가 `docker.io/library/`와 `gcr.io/company/` 레지스트리에서만 가져올 수 있도록 제한하는 정책을 작성하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8sallowedrepos
spec:
  crd:
    spec:
      names:
        kind: K8sAllowedRepos
      validation:
        openAPIV3Schema:
          type: object
          properties:
            repos:
              type: array
              items:
                type: string
  targets:
  - target: admission.k8s.gatekeeper.sh
    rego: |
      package k8sallowedrepos

      violation[{"msg": msg}] {
        container := input.review.object.spec.containers[_]
        satisfied := [good | repo = input.parameters.repos[_]; good = startswith(container.image, repo)]
        not any(satisfied)
        msg := sprintf("이미지 '%v'는 허용된 레지스트리에 속하지 않습니다. 허용: %v", [container.image, input.parameters.repos])
      }

      violation[{"msg": msg}] {
        container := input.review.object.spec.initContainers[_]
        satisfied := [good | repo = input.parameters.repos[_]; good = startswith(container.image, repo)]
        not any(satisfied)
        msg := sprintf("initContainer 이미지 '%v'는 허용된 레지스트리에 속하지 않습니다. 허용: %v", [container.image, input.parameters.repos])
      }
---
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sAllowedRepos
metadata:
  name: allowed-repos-only
spec:
  match:
    kinds:
    - apiGroups: [""]
      kinds: ["Pod"]
  parameters:
    repos:
    - "docker.io/library/"
    - "gcr.io/company/"
```
```bash
kubectl apply -f allowed-repos.yaml

# 검증
kubectl run test --image=quay.io/malicious/app
# Error: 이미지 'quay.io/malicious/app'는 허용된 레지스트리에 속하지 않습니다

kubectl run test --image=docker.io/library/nginx:1.25
# (성공)
```

initContainers도 반드시 검사해야 한다. 공격자가 initContainer에 악성 이미지를 넣어 우회할 수 있기 때문이다.
</details>

---

### 문제 20. [Microservice Vulnerabilities] Secret 암호화 (Encryption at Rest)

etcd에 저장되는 Secret을 aescbc 방식으로 암호화하도록 설정하라. 설정 후 기존 Secret을 재암호화하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. 암호화 키 생성
head -c 32 /dev/urandom | base64
# 출력 예: aTU0RnE1aEpzMWRRYnhZdDhLUjdYS2JkTXRPeGprWno=

# 2. EncryptionConfiguration 파일 생성
cat > /etc/kubernetes/encryption-config.yaml << 'EOF'
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
    - secrets
    providers:
    - aescbc:
        keys:
        - name: key1
          secret: aTU0RnE1aEpzMWRRYnhZdDhLUjdYS2JkTXRPeGprWno=
    - identity: {}
EOF

# 3. API server 매니페스트 백업
cp /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/kube-apiserver.yaml.bak

# 4. API server 매니페스트 수정
vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

추가할 내용:
```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    - --encryption-provider-config=/etc/kubernetes/encryption-config.yaml
    volumeMounts:
    - name: encryption-config
      mountPath: /etc/kubernetes/encryption-config.yaml
      readOnly: true
  volumes:
  - name: encryption-config
    hostPath:
      path: /etc/kubernetes/encryption-config.yaml
      type: File
```
```bash
# 5. API server 재시작 대기
watch crictl ps | grep kube-apiserver

# 6. 기존 Secret 재암호화
kubectl get secrets --all-namespaces -o json | kubectl replace -f -

# 7. 암호화 확인
ETCDCTL_API=3 etcdctl \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/default/my-secret | hexdump -C
# k8s:enc:aescbc:v1:key1 접두어가 보이면 암호화 성공
```

`identity: {}`를 providers 목록의 마지막에 두면 기존 암호화되지 않은 Secret을 읽을 수 있다. 첫 번째 provider(aescbc)가 새로 저장되는 Secret에 사용된다.
</details>

---

### 문제 21. [Microservice Vulnerabilities] RuntimeClass 생성 및 적용

gVisor(runsc) RuntimeClass를 생성하고, `sandboxed` 네임스페이스의 Pod에 적용하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```yaml
# RuntimeClass 생성
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
---
# Pod에서 사용
apiVersion: v1
kind: Pod
metadata:
  name: sandboxed-pod
  namespace: sandboxed
spec:
  runtimeClassName: gvisor
  containers:
  - name: app
    image: nginx:1.25
    ports:
    - containerPort: 80
```
```bash
kubectl apply -f runtimeclass.yaml
kubectl apply -f sandboxed-pod.yaml

# 검증
kubectl get runtimeclass
kubectl get pod sandboxed-pod -n sandboxed

# gVisor 런타임으로 실행되는지 확인
kubectl exec sandboxed-pod -n sandboxed -- dmesg | head -5
# "Starting gVisor" 관련 메시지가 출력되면 성공
```

RuntimeClass의 `handler` 필드는 containerd 설정(`/etc/containerd/config.toml`)에 정의된 런타임 핸들러 이름과 일치해야 한다. 해당 노드에 gVisor가 설치되어 있지 않으면 Pod가 생성되지 않는다.
</details>

---

### 문제 22. [Microservice Vulnerabilities] 컨테이너 보안 컨텍스트 강화

다음 보안 요구사항을 모두 충족하는 Pod를 생성하라:
1. non-root 사용자로 실행 (UID: 1000)
2. 권한 상승 비활성화
3. 읽기 전용 루트 파일시스템
4. 모든 Linux capabilities drop
5. RuntimeDefault seccomp 프로파일 적용

<details>
<summary>풀이 확인</summary>

**풀이:**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hardened-pod
  namespace: default
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 3000
    fsGroup: 2000
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
    volumeMounts:
    - name: tmp
      mountPath: /tmp
    - name: cache
      mountPath: /var/cache/nginx
    - name: run
      mountPath: /var/run
    - name: log
      mountPath: /var/log/nginx
  volumes:
  - name: tmp
    emptyDir: {}
  - name: cache
    emptyDir: {}
  - name: run
    emptyDir: {}
  - name: log
    emptyDir: {}
```
```bash
kubectl apply -f hardened-pod.yaml

# 검증
kubectl exec hardened-pod -- id
# uid=1000 gid=3000

kubectl exec hardened-pod -- touch /root/test.txt
# Read-only file system

kubectl exec hardened-pod -- cat /proc/1/status | grep -i cap
# CapBnd: 0000000000000000 (모든 capabilities 제거됨)
```

`readOnlyRootFilesystem: true`를 설정하면 nginx가 쓰기 권한이 필요한 디렉토리(`/var/cache/nginx`, `/var/run`, `/var/log/nginx`)를 emptyDir로 마운트해야 한다. 이렇게 해야 nginx가 정상 동작한다.
</details>

---

### 문제 23. [Microservice Vulnerabilities] Pod에서 hostPath 볼륨 사용 금지

`app-ns` 네임스페이스에서 실행 중인 Pod 중 hostPath 볼륨을 사용하는 것을 찾아 해당 볼륨을 emptyDir로 교체하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. hostPath 볼륨을 사용하는 Pod 찾기
kubectl get pods -n app-ns -o json | \
  jq -r '.items[] | select(.spec.volumes[]? | .hostPath != null) | .metadata.name'

# 2. 해당 Pod의 현재 설정 확인
kubectl get pod <pod-name> -n app-ns -o yaml > pod-original.yaml

# 3. hostPath를 emptyDir로 교체
# 수정 전:
#   volumes:
#   - name: data
#     hostPath:
#       path: /var/data
#       type: Directory
#
# 수정 후:
#   volumes:
#   - name: data
#     emptyDir: {}

# 4. Pod 재생성 (Pod는 직접 수정 불가한 필드가 있으므로 삭제 후 재생성)
kubectl delete pod <pod-name> -n app-ns
kubectl apply -f pod-modified.yaml

# 5. Deployment인 경우 직접 수정 가능
kubectl edit deployment <deployment-name> -n app-ns
# volumes 섹션에서 hostPath를 emptyDir로 교체
```

hostPath 볼륨은 호스트 노드의 파일시스템에 직접 접근할 수 있어 보안 위험이 크다. 컨테이너가 호스트의 민감한 파일에 접근하거나 수정할 수 있기 때문이다. emptyDir는 Pod 내에서만 존재하는 임시 볼륨이므로 안전하다.
</details>

---

### 문제 24. [Microservice Vulnerabilities] mTLS 개념 - Istio PeerAuthentication

Istio가 설치된 클러스터에서 `production` 네임스페이스의 모든 서비스 간 통신에 STRICT mTLS를 적용하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: production
spec:
  mtls:
    mode: STRICT
```
```bash
kubectl apply -f peer-auth.yaml

# 검증: mTLS 상태 확인
kubectl get peerauthentication -n production

# 평문 트래픽이 차단되는지 확인 (사이드카가 없는 Pod에서 접근 시도)
kubectl run test --image=busybox -n default --rm -it -- \
  wget -qO- --timeout=2 http://my-service.production.svc:8080
# Connection refused 또는 TLS handshake 에러
```

STRICT 모드에서는 Istio 사이드카 프록시가 없는 클라이언트의 평문 트래픽이 거부된다. PERMISSIVE 모드는 mTLS와 평문 모두 허용하므로 마이그레이션 시 사용한다.
</details>

---

## Supply Chain Security (20%) - 8문제

### 문제 25. [Supply Chain Security] Trivy 이미지 스캔

다음 이미지들을 Trivy로 스캔하고, CRITICAL 취약점이 있는 이미지를 식별하라. CRITICAL 취약점이 없는 이미지만 사용하도록 Deployment를 수정하라.
- `nginx:1.19`
- `nginx:1.25`
- `alpine:3.18`

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. 각 이미지 스캔
trivy image --severity CRITICAL nginx:1.19
trivy image --severity CRITICAL nginx:1.25
trivy image --severity CRITICAL alpine:3.18

# 2. exit-code를 사용하여 자동 판별
trivy image --exit-code 1 --severity CRITICAL nginx:1.19
echo $?  # 1이면 CRITICAL 취약점 존재

trivy image --exit-code 1 --severity CRITICAL nginx:1.25
echo $?  # 0이면 CRITICAL 취약점 없음

trivy image --exit-code 1 --severity CRITICAL alpine:3.18
echo $?  # 0이면 CRITICAL 취약점 없음

# 3. CRITICAL 취약점이 없는 이미지로 Deployment 수정
kubectl set image deployment/web nginx=nginx:1.25 -n production
# 또는
kubectl edit deployment web -n production
# image를 CRITICAL 취약점이 없는 버전으로 변경
```

`--exit-code 1`은 지정된 심각도의 취약점이 발견되면 종료 코드 1을 반환한다. CI/CD 파이프라인에서 빌드를 중단하는 데 활용할 수 있다. 오래된 이미지일수록 CRITICAL 취약점이 많다.
</details>

---

### 문제 26. [Supply Chain Security] ImagePolicyWebhook 설정

ImagePolicyWebhook Admission Controller를 활성화하고, 이미지 검증 웹훅을 설정하라. 웹훅이 응답하지 않을 때 기본적으로 이미지를 거부(fail-closed)하도록 설정하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. Admission 설정 디렉토리 생성
mkdir -p /etc/kubernetes/admission-control
```

AdmissionConfiguration:
```yaml
# /etc/kubernetes/admission-control/admission-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: AdmissionConfiguration
plugins:
- name: ImagePolicyWebhook
  configuration:
    imagePolicy:
      kubeConfigFile: /etc/kubernetes/admission-control/image-policy-webhook.kubeconfig
      allowTTL: 50
      denyTTL: 50
      retryBackoff: 500
      defaultAllow: false
```

Webhook kubeconfig:
```yaml
# /etc/kubernetes/admission-control/image-policy-webhook.kubeconfig
apiVersion: v1
kind: Config
clusters:
- name: image-policy-webhook
  cluster:
    server: https://image-policy-webhook.default.svc:443/image-policy
    certificate-authority: /etc/kubernetes/pki/ca.crt
contexts:
- name: image-policy-webhook
  context:
    cluster: image-policy-webhook
    user: api-server
current-context: image-policy-webhook
users:
- name: api-server
  user:
    client-certificate: /etc/kubernetes/pki/apiserver.crt
    client-key: /etc/kubernetes/pki/apiserver.key
```

API server 매니페스트 수정:
```bash
cp /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/kube-apiserver.yaml.bak
vi /etc/kubernetes/manifests/kube-apiserver.yaml
```
```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    - --enable-admission-plugins=NodeRestriction,ImagePolicyWebhook
    - --admission-control-config-file=/etc/kubernetes/admission-control/admission-config.yaml
    volumeMounts:
    - name: admission-control
      mountPath: /etc/kubernetes/admission-control/
      readOnly: true
  volumes:
  - name: admission-control
    hostPath:
      path: /etc/kubernetes/admission-control/
      type: DirectoryOrCreate
```
```bash
# API server 재시작 대기
watch crictl ps | grep kube-apiserver
kubectl get nodes  # 정상 동작 확인
```

`defaultAllow: false`는 fail-closed 정책이다. 웹훅이 응답하지 않거나 에러가 발생하면 이미지 사용을 거부한다. 보안 관점에서 이것이 올바른 설정이다.
</details>

---

### 문제 27. [Supply Chain Security] Dockerfile 보안 수정

다음 Dockerfile의 보안 문제를 모두 수정하라:
```dockerfile
FROM ubuntu:latest
RUN apt-get update && apt-get install -y curl wget vim python3 python3-pip
ADD https://example.com/app.tar.gz /app/
WORKDIR /app
RUN pip3 install -r requirements.txt
EXPOSE 8080
CMD ["python3", "app.py"]
```

<details>
<summary>풀이 확인</summary>

**풀이:**

수정된 Dockerfile:
```dockerfile
# 1. latest 대신 특정 버전 지정
# 2. ubuntu 대신 slim 베이스 이미지 사용
FROM python:3.12-slim AS builder

WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir --user -r requirements.txt
COPY . .

# 멀티스테이지 빌드
FROM python:3.12-slim

# 3. 불필요한 패키지(curl, wget, vim) 설치하지 않음
WORKDIR /app

# 4. ADD 대신 COPY 사용
COPY --from=builder /root/.local /root/.local
COPY --from=builder /app .

ENV PATH=/root/.local/bin:$PATH

# 5. non-root 사용자로 실행
RUN useradd -r -u 1000 appuser
USER 1000:1000

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1

CMD ["python3", "app.py"]
```

수정 사항 정리:
1. `FROM ubuntu:latest` -> `FROM python:3.12-slim`: 특정 버전 지정, 최소 베이스 이미지
2. 불필요한 패키지(curl, wget, vim) 제거: 공격 표면 감소
3. `ADD` -> `COPY`: ADD는 URL 다운로드와 tar 자동 해제 등 예상치 못한 동작이 가능하다
4. `USER 1000:1000` 추가: non-root 실행
5. 멀티스테이지 빌드: 빌드 도구가 최종 이미지에 포함되지 않음
6. HEALTHCHECK 추가
</details>

---

### 문제 28. [Supply Chain Security] Static Analysis - kubesec

다음 Pod 매니페스트를 kubesec으로 스캔하고, 보안 점수를 높이기 위해 수정하라.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: insecure-pod
spec:
  containers:
  - name: app
    image: nginx
    securityContext:
      privileged: true
```

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. kubesec으로 스캔
kubesec scan insecure-pod.yaml

# 또는 온라인 스캔
curl -sSX POST --data-binary @insecure-pod.yaml https://v2.kubesec.io/scan

# 출력에서 scoring과 advise를 확인
# Critical: privileged=true (높은 위험)
# Advise: runAsNonRoot, readOnlyRootFilesystem, capabilities drop 등
```

수정된 매니페스트:
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      privileged: false
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
    resources:
      limits:
        cpu: "200m"
        memory: "128Mi"
      requests:
        cpu: "100m"
        memory: "64Mi"
    volumeMounts:
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: tmp
    emptyDir: {}
```
```bash
# 재스캔하여 점수 향상 확인
kubesec scan secure-pod.yaml
```

kubesec은 매니페스트의 보안 설정을 점수화한다. `privileged: true`는 가장 높은 감점 요소이다. `runAsNonRoot`, `readOnlyRootFilesystem`, `capabilities.drop: ALL` 등이 점수를 높이는 주요 설정이다.
</details>

---

### 문제 29. [Supply Chain Security] 이미지 서명 및 검증 (Cosign)

Cosign을 사용하여 이미지를 서명하고 검증하는 절차를 수행하라:
1. 키 쌍을 생성하라
2. `registry.example.com/myapp:v1.0` 이미지에 서명하라
3. 서명을 검증하라

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. 키 쌍 생성
cosign generate-key-pair
# cosign.key (비밀키)와 cosign.pub (공개키) 생성됨

# 2. 이미지 서명
cosign sign --key cosign.key registry.example.com/myapp:v1.0

# 3. 서명 검증
cosign verify --key cosign.pub registry.example.com/myapp:v1.0

# 출력 예:
# Verification for registry.example.com/myapp:v1.0 --
# The following checks were performed on each of these signatures:
#   - The cosign claims were validated
#   - The signatures were verified against the specified public key

# 4. 서명 정보 확인
cosign triangulate registry.example.com/myapp:v1.0

# 5. Keyless 서명 (OIDC 기반)
cosign sign registry.example.com/myapp:v1.0
# 브라우저에서 OIDC 인증 수행

cosign verify \
  --certificate-identity=user@example.com \
  --certificate-oidc-issuer=https://accounts.google.com \
  registry.example.com/myapp:v1.0
```

Cosign은 Sigstore 프로젝트의 일부로, 컨테이너 이미지에 디지털 서명을 추가하여 무결성과 출처를 검증할 수 있게 한다. 서명은 OCI 레지스트리에 별도의 아티팩트로 저장된다.
</details>

---

### 문제 30. [Supply Chain Security] 특정 이미지 태그 사용 금지

클러스터에서 `latest` 태그가 사용된 컨테이너 이미지를 가진 모든 Pod를 찾아라. 그리고 해당 이미지를 특정 버전 태그로 수정하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. latest 태그 또는 태그 없는 이미지를 사용하는 Pod 찾기
kubectl get pods --all-namespaces -o json | \
  jq -r '.items[] | select(.spec.containers[]? |
    (.image | test(":latest$")) or (.image | test(":") | not)) |
    "\(.metadata.namespace)/\(.metadata.name): \(.spec.containers[].image)"'

# 2. Deployment에서 이미지 태그 수정
kubectl set image deployment/web nginx=nginx:1.25 -n production

# 3. 또는 직접 수정
kubectl edit deployment web -n production
# image: nginx:latest -> image: nginx:1.25

# 4. OPA Gatekeeper로 latest 태그 사용을 금지하는 정책도 적용 가능
```

`latest` 태그는 이미지의 버전을 특정할 수 없어 보안과 재현성 측면에서 위험하다. 항상 구체적인 버전 태그(예: `nginx:1.25.3`) 또는 이미지 다이제스트(예: `nginx@sha256:abc...`)를 사용해야 한다.
</details>

---

### 문제 31. [Supply Chain Security] Trivy로 실행 중인 워크로드 스캔

클러스터에서 실행 중인 모든 Pod의 컨테이너 이미지를 Trivy로 스캔하고, HIGH 이상의 취약점이 있는 이미지 목록을 파일로 저장하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. 실행 중인 모든 고유 이미지 목록 추출
kubectl get pods --all-namespaces -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | sort -u > /tmp/all-images.txt

# 2. 각 이미지를 Trivy로 스캔하고 취약한 이미지 목록 작성
> /tmp/vulnerable-images.txt
while read -r image; do
  echo "Scanning: $image"
  if trivy image --exit-code 1 --severity HIGH,CRITICAL --quiet "$image" 2>/dev/null; then
    echo "PASS: $image"
  else
    echo "$image" >> /tmp/vulnerable-images.txt
    echo "FAIL: $image (HIGH/CRITICAL vulnerabilities found)"
  fi
done < /tmp/all-images.txt

# 3. 결과 확인
echo "=== Vulnerable Images ==="
cat /tmp/vulnerable-images.txt

# 4. 상세 리포트 생성 (선택)
while read -r image; do
  echo "=== $image ===" >> /tmp/vulnerability-report.txt
  trivy image --severity HIGH,CRITICAL "$image" >> /tmp/vulnerability-report.txt 2>&1
  echo "" >> /tmp/vulnerability-report.txt
done < /tmp/vulnerable-images.txt
```

이 방법은 클러스터 보안 감사(audit)의 일환으로 수행된다. 주기적으로 스캔하여 새로운 CVE가 영향을 미치는 이미지를 식별하고 업데이트 계획을 수립해야 한다.
</details>

---

### 문제 32. [Supply Chain Security] 이미지 다이제스트 사용

`web` Deployment의 컨테이너 이미지를 태그 대신 다이제스트(digest)로 지정하여 이미지 변조를 방지하라. 현재 이미지는 `nginx:1.25`이다.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. 이미지 다이제스트 확인
# 방법 1: docker/crane/skopeo 사용
crane digest nginx:1.25
# sha256:abc123def456...

# 방법 2: trivy로 확인
trivy image --format json nginx:1.25 | jq '.Results[0].Target'

# 방법 3: 레지스트리에서 직접 확인
docker inspect --format='{{index .RepoDigests 0}}' nginx:1.25

# 2. Deployment의 이미지를 다이제스트로 변경
kubectl set image deployment/web nginx=nginx@sha256:abc123def456... -n production

# 또는
kubectl edit deployment web -n production
# image: nginx:1.25 -> image: nginx@sha256:abc123def456...

# 3. 확인
kubectl get deployment web -n production -o jsonpath='{.spec.template.spec.containers[0].image}'
```

태그는 같은 이름으로 다른 이미지를 가리킬 수 있지만, 다이제스트(SHA256 해시)는 특정 이미지를 불변으로 식별한다. 다이제스트를 사용하면 이미지가 변조되었을 때 pull이 실패하므로 보안이 강화된다.
</details>

---

## Monitoring, Logging and Runtime Security (20%) - 8문제

### 문제 33. [Runtime Security] Audit Policy 작성

다음 요구사항을 만족하는 Audit Policy를 작성하고 API server에 적용하라:
1. Secret에 대한 모든 요청을 RequestResponse 레벨로 기록
2. Pod에 대한 create, delete 요청을 Request 레벨로 기록
3. 시스템 컴포넌트(system:nodes 그룹)의 get/list/watch 요청은 기록하지 않음
4. 나머지 모든 요청은 Metadata 레벨로 기록

<details>
<summary>풀이 확인</summary>

**풀이:**

파일: `/etc/kubernetes/audit-policy.yaml`
```yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # 1. Secret에 대한 모든 요청 (RequestResponse)
  - level: RequestResponse
    resources:
    - group: ""
      resources: ["secrets"]

  # 2. Pod에 대한 create, delete 요청 (Request)
  - level: Request
    resources:
    - group: ""
      resources: ["pods"]
    verbs: ["create", "delete"]

  # 3. 시스템 컴포넌트의 읽기 요청 제외 (None)
  - level: None
    userGroups: ["system:nodes"]
    verbs: ["get", "list", "watch"]

  # 4. 나머지 모든 요청 (Metadata)
  - level: Metadata
    omitStages:
    - "RequestReceived"
```

API server에 적용:
```bash
# 매니페스트 백업
cp /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/kube-apiserver.yaml.bak

# 로그 디렉토리 생성
mkdir -p /var/log/kubernetes/audit/

vi /etc/kubernetes/manifests/kube-apiserver.yaml
```

추가할 플래그 및 볼륨:
```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    - --audit-policy-file=/etc/kubernetes/audit-policy.yaml
    - --audit-log-path=/var/log/kubernetes/audit/audit.log
    - --audit-log-maxage=30
    - --audit-log-maxbackup=10
    - --audit-log-maxsize=100
    volumeMounts:
    - name: audit-policy
      mountPath: /etc/kubernetes/audit-policy.yaml
      readOnly: true
    - name: audit-log
      mountPath: /var/log/kubernetes/audit/
  volumes:
  - name: audit-policy
    hostPath:
      path: /etc/kubernetes/audit-policy.yaml
      type: File
  - name: audit-log
    hostPath:
      path: /var/log/kubernetes/audit/
      type: DirectoryOrCreate
```
```bash
# API server 재시작 대기
watch crictl ps | grep kube-apiserver

# 검증: audit 로그 확인
tail -1 /var/log/kubernetes/audit/audit.log | jq .
```

Audit Policy의 규칙은 위에서 아래로 순서대로 평가되며, 첫 번째로 매칭되는 규칙이 적용된다. 따라서 규칙의 순서가 매우 중요하다. 구체적인 규칙을 먼저 배치하고 catch-all 규칙을 마지막에 배치해야 한다.
</details>

---

### 문제 34. [Runtime Security] Audit 로그 분석

API server의 audit 로그(`/var/log/kubernetes/audit/audit.log`)를 분석하여 다음을 찾아라:
1. 지난 1시간 내에 Secret을 삭제한 사용자
2. `kube-system` 네임스페이스에서 Pod를 생성한 요청

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. Secret을 삭제한 사용자 찾기
cat /var/log/kubernetes/audit/audit.log | \
  jq -r 'select(.verb == "delete" and .objectRef.resource == "secrets") |
  "\(.requestReceivedTimestamp) - User: \(.user.username), Secret: \(.objectRef.namespace)/\(.objectRef.name)"'

# 2. kube-system에서 Pod를 생성한 요청 찾기
cat /var/log/kubernetes/audit/audit.log | \
  jq -r 'select(.verb == "create" and .objectRef.resource == "pods" and .objectRef.namespace == "kube-system") |
  "\(.requestReceivedTimestamp) - User: \(.user.username), Pod: \(.objectRef.name)"'

# 3. 특정 사용자의 모든 활동 추적
cat /var/log/kubernetes/audit/audit.log | \
  jq -r 'select(.user.username == "suspicious-user") |
  "\(.requestReceivedTimestamp) \(.verb) \(.objectRef.resource)/\(.objectRef.name)"'

# 4. 실패한 요청(403 Forbidden) 찾기
cat /var/log/kubernetes/audit/audit.log | \
  jq -r 'select(.responseStatus.code == 403) |
  "\(.requestReceivedTimestamp) - User: \(.user.username), Action: \(.verb) \(.objectRef.resource)"'
```

Audit 로그는 JSON 형식이며, `jq`를 사용하여 필터링할 수 있다. 주요 필드는 `user.username`, `verb`, `objectRef.resource`, `objectRef.namespace`, `objectRef.name`, `responseStatus.code`, `requestReceivedTimestamp`이다.
</details>

---

### 문제 35. [Runtime Security] Falco 룰 작성 - 컨테이너 내 셸 탐지

Falco 커스텀 룰을 작성하여 컨테이너 내에서 셸이 실행될 때 탐지하도록 하라. 룰을 `/etc/falco/falco_rules.local.yaml`에 추가하고 Falco를 재시작하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
vi /etc/falco/falco_rules.local.yaml
```
```yaml
- rule: Detect Shell in Container
  desc: 컨테이너 내에서 셸 프로세스가 실행되면 탐지한다
  condition: >
    spawned_process and
    container and
    proc.name in (bash, sh, zsh, dash, ksh, csh)
  output: >
    셸이 컨테이너에서 실행됨
    (user=%user.name container_id=%container.id
    container_name=%container.name shell=%proc.name
    parent=%proc.pname cmdline=%proc.cmdline
    image=%container.image.repository:%container.image.tag
    pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: WARNING
  tags: [container, shell, mitre_execution]
```
```bash
# Falco 재시작
systemctl restart falco

# Falco 상태 확인
systemctl status falco

# 검증: 컨테이너에서 셸 실행
kubectl exec -it nginx-pod -- /bin/bash

# Falco 로그에서 탐지 확인
journalctl -u falco --since "1 minute ago" | grep "Shell"
# 또는
tail -f /var/log/syslog | grep falco
```

Falco 룰은 `/etc/falco/falco_rules.local.yaml`에 추가해야 한다. `falco_rules.yaml`(기본 룰 파일)은 직접 수정하지 않는 것이 원칙이다. 업그레이드 시 덮어쓰여질 수 있기 때문이다.
</details>

---

### 문제 36. [Runtime Security] Falco 룰 작성 - 민감 파일 접근 탐지

Falco 커스텀 룰을 작성하여 컨테이너에서 `/etc/shadow` 파일을 읽는 것을 탐지하라. 우선순위는 CRITICAL로 설정하라.

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
vi /etc/falco/falco_rules.local.yaml
```

기존 룰에 추가:
```yaml
- rule: Read Shadow File in Container
  desc: 컨테이너에서 /etc/shadow 파일을 읽으면 탐지한다
  condition: >
    open_read and
    container and
    fd.name = /etc/shadow
  output: >
    /etc/shadow 파일이 컨테이너에서 읽힘 (매우 위험)
    (user=%user.name container_id=%container.id
    container_name=%container.name
    image=%container.image.repository
    pod=%k8s.pod.name ns=%k8s.ns.name
    proc=%proc.name cmdline=%proc.cmdline)
  priority: CRITICAL
  tags: [filesystem, sensitive_file, mitre_credential_access]
```
```bash
# Falco 재시작
systemctl restart falco

# 검증: 컨테이너에서 /etc/shadow 읽기 시도
kubectl exec nginx-pod -- cat /etc/shadow

# Falco 로그 확인
journalctl -u falco --since "1 minute ago" | grep "shadow"
```

`open_read`는 Falco의 내장 매크로로, 파일을 읽기 모드로 여는 시스템콜을 감지한다. `fd.name`은 열린 파일의 경로를 나타낸다. CRITICAL 우선순위는 즉시 대응이 필요한 보안 이벤트를 의미한다.
</details>

---

### 문제 37. [Runtime Security] 컨테이너 불변성 적용

`production` 네임스페이스에서 실행 중인 `web` Deployment를 수정하여 컨테이너를 불변(immutable)으로 만들어라:
1. readOnlyRootFilesystem 활성화
2. 필요한 쓰기 디렉토리만 emptyDir로 마운트
3. 권한 상승 비활성화

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
kubectl edit deployment web -n production
```

수정할 내용:
```yaml
spec:
  template:
    spec:
      containers:
      - name: nginx
        image: nginx:1.25
        securityContext:
          readOnlyRootFilesystem: true
          allowPrivilegeEscalation: false
          runAsNonRoot: true
          runAsUser: 1000
          capabilities:
            drop: ["ALL"]
        volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: cache
          mountPath: /var/cache/nginx
        - name: run
          mountPath: /var/run
        - name: log
          mountPath: /var/log/nginx
      volumes:
      - name: tmp
        emptyDir: {}
      - name: cache
        emptyDir: {}
      - name: run
        emptyDir: {}
      - name: log
        emptyDir: {}
```
```bash
# 롤아웃 상태 확인
kubectl rollout status deployment web -n production

# 검증
kubectl exec -it $(kubectl get pod -n production -l app=web -o name | head -1) -n production -- touch /root/test
# Read-only file system

kubectl exec -it $(kubectl get pod -n production -l app=web -o name | head -1) -n production -- touch /tmp/test
# (성공)
```

`readOnlyRootFilesystem: true`를 설정하면 컨테이너 내에서 파일을 수정할 수 없다. 이는 악성 코드가 바이너리를 설치하거나 설정 파일을 변조하는 것을 방지한다. nginx는 `/var/cache/nginx`, `/var/run`, `/var/log/nginx` 등에 쓰기 권한이 필요하므로 emptyDir로 마운트해야 한다.
</details>

---

### 문제 38. [Runtime Security] Falco 로그 분석

Falco 로그(`/var/log/syslog` 또는 `journalctl -u falco`)를 분석하여 다음을 식별하라:
1. 지난 5분간 컨테이너에서 셸이 실행된 이벤트
2. 해당 이벤트의 컨테이너 이름, Pod 이름, 네임스페이스, 실행된 명령어

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. 지난 5분간 Falco 로그에서 셸 관련 이벤트 검색
journalctl -u falco --since "5 minutes ago" | grep -i "shell"

# 또는 syslog에서 검색
grep -i "shell" /var/log/syslog | tail -20

# 2. 상세 정보 추출
journalctl -u falco --since "5 minutes ago" --no-pager | \
  grep -i "shell" | \
  grep -oP 'container_name=\K[^ ]*|pod=\K[^ ]*|ns=\K[^ ]*|cmdline=\K[^ )]*'

# 3. 출력 예시 분석:
# WARNING 셸이 컨테이너에서 실행됨
# (user=root container_id=abc123
#  container_name=nginx shell=bash
#  parent=runc cmdline=bash
#  image=nginx:1.25
#  pod=web-pod-7d8f9 ns=production)

# 4. 결과를 파일로 저장
journalctl -u falco --since "5 minutes ago" | grep -i "shell" > /tmp/falco-shell-events.txt

# 5. 이벤트 수 카운트
journalctl -u falco --since "5 minutes ago" | grep -ci "shell"
```

Falco의 출력에서 `container_name`, `pod`, `ns`(네임스페이스), `cmdline` 필드를 확인할 수 있다. 이 정보를 바탕으로 어떤 Pod에서 누가 셸을 실행했는지 파악하고 대응할 수 있다.
</details>

---

### 문제 39. [Runtime Security] Sysdig 시스템콜 분석

Sysdig 캡처 파일 `/root/capture.scap`을 분석하여 다음을 찾아라:
1. `nginx` 컨테이너에서 열린 모든 파일 목록
2. `nginx` 컨테이너에서 실행된 프로세스 목록

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. nginx 컨테이너에서 열린 파일 목록
sysdig -r /root/capture.scap \
  "container.name=nginx and evt.type=open" \
  -p "%evt.time %proc.name %fd.name"

# 2. nginx 컨테이너에서 실행된 프로세스 목록
sysdig -r /root/capture.scap \
  "container.name=nginx and evt.type=execve and evt.dir=<" \
  -p "%evt.time %proc.name %proc.cmdline"

# 3. 특정 파일에 접근한 이벤트 필터링
sysdig -r /root/capture.scap \
  "container.name=nginx and fd.name contains /etc/passwd"

# 4. 네트워크 연결 이벤트
sysdig -r /root/capture.scap \
  "container.name=nginx and evt.type=connect" \
  -p "%evt.time %proc.name %fd.name"

# 5. chisel을 사용한 요약
sysdig -r /root/capture.scap -c topprocs_cpu container.name=nginx
sysdig -r /root/capture.scap -c topfiles_bytes container.name=nginx

# 6. 파일 쓰기 이벤트만 필터링
sysdig -r /root/capture.scap \
  "container.name=nginx and evt.type in (write, writev) and fd.type=file" \
  -p "%evt.time %proc.name %fd.name %evt.buffer"
```

Sysdig의 `-r` 옵션은 미리 캡처된 파일을 읽는다. `-p` 옵션은 출력 형식을 지정한다. 필터 표현식에서 `container.name`, `evt.type`, `proc.name`, `fd.name` 등의 필드를 사용하여 원하는 이벤트만 추출할 수 있다.
</details>

---

### 문제 40. [Runtime Security] 런타임 이상 탐지 및 대응

Falco가 다음 경고를 출력했다:
```
CRITICAL: 민감한 파일이 컨테이너에서 읽힘 (user=root file=/etc/shadow container_name=web pod=web-7d8f9 ns=production)
```

이 보안 이벤트에 대해 다음 대응 조치를 수행하라:
1. 해당 Pod를 식별하고 즉시 격리하라 (NetworkPolicy로 모든 트래픽 차단)
2. Pod의 컨테이너에서 실행 중인 프로세스를 확인하라
3. Pod를 삭제하고, Deployment의 보안 설정을 강화하라

<details>
<summary>풀이 확인</summary>

**풀이:**
```bash
# 1. 해당 Pod 확인
kubectl get pod web-7d8f9 -n production -o wide

# 2. NetworkPolicy로 즉시 격리 (모든 트래픽 차단)
```
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: isolate-compromised-pod
  namespace: production
spec:
  podSelector:
    matchLabels:
      # Pod의 라벨을 확인하여 지정
      app: web
      pod-template-hash: 7d8f9  # 특정 Pod만 격리
  policyTypes:
  - Ingress
  - Egress
  # ingress/egress 규칙 없음 = 모든 트래픽 차단
```
```bash
kubectl apply -f isolate-policy.yaml

# 3. 컨테이너에서 실행 중인 프로세스 확인
kubectl exec web-7d8f9 -n production -- ps aux
# 또는
kubectl exec web-7d8f9 -n production -- cat /proc/1/cmdline

# 4. 의심스러운 프로세스 확인
kubectl exec web-7d8f9 -n production -- ls -la /tmp/
kubectl exec web-7d8f9 -n production -- find / -newer /etc/shadow -type f 2>/dev/null

# 5. Pod 삭제 (Deployment가 새 Pod를 자동 생성)
kubectl delete pod web-7d8f9 -n production

# 6. Deployment 보안 설정 강화
kubectl edit deployment web -n production
```

Deployment에 추가/수정할 보안 설정:
```yaml
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
      - name: web
        securityContext:
          readOnlyRootFilesystem: true
          allowPrivilegeEscalation: false
          capabilities:
            drop: ["ALL"]
        volumeMounts:
        - name: tmp
          mountPath: /tmp
      volumes:
      - name: tmp
        emptyDir: {}
```
```bash
# 7. 격리 정책 정리 (새 Pod에는 적용 필요 없음)
kubectl delete networkpolicy isolate-compromised-pod -n production

# 8. 롤아웃 확인
kubectl rollout status deployment web -n production
```

보안 사고 대응의 핵심 절차: 격리 -> 분석 -> 제거 -> 강화이다. 먼저 NetworkPolicy로 격리하여 추가 피해를 방지하고, 프로세스와 파일을 분석하여 침해 범위를 파악한 뒤, 감염된 Pod를 삭제하고 보안 설정을 강화하여 재발을 방지한다.
</details>
