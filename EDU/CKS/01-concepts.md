# CKS 핵심 개념 정리

CKS 시험의 6개 도메인에 해당하는 모든 핵심 개념을 정리한 문서이다. 각 도메인의 출제 비율과 세부 토픽을 체계적으로 다룬다.

---

## 1. Cluster Setup (클러스터 설정) - 10%

클러스터의 초기 보안 설정과 관련된 도메인이다. 네트워크 정책, CIS Benchmark, Ingress 보안, 노드 보호, GUI 보안, 바이너리 검증 등을 포함한다.

### 1.1 NetworkPolicy로 클러스터 레벨 접근 제어

#### 개념

NetworkPolicy는 쿠버네티스에서 Pod 간 네트워크 트래픽을 제어하는 리소스이다. 기본적으로 쿠버네티스 클러스터 내 모든 Pod는 서로 통신할 수 있지만, NetworkPolicy를 적용하면 허용된 트래픽만 통과시킬 수 있다.

#### 핵심 포인트

- **기본 거부 정책(Default Deny)**: 모든 Ingress/Egress 트래픽을 기본적으로 차단하는 정책을 먼저 적용하고, 필요한 트래픽만 허용하는 것이 보안 모범 사례이다.
- **podSelector**: 정책이 적용될 대상 Pod를 라벨로 선택한다. 빈 `{}`는 네임스페이스 내 모든 Pod를 의미한다.
- **namespaceSelector**: 특정 네임스페이스의 Pod만 허용하는 데 사용한다.
- **ipBlock**: CIDR 블록으로 IP 범위를 지정하여 트래픽을 제어한다. 외부 서비스와의 통신을 제어할 때 유용하다.
- **ports**: 허용할 포트와 프로토콜(TCP/UDP)을 지정한다.
- **policyTypes**: `Ingress`, `Egress`, 또는 둘 다를 지정할 수 있다.

#### 동작 방식

1. NetworkPolicy가 없는 네임스페이스에서는 모든 트래픽이 허용된다.
2. 하나의 NetworkPolicy라도 Pod를 선택하면, 해당 Pod에 대한 명시적으로 허용되지 않은 트래픽은 차단된다.
3. 여러 NetworkPolicy가 동일한 Pod를 선택하면, 모든 정책의 허용 규칙이 합집합(OR)으로 적용된다.
4. NetworkPolicy는 CNI 플러그인(Calico, Cilium, Weave Net 등)이 지원해야 한다. Flannel은 NetworkPolicy를 지원하지 않는다.

#### Ingress vs Egress

- **Ingress**: 외부에서 Pod로 들어오는 트래픽을 제어한다. `from` 필드로 소스를 지정한다.
- **Egress**: Pod에서 외부로 나가는 트래픽을 제어한다. `to` 필드로 목적지를 지정한다.
- 보안 강화를 위해 Ingress와 Egress를 모두 제어하는 것이 권장된다.

#### DNS 트래픽 주의사항

Egress 정책을 적용할 때, DNS 조회를 위한 UDP 53 포트(kube-dns/CoreDNS)를 반드시 허용해야 한다. 그렇지 않으면 서비스 이름 기반 통신이 불가능해진다.

---

### 1.2 CIS Benchmark 적용 (kube-bench)

#### 개념

CIS(Center for Internet Security) Kubernetes Benchmark는 쿠버네티스 클러스터의 보안 설정을 검사하기 위한 모범 사례 가이드라인이다. kube-bench는 이 CIS Benchmark를 자동으로 검사하는 오픈소스 도구이다.

#### CIS Benchmark 주요 검사 항목

1. **Control Plane 컴포넌트**
   - API Server: 익명 인증 비활성화(`--anonymous-auth=false`), 감사 로깅 활성화, RBAC 인가 모드 설정
   - Controller Manager: `--use-service-account-credentials=true` 설정
   - Scheduler: 보안 포트만 사용, 프로파일링 비활성화
   - etcd: 클라이언트 인증서 인증, 피어 간 TLS 통신

2. **Worker 노드**
   - kubelet: 익명 인증 비활성화, 인가 모드 Webhook 설정
   - kubelet 설정 파일 권한(644 이하)
   - kubelet 인증서 자동 갱신

3. **Policies**
   - Pod Security Standards 적용
   - NetworkPolicy 존재 여부
   - Secret 암호화 설정

#### kube-bench 사용법

kube-bench는 컨테이너, 바이너리, 또는 Job으로 실행할 수 있다.

- `kube-bench run`: 전체 검사 실행
- `kube-bench run --targets=master`: 마스터 노드만 검사
- `kube-bench run --targets=node`: 워커 노드만 검사
- `kube-bench run --targets=etcd`: etcd만 검사

#### 결과 해석

검사 결과는 다음 상태로 분류된다.
- **PASS**: 검사 통과
- **FAIL**: 검사 실패 (수정 필요)
- **WARN**: 경고 (수동 검토 필요)
- **INFO**: 정보 (참고 사항)

FAIL 항목은 Remediation 가이드를 따라 수정해야 한다.

---

### 1.3 Ingress 보안 (TLS 설정)

#### 개념

Ingress는 클러스터 외부에서 내부 서비스로의 HTTP/HTTPS 트래픽을 관리하는 리소스이다. TLS를 설정하여 암호화된 통신을 보장하는 것이 필수적이다.

#### TLS 설정 방법

1. TLS 인증서와 키를 쿠버네티스 Secret으로 생성한다.
2. Ingress 리소스의 `spec.tls` 필드에 Secret을 참조한다.
3. 인증서는 `kubernetes.io/tls` 타입의 Secret으로 저장한다.

#### 보안 모범 사례

- **HTTPS 강제 리다이렉션**: HTTP 요청을 자동으로 HTTPS로 리다이렉트한다. Ingress 어노테이션으로 설정 가능하다.
- **최신 TLS 버전 사용**: TLS 1.2 이상을 사용하도록 설정한다. TLS 1.0/1.1은 보안 취약점이 있으므로 비활성화한다.
- **강력한 암호화 스위트**: 약한 암호화 알고리즘(RC4, DES 등)을 비활성화하고, AES-GCM 등 강력한 알고리즘만 허용한다.
- **인증서 관리**: cert-manager를 사용하여 인증서를 자동으로 발급하고 갱신할 수 있다. Let's Encrypt와 연동하면 무료 TLS 인증서를 자동 관리할 수 있다.
- **HSTS(HTTP Strict Transport Security)**: 브라우저가 항상 HTTPS로 접속하도록 강제하는 헤더이다.

---

### 1.4 노드 메타데이터 보호

#### 개념

클라우드 환경(AWS, GCP, Azure)에서 실행되는 쿠버네티스 노드는 클라우드 메타데이터 API를 통해 인스턴스의 민감한 정보(IAM 자격 증명, 인스턴스 정보 등)에 접근할 수 있다. Pod에서 이 메타데이터 API에 접근하는 것을 차단해야 한다.

#### 클라우드별 메타데이터 엔드포인트

- **AWS**: `http://169.254.169.254/latest/meta-data/`
- **GCP**: `http://metadata.google.internal/computeMetadata/v1/`
- **Azure**: `http://169.254.169.254/metadata/instance`

#### 보호 방법

1. **NetworkPolicy로 차단**: 메타데이터 IP(`169.254.169.254/32`)로의 Egress 트래픽을 차단하는 NetworkPolicy를 적용한다.
2. **클라우드 네이티브 설정**:
   - AWS: IMDSv2(Instance Metadata Service v2)를 사용하여 토큰 기반 접근을 강제한다.
   - GCP: 메타데이터 차단 방화벽 규칙을 적용한다.
3. **Calico GlobalNetworkPolicy**: 클러스터 전체에 적용되는 네트워크 정책으로 메타데이터 접근을 차단한다.

---

### 1.5 GUI 요소 보안 (Dashboard 접근 제한)

#### 개념

쿠버네티스 Dashboard는 웹 기반 UI로 클러스터를 관리할 수 있는 도구이다. 잘못 설정하면 심각한 보안 취약점이 될 수 있다. 과거에 Tesla 등 대기업에서 Dashboard가 무단으로 노출되어 암호화폐 채굴에 악용된 사례가 있다.

#### 보안 위험

- Dashboard에 `cluster-admin` 권한의 ServiceAccount를 부여하는 것은 매우 위험하다.
- Dashboard를 NodePort나 LoadBalancer로 외부에 노출하면 공격 대상이 된다.
- `--enable-skip-login` 플래그를 사용하면 인증 없이 접근할 수 있어 위험하다.

#### 보안 모범 사례

1. **최소 권한 원칙**: Dashboard ServiceAccount에 필요한 최소한의 RBAC 권한만 부여한다.
2. **kubectl proxy 사용**: Dashboard를 외부에 노출하지 않고, `kubectl proxy`를 통해 로컬에서만 접근한다.
3. **인증 토큰 사용**: Dashboard에 접근할 때 ServiceAccount 토큰이나 kubeconfig를 이용한 인증을 강제한다.
4. **네트워크 정책 적용**: Dashboard Pod에 대한 접근을 특정 IP나 네임스페이스로 제한한다.
5. **Ingress를 통한 접근 시 mTLS 적용**: 클라이언트 인증서 기반 인증을 추가한다.

---

### 1.6 바이너리 검증 (sha512sum)

#### 개념

쿠버네티스 바이너리(kubectl, kubeadm, kubelet 등)를 다운로드할 때, 바이너리의 무결성을 검증하여 변조되지 않았음을 확인해야 한다. sha512sum(또는 sha256sum) 체크섬을 공식 릴리스 페이지의 값과 비교한다.

#### 검증 방법

1. 공식 릴리스 페이지에서 바이너리와 체크섬 파일을 다운로드한다.
2. 다운로드한 바이너리의 체크섬을 계산한다: `sha512sum kubectl`
3. 계산된 체크섬과 공식 체크섬을 비교한다.
4. 일치하면 바이너리가 변조되지 않은 것이다.

#### 시험에서의 활용

시험에서는 주어진 바이너리의 체크섬을 확인하고, 예상 값과 비교하여 변조 여부를 판단하는 문제가 출제될 수 있다. `sha512sum` 명령어의 사용법을 반드시 숙지해야 한다.

---

## 2. Cluster Hardening (클러스터 강화) - 15%

클러스터를 강화하여 보안 수준을 높이는 방법에 관한 도메인이다.

### 2.1 RBAC 최소 권한 원칙

#### 개념

RBAC(Role-Based Access Control)은 쿠버네티스에서 사용자와 서비스 계정의 권한을 관리하는 메커니즘이다. "최소 권한 원칙(Principle of Least Privilege)"을 적용하여 각 주체에게 필요한 최소한의 권한만 부여해야 한다.

#### RBAC 구성 요소

1. **Role**: 네임스페이스 스코프의 권한 정의이다. 특정 네임스페이스 내에서 리소스에 대한 접근 권한을 지정한다.
2. **ClusterRole**: 클러스터 스코프의 권한 정의이다. 클러스터 전체 또는 비네임스페이스 리소스(노드, PV 등)에 대한 권한을 지정한다.
3. **RoleBinding**: Role을 사용자/그룹/ServiceAccount에 바인딩한다. 네임스페이스 스코프이다.
4. **ClusterRoleBinding**: ClusterRole을 사용자/그룹/ServiceAccount에 바인딩한다. 클러스터 스코프이다.

#### API 그룹과 리소스

- `apiGroups`: 빈 문자열 `""`은 core API 그룹(Pod, Service, Secret 등)을 의미한다.
- `resources`: `pods`, `deployments`, `secrets`, `configmaps` 등 쿠버네티스 리소스 이름이다.
- `verbs`: `get`, `list`, `watch`, `create`, `update`, `patch`, `delete` 등의 동작이다.
- `resourceNames`: 특정 이름의 리소스만 접근 가능하도록 제한할 수 있다.

#### 보안 모범 사례

1. **와일드카드(`*`) 사용 금지**: `resources: ["*"]`나 `verbs: ["*"]`는 지나치게 넓은 권한을 부여한다.
2. **ClusterRoleBinding보다 RoleBinding 우선 사용**: 가능하면 네임스페이스 스코프의 RoleBinding을 사용하여 권한 범위를 제한한다.
3. **cluster-admin 사용 최소화**: `cluster-admin` ClusterRole은 모든 리소스에 대한 모든 권한을 가지므로, 극히 제한된 경우에만 사용한다.
4. **정기적 권한 감사**: `kubectl auth can-i --list` 명령어로 주체의 권한을 확인하고, 불필요한 권한을 제거한다.
5. **Secret 접근 제한**: Secret에 대한 읽기 권한은 반드시 필요한 주체에게만 부여한다.

#### 권한 확인 명령어

```bash
# 특정 사용자가 특정 작업을 수행할 수 있는지 확인
kubectl auth can-i create pods --as=user1

# ServiceAccount의 권한 목록 조회
kubectl auth can-i --list --as=system:serviceaccount:namespace:sa-name

# 모든 RoleBinding 조회
kubectl get rolebindings -A

# ClusterRoleBinding 조회
kubectl get clusterrolebindings
```

---

### 2.2 ServiceAccount 보안

#### 개념

ServiceAccount는 Pod 내에서 실행되는 프로세스가 API Server와 통신할 때 사용하는 신원이다. 각 네임스페이스에는 기본적으로 `default` ServiceAccount가 존재하며, 별도 지정이 없으면 Pod에 자동으로 마운트된다.

#### automountServiceAccountToken

기본적으로 쿠버네티스는 Pod에 ServiceAccount 토큰을 자동으로 마운트한다(`/var/run/secrets/kubernetes.io/serviceaccount/token`). API Server와 통신할 필요가 없는 Pod에서는 이를 비활성화해야 한다.

비활성화 방법은 두 가지이다.
1. **ServiceAccount 레벨**: ServiceAccount의 `automountServiceAccountToken: false`를 설정하면, 해당 SA를 사용하는 모든 Pod에 적용된다.
2. **Pod 레벨**: Pod의 `spec.automountServiceAccountToken: false`를 설정하면, 해당 Pod에만 적용된다. Pod 레벨 설정이 ServiceAccount 레벨보다 우선한다.

#### 보안 모범 사례

1. **전용 ServiceAccount 생성**: 각 워크로드에 전용 ServiceAccount를 생성하고, `default` SA 사용을 지양한다.
2. **불필요한 토큰 마운트 비활성화**: API Server와 통신하지 않는 Pod에서는 `automountServiceAccountToken: false`를 설정한다.
3. **토큰 유효 기간 제한**: Bound ServiceAccount Token(시간 제한 있는 토큰)을 사용한다. 쿠버네티스 1.22부터 기본적으로 1시간 유효한 토큰이 프로젝티드 볼륨으로 마운트된다.
4. **최소 RBAC 권한**: ServiceAccount에 필요한 최소한의 권한만 RoleBinding으로 부여한다.

---

### 2.3 kubeconfig 보안

#### 개념

kubeconfig 파일은 쿠버네티스 클러스터에 접속하기 위한 인증 정보를 포함하는 설정 파일이다. 기본 위치는 `~/.kube/config`이다. 이 파일이 유출되면 클러스터에 대한 무단 접근이 가능해지므로 철저한 관리가 필요하다.

#### kubeconfig 구성 요소

1. **clusters**: 클러스터 API Server 주소와 CA 인증서 정보이다.
2. **users**: 인증에 사용할 클라이언트 인증서, 토큰, 또는 인증 플러그인 설정이다.
3. **contexts**: 클러스터와 사용자의 조합을 정의한다.

#### 보안 모범 사례

1. **파일 권한 제한**: `chmod 600 ~/.kube/config`로 소유자만 읽기/쓰기가 가능하도록 설정한다.
2. **인증서 기반 인증**: 토큰 대신 클라이언트 인증서를 사용하면 유효 기간을 설정할 수 있다.
3. **외부 인증 제공자**: OIDC(OpenID Connect) 같은 외부 인증 제공자를 연동하여 중앙집중식 인증을 구현한다.
4. **컨텍스트 분리**: 개발/스테이징/운영 환경의 kubeconfig를 분리하여 관리한다.
5. **kubeconfig를 버전 관리 시스템에 커밋하지 않기**: .gitignore에 kubeconfig 파일을 추가한다.

---

### 2.4 API Server 접근 제한

#### 개념

API Server는 쿠버네티스 클러스터의 중심 컴포넌트로, 모든 요청은 API Server를 통해 처리된다. API Server에 대한 접근을 제한하는 것은 클러스터 보안의 핵심이다.

#### 접근 제한 방법

1. **익명 인증 비활성화**: `--anonymous-auth=false`를 설정하여 인증되지 않은 요청을 거부한다.
2. **인가 모드 설정**: `--authorization-mode=RBAC,Node`를 설정하여 RBAC과 Node 인가를 사용한다. `AlwaysAllow`는 절대 사용하지 않는다.
3. **Admission Controller 활성화**: 보안 관련 Admission Controller(NodeRestriction, PodSecurity 등)를 활성화한다.
4. **감사 로깅 활성화**: `--audit-policy-file`과 `--audit-log-path`를 설정하여 모든 API 요청을 기록한다.
5. **API Server 포트 제한**: API Server를 내부 네트워크에서만 접근 가능하도록 방화벽을 설정한다.
6. **NodeRestriction Admission Controller**: kubelet이 자신의 노드와 해당 노드에서 실행되는 Pod만 수정할 수 있도록 제한한다.
7. **insecure-port 비활성화**: `--insecure-port=0`을 설정하여 인증/인가를 우회하는 비보안 포트를 비활성화한다(최신 버전에서는 기본 비활성화).

#### API Server 주요 보안 플래그

```
--anonymous-auth=false
--authorization-mode=RBAC,Node
--enable-admission-plugins=NodeRestriction,PodSecurity
--audit-policy-file=/etc/kubernetes/audit-policy.yaml
--audit-log-path=/var/log/kubernetes/audit/audit.log
--profiling=false
--insecure-port=0
--kubelet-certificate-authority=/path/to/ca.crt
--encryption-provider-config=/etc/kubernetes/encryption-config.yaml
```

---

### 2.5 업그레이드를 통한 보안 패치

#### 개념

쿠버네티스는 약 4개월 주기로 새로운 마이너 버전을 릴리스하며, 각 버전은 약 14개월간 보안 패치가 제공된다. 최신 버전으로 업그레이드하여 알려진 보안 취약점(CVE)을 해결하는 것이 중요하다.

#### 업그레이드 전략

1. **순차적 업그레이드**: 한 번에 한 마이너 버전씩 업그레이드한다(예: 1.28 -> 1.29 -> 1.30). 마이너 버전 건너뛰기는 권장하지 않는다.
2. **Control Plane 먼저**: kube-apiserver -> kube-controller-manager -> kube-scheduler 순서로 업그레이드한다.
3. **Worker 노드 후속**: Control Plane 업그레이드 완료 후 Worker 노드를 하나씩 업그레이드한다.

#### kubeadm 업그레이드 절차

```bash
# 1. kubeadm 업그레이드
apt-get update && apt-get install -y kubeadm=1.30.x-*

# 2. 업그레이드 계획 확인
kubeadm upgrade plan

# 3. Control Plane 업그레이드 적용
kubeadm upgrade apply v1.30.x

# 4. kubelet, kubectl 업그레이드
apt-get install -y kubelet=1.30.x-* kubectl=1.30.x-*

# 5. kubelet 재시작
systemctl daemon-reload && systemctl restart kubelet
```

#### Worker 노드 업그레이드 절차

```bash
# 1. 노드 drain (워크로드 퇴거)
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data

# 2. kubeadm, kubelet, kubectl 업그레이드
apt-get update && apt-get install -y kubeadm=1.30.x-* kubelet=1.30.x-* kubectl=1.30.x-*

# 3. 노드 설정 업그레이드
kubeadm upgrade node

# 4. kubelet 재시작
systemctl daemon-reload && systemctl restart kubelet

# 5. 노드 uncordon (워크로드 스케줄 허용)
kubectl uncordon <node-name>
```

---

## 3. System Hardening (시스템 강화) - 15%

운영체제와 호스트 레벨에서 보안을 강화하는 방법에 관한 도메인이다.

### 3.1 OS 보안 (최소 설치, 불필요한 서비스 비활성화)

#### 개념

노드의 공격 표면(attack surface)을 최소화하기 위해 운영체제를 최소 구성으로 설치하고, 불필요한 서비스와 패키지를 제거 또는 비활성화해야 한다.

#### 최소 설치 원칙

1. **불필요한 패키지 제거**: GUI, 개발 도구, 불필요한 네트워크 서비스 등을 제거한다.
2. **불필요한 서비스 비활성화**: `systemctl disable <service>` 명령어로 불필요한 서비스를 비활성화한다.
3. **불필요한 포트 차단**: 방화벽(iptables, ufw)으로 필요한 포트만 열어 둔다.
4. **불필요한 커널 모듈 비활성화**: `/etc/modprobe.d/`에 블랙리스트를 추가한다.

#### 필수 보안 설정

```bash
# 불필요한 서비스 확인 및 비활성화
systemctl list-units --type=service --state=running
systemctl disable --now <unnecessary-service>

# 열린 포트 확인
ss -tlnp
netstat -tlnp

# 불필요한 사용자 계정 확인
cat /etc/passwd | grep -v nologin

# 파일 시스템 권한 강화
chmod 644 /etc/passwd
chmod 640 /etc/shadow
```

#### 쿠버네티스 노드에서 필요한 포트

| 컴포넌트 | 포트 | 용도 |
|---------|------|------|
| API Server | 6443 | HTTPS API |
| etcd | 2379-2380 | 클라이언트/피어 통신 |
| kubelet | 10250 | API |
| kube-scheduler | 10259 | HTTPS |
| kube-controller-manager | 10257 | HTTPS |
| NodePort 서비스 | 30000-32767 | 사용자 트래픽 |

---

### 3.2 AppArmor 프로파일

#### 개념

AppArmor(Application Armor)는 리눅스 보안 모듈로, 프로그램이 접근할 수 있는 리소스(파일, 네트워크, 시스템 콜 등)를 제한하는 MAC(Mandatory Access Control) 시스템이다. 쿠버네티스 Pod에 AppArmor 프로파일을 적용하여 컨테이너의 동작을 제한할 수 있다.

#### AppArmor 프로파일 모드

1. **enforce**: 프로파일에 정의된 규칙을 강제 적용한다. 위반 시 해당 동작이 차단된다.
2. **complain**: 규칙 위반 시 차단하지 않고 로그만 기록한다. 프로파일 개발 시 사용한다.
3. **unconfined**: AppArmor 제한을 적용하지 않는다.

#### 프로파일 관리 명령어

```bash
# 로드된 프로파일 확인
aa-status

# 프로파일 enforce 모드로 로드
apparmor_parser -r /etc/apparmor.d/profile-name

# 프로파일 complain 모드로 로드
apparmor_parser -C /etc/apparmor.d/profile-name

# 프로파일 제거
apparmor_parser -R /etc/apparmor.d/profile-name
```

#### 쿠버네티스에서 AppArmor 적용

쿠버네티스 1.30부터는 `securityContext`의 `appArmorProfile` 필드를 사용하여 AppArmor 프로파일을 적용한다. 이전 버전에서는 어노테이션을 사용했다.

```yaml
# 쿠버네티스 1.30+
spec:
  containers:
  - name: app
    securityContext:
      appArmorProfile:
        type: Localhost
        localhostProfile: my-custom-profile
```

이전 방식(어노테이션):
```yaml
metadata:
  annotations:
    container.apparmor.security.beta.kubernetes.io/<container-name>: localhost/<profile-name>
```

#### 주의사항

- AppArmor 프로파일은 Pod가 실행되는 노드에 미리 로드되어 있어야 한다.
- 프로파일이 노드에 없으면 Pod가 시작되지 않는다.
- 모든 노드에 동일한 프로파일을 배포해야 일관된 보안 정책을 유지할 수 있다.

---

### 3.3 seccomp 프로파일

#### 개념

seccomp(Secure Computing Mode)은 리눅스 커널 기능으로, 프로세스가 사용할 수 있는 시스템 콜(syscall)을 제한한다. 불필요한 시스템 콜을 차단하여 컨테이너의 공격 표면을 줄일 수 있다.

#### seccomp 프로파일 타입

1. **RuntimeDefault**: 컨테이너 런타임(containerd, CRI-O)이 제공하는 기본 프로파일이다. 대부분의 위험한 시스템 콜을 차단한다.
2. **Localhost**: 노드에 커스텀 프로파일을 저장하고 참조한다. 프로파일은 kubelet의 `--seccomp-profile-root` 경로(기본 `/var/lib/kubelet/seccomp/`)에 위치해야 한다.
3. **Unconfined**: seccomp 제한을 적용하지 않는다. 보안 관점에서 권장하지 않는다.

#### seccomp 프로파일 구조

seccomp 프로파일은 JSON 형식으로 작성한다.

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": ["SCMP_ARCH_X86_64"],
  "syscalls": [
    {
      "names": ["accept", "bind", "clone", "close", "connect", "execve",
                "exit", "exit_group", "fstat", "getpid", "listen", "mmap",
                "open", "openat", "read", "socket", "write"],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

#### 쿠버네티스에서 seccomp 적용

```yaml
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault  # 또는 Localhost
      # type: Localhost인 경우
      # localhostProfile: profiles/my-profile.json
  containers:
  - name: app
    image: nginx
```

#### seccomp 동작(Action)

- `SCMP_ACT_ALLOW`: 시스템 콜을 허용한다.
- `SCMP_ACT_ERRNO`: 시스템 콜을 차단하고 에러를 반환한다.
- `SCMP_ACT_LOG`: 시스템 콜을 허용하지만 로그에 기록한다.
- `SCMP_ACT_KILL`: 시스템 콜을 차단하고 프로세스를 종료한다.

---

### 3.4 Syscall 제한

#### 개념

시스템 콜은 사용자 공간의 프로그램이 커널 기능을 사용하기 위한 인터페이스이다. 리눅스에는 400개 이상의 시스템 콜이 있지만, 일반적인 컨테이너 워크로드는 그 중 일부만 사용한다. 불필요한 시스템 콜을 제한하면 공격자가 커널 취약점을 악용하는 것을 방지할 수 있다.

#### 제한 도구

1. **seccomp**: 앞서 설명한 시스템 콜 필터링 메커니즘이다.
2. **AppArmor**: 파일 접근, 네트워크 접근 등을 포함한 포괄적인 접근 제어를 제공한다.
3. **SELinux**: Red Hat 계열에서 사용하는 MAC 시스템으로, AppArmor의 대안이다.

#### 위험한 시스템 콜 예시

- `mount`: 파일 시스템 마운트 (컨테이너 탈출 가능)
- `ptrace`: 다른 프로세스 디버깅 (비밀 정보 추출 가능)
- `reboot`: 시스템 재부팅
- `unshare`: 새 네임스페이스 생성 (권한 상승 가능)
- `keyctl`: 커널 키링 접근 (인증 정보 탈취 가능)

---

### 3.5 IAM 역할 관리

#### 개념

클라우드 환경에서 쿠버네티스 노드와 Pod에 할당되는 IAM(Identity and Access Management) 역할을 최소 권한 원칙에 따라 관리해야 한다.

#### AWS에서의 IAM 관리

1. **노드 IAM 역할 최소화**: 워커 노드의 EC2 인스턴스에 부여하는 IAM 역할에는 ECR 풀 권한 등 최소한의 권한만 포함한다.
2. **IRSA(IAM Roles for Service Accounts)**: Pod별로 세분화된 IAM 역할을 ServiceAccount에 바인딩한다. 노드 레벨이 아닌 Pod 레벨에서 IAM 권한을 관리할 수 있다.
3. **Pod Identity**: EKS Pod Identity를 사용하면 IRSA보다 간편하게 Pod에 IAM 역할을 부여할 수 있다.

#### GCP에서의 IAM 관리

1. **Workload Identity**: GKE에서 ServiceAccount를 GCP IAM Service Account에 매핑한다.
2. **노드 서비스 계정 제한**: 노드에 부여하는 GCP 서비스 계정의 권한을 최소화한다.

#### 공통 모범 사례

- 노드에 광범위한 클라우드 권한을 부여하지 않는다.
- Pod별로 필요한 클라우드 리소스 접근 권한을 개별적으로 부여한다.
- 정기적으로 IAM 정책을 감사하여 불필요한 권한을 제거한다.

---

## 4. Minimize Microservice Vulnerabilities (마이크로서비스 취약점 최소화) - 20%

마이크로서비스 아키텍처에서 발생할 수 있는 보안 취약점을 최소화하는 방법에 관한 도메인이다.

### 4.1 Pod Security Standards / Admission

#### 개념

Pod Security Standards(PSS)는 쿠버네티스 공식 보안 정책으로, Pod의 보안 수준을 세 단계로 정의한다. Pod Security Admission(PSA)은 PSS를 적용하는 빌트인 Admission Controller이다. 이전의 PodSecurityPolicy(PSP)를 대체한다.

#### Pod Security Standards 세 단계

1. **Privileged**: 제한 없음. 기존 시스템 워크로드나 인프라 레벨 워크로드에 적합하다.
2. **Baseline**: 알려진 권한 상승을 방지하는 최소한의 정책이다. hostNetwork, hostPID, privileged 컨테이너 등을 차단한다.
3. **Restricted**: 가장 엄격한 보안 정책이다. non-root 실행, 모든 Capability 드롭, seccomp 프로파일 필수 등을 강제한다.

#### Pod Security Admission 모드

1. **enforce**: 정책을 위반하는 Pod 생성을 거부한다.
2. **audit**: 정책 위반을 감사 로그에 기록하지만 Pod 생성은 허용한다.
3. **warn**: 정책 위반 시 사용자에게 경고 메시지를 표시하지만 Pod 생성은 허용한다.

#### 네임스페이스에 PSA 적용

네임스페이스에 라벨을 추가하여 PSA를 활성화한다.

```bash
# restricted 정책을 enforce 모드로 적용
kubectl label namespace my-ns \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest

# baseline 정책을 warn 모드로 적용
kubectl label namespace my-ns \
  pod-security.kubernetes.io/warn=baseline \
  pod-security.kubernetes.io/warn-version=latest
```

#### Restricted 정책의 주요 제약

- `spec.containers[*].securityContext.runAsNonRoot: true` 필수
- `spec.containers[*].securityContext.allowPrivilegeEscalation: false` 필수
- `spec.containers[*].securityContext.capabilities.drop: ["ALL"]` 필수
- `spec.containers[*].securityContext.seccompProfile.type: RuntimeDefault` 필수
- `hostNetwork`, `hostPID`, `hostIPC` 사용 불가
- `privileged: true` 사용 불가
- hostPath 볼륨 사용 불가

---

### 4.2 OPA Gatekeeper

#### 개념

OPA(Open Policy Agent) Gatekeeper는 쿠버네티스 클러스터에 정책 기반 접근 제어를 적용하는 도구이다. Admission Webhook으로 동작하며, Rego 언어로 작성한 정책에 따라 리소스 생성/수정 요청을 허용하거나 거부한다.

#### 구성 요소

1. **ConstraintTemplate**: 정책 로직을 정의하는 CRD이다. Rego 언어로 검증 로직을 작성한다.
2. **Constraint**: ConstraintTemplate의 인스턴스로, 실제 정책 파라미터를 지정하여 적용한다.

#### Rego 언어 기본

Rego는 OPA의 정책 언어로, 선언적으로 규칙을 정의한다.

- `violation`: 정책 위반을 나타내는 규칙이다. `violation` 규칙이 참이면 요청이 거부된다.
- `input`: 쿠버네티스 API 요청 객체에 접근한다. `input.review.object`로 생성/수정되는 리소스에 접근할 수 있다.
- `parameters`: Constraint에서 전달한 파라미터에 접근한다.

#### 주요 사용 사례

1. **필수 라벨 강제**: 모든 리소스에 특정 라벨이 있어야 한다.
2. **이미지 레지스트리 제한**: 허용된 레지스트리의 이미지만 사용할 수 있다.
3. **리소스 제한 강제**: 모든 컨테이너에 리소스 요청/제한이 설정되어야 한다.
4. **Privileged 컨테이너 금지**: privileged 모드로 실행되는 컨테이너를 차단한다.
5. **호스트 네임스페이스 사용 금지**: hostNetwork, hostPID, hostIPC 사용을 차단한다.

---

### 4.3 Secret 관리 (Vault, sealed-secrets)

#### 개념

쿠버네티스 Secret은 비밀번호, API 키, 인증서 등 민감한 데이터를 저장하는 리소스이다. 기본적으로 Secret은 etcd에 base64 인코딩된 상태로 저장되며, 이는 암호화가 아니므로 보안에 취약하다.

#### 쿠버네티스 Secret의 보안 문제

1. **base64는 암호화가 아니다**: base64 인코딩은 단순한 인코딩이므로 누구나 디코딩할 수 있다.
2. **etcd에 평문 저장**: 기본 설정에서 Secret은 etcd에 평문으로 저장된다.
3. **RBAC으로만 접근 제어**: Secret에 대한 get 권한이 있으면 모든 Secret의 내용을 볼 수 있다.

#### Encryption at Rest (저장 시 암호화)

API Server의 `--encryption-provider-config` 플래그로 Secret을 etcd에 저장할 때 암호화할 수 있다.

```yaml
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
```

암호화 프로바이더 종류:
- `aescbc`: AES-CBC 암호화 (권장)
- `aesgcm`: AES-GCM 암호화
- `secretbox`: NaCl SecretBox 암호화
- `identity`: 암호화 없음 (기본값)
- `kms`: 외부 KMS(Key Management Service) 사용 (가장 안전)

#### HashiCorp Vault

Vault는 시크릿 관리를 위한 전용 솔루션이다. 동적 시크릿 생성, 시크릿 자동 갱신, 감사 로깅 등을 제공한다.

- **Vault Agent Injector**: 사이드카 컨테이너를 통해 Pod에 시크릿을 주입한다.
- **CSI Provider**: CSI 드라이버를 통해 시크릿을 볼륨으로 마운트한다.
- **External Secrets Operator**: 외부 시크릿 관리 시스템의 시크릿을 쿠버네티스 Secret으로 동기화한다.

#### Sealed Secrets

Bitnami의 Sealed Secrets는 쿠버네티스 Secret을 안전하게 Git에 저장할 수 있게 해주는 도구이다.

- **kubeseal CLI**: Secret을 SealedSecret으로 암호화한다. 클러스터의 공개 키로 암호화하므로, 해당 클러스터에서만 복호화할 수 있다.
- **SealedSecret Controller**: 클러스터에서 SealedSecret을 감시하고, 복호화하여 일반 Secret을 생성한다.

---

### 4.4 RuntimeClass (gVisor, Kata Containers)

#### 개념

RuntimeClass는 Pod에서 사용할 컨테이너 런타임을 선택할 수 있게 해주는 쿠버네티스 리소스이다. 보안이 중요한 워크로드에는 gVisor나 Kata Containers 같은 샌드박스 런타임을 사용하여 격리 수준을 높일 수 있다.

#### gVisor

gVisor는 구글이 개발한 사용자 공간 커널이다. 컨테이너의 시스템 콜을 가로채서 사용자 공간에서 처리하므로, 호스트 커널에 직접 접근하는 것을 방지한다.

- **장점**: 추가 가상화 없이 강력한 격리를 제공한다. 커널 취약점으로부터 호스트를 보호한다.
- **단점**: 모든 시스템 콜을 지원하지 않으므로, 일부 애플리케이션은 호환성 문제가 있을 수 있다. 성능 오버헤드가 있다.
- **런타임 핸들러**: `runsc` (containerd와 함께 사용)

#### Kata Containers

Kata Containers는 경량 가상 머신(VM) 내에서 컨테이너를 실행하는 런타임이다. 각 Pod가 독립적인 커널과 VM에서 실행되므로 강력한 격리를 제공한다.

- **장점**: 하드웨어 가상화 수준의 격리를 제공한다. OCI 호환이므로 기존 컨테이너 이미지를 그대로 사용할 수 있다.
- **단점**: VM 시작 오버헤드가 있다. 중첩 가상화(nested virtualization)가 필요할 수 있다.
- **런타임 핸들러**: `kata`

#### RuntimeClass 사용 방법

1. RuntimeClass 리소스를 생성한다.
2. Pod의 `spec.runtimeClassName`에 RuntimeClass 이름을 지정한다.

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
---
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  runtimeClassName: gvisor
  containers:
  - name: app
    image: nginx
```

---

### 4.5 mTLS (Istio)

#### 개념

mTLS(Mutual TLS)는 클라이언트와 서버 모두 인증서를 교환하여 상호 인증하는 TLS 방식이다. 일반적인 TLS는 서버만 인증서를 제공하지만, mTLS는 양방향 인증을 수행하여 보안을 강화한다.

#### Istio에서의 mTLS

Istio 서비스 메시는 사이드카 프록시(Envoy)를 통해 Pod 간 통신에 자동으로 mTLS를 적용할 수 있다.

1. **STRICT 모드**: mTLS만 허용한다. 평문 트래픽을 거부한다.
2. **PERMISSIVE 모드**: mTLS와 평문 트래픽을 모두 허용한다. mTLS 마이그레이션 과정에서 사용한다.
3. **DISABLE 모드**: mTLS를 비활성화한다.

#### PeerAuthentication 리소스

```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: istio-system  # 전체 메시에 적용
spec:
  mtls:
    mode: STRICT
```

#### mTLS의 이점

- **트래픽 암호화**: Pod 간 통신이 암호화되어 중간자 공격(MITM)을 방지한다.
- **상호 인증**: 통신 상대방의 신원을 검증하여 위장 공격을 방지한다.
- **자동 인증서 관리**: Istio가 인증서의 발급, 배포, 갱신을 자동으로 처리한다.
- **제로 트러스트 네트워크**: 네트워크 내부에서도 모든 통신을 인증하고 암호화하는 제로 트러스트 아키텍처를 구현할 수 있다.

---

## 5. Supply Chain Security (공급망 보안) - 20%

소프트웨어 공급망의 보안에 관한 도메인이다. 컨테이너 이미지의 빌드, 배포, 실행 과정에서의 보안을 다룬다.

### 5.1 이미지 취약점 스캔 (Trivy)

#### 개념

컨테이너 이미지에는 OS 패키지와 애플리케이션 라이브러리의 알려진 취약점(CVE)이 포함될 수 있다. 이미지 취약점 스캐너를 사용하여 배포 전에 취약점을 발견하고 해결해야 한다.

#### Trivy

Trivy는 Aqua Security가 개발한 오픈소스 취약점 스캐너이다. 컨테이너 이미지, 파일 시스템, Git 레포지토리, IaC 설정 파일 등을 스캔할 수 있다.

#### Trivy 주요 기능

1. **OS 패키지 취약점 스캔**: Alpine, Debian, Ubuntu, CentOS 등의 OS 패키지 취약점을 검사한다.
2. **언어별 라이브러리 취약점 스캔**: npm, pip, gem, Maven 등의 의존성 취약점을 검사한다.
3. **설정 오류 검사**: Dockerfile, Kubernetes 매니페스트, Terraform 등의 설정 오류를 검사한다.
4. **시크릿 검사**: 이미지에 포함된 시크릿(API 키, 비밀번호 등)을 검사한다.

#### Trivy 사용법

```bash
# 이미지 스캔
trivy image nginx:latest

# 심각도 필터링 (HIGH, CRITICAL만 표시)
trivy image --severity HIGH,CRITICAL nginx:latest

# JSON 형식 출력
trivy image --format json -o results.json nginx:latest

# 특정 취약점 ID로 필터링
trivy image --vuln-type os nginx:latest

# 파일 시스템 스캔
trivy fs /path/to/project

# Kubernetes 매니페스트 스캔
trivy config /path/to/k8s-manifests/

# 종료 코드 설정 (CI/CD에서 취약점 발견 시 빌드 실패)
trivy image --exit-code 1 --severity CRITICAL nginx:latest
```

#### 취약점 심각도

- **CRITICAL**: 원격 코드 실행(RCE) 등 매우 심각한 취약점이다. 즉시 패치해야 한다.
- **HIGH**: 중요한 보안 취약점이다. 가능한 빨리 패치해야 한다.
- **MEDIUM**: 보통 수준의 취약점이다.
- **LOW**: 낮은 수준의 취약점이다.
- **UNKNOWN**: 심각도가 분류되지 않은 취약점이다.

---

### 5.2 ImagePolicyWebhook

#### 개념

ImagePolicyWebhook은 쿠버네티스 Admission Controller로, Pod 생성 시 컨테이너 이미지의 사용 여부를 외부 웹훅 서버에 문의하여 결정한다. 이를 통해 승인된 이미지만 클러스터에서 실행되도록 강제할 수 있다.

#### 동작 방식

1. 사용자가 Pod 생성을 요청한다.
2. API Server가 ImagePolicyWebhook Admission Controller를 호출한다.
3. Admission Controller가 외부 웹훅 서버에 이미지 정보를 전달한다.
4. 웹훅 서버가 허용/거부를 응답한다.
5. API Server가 응답에 따라 Pod 생성을 허용하거나 거부한다.

#### 설정 방법

1. **Admission Controller 활성화**: API Server의 `--enable-admission-plugins`에 `ImagePolicyWebhook`을 추가한다.
2. **Admission Configuration 파일 작성**: 웹훅 서버의 URL, 인증 정보, 기본 허용/거부 정책 등을 설정한다.
3. **kubeconfig 파일 작성**: 웹훅 서버에 접속하기 위한 kubeconfig를 작성한다.

#### 주요 설정 옵션

- `defaultAllow`: 웹훅 서버에 접속할 수 없을 때 기본적으로 허용할지 거부할지 결정한다. 보안을 위해 `false`로 설정하는 것이 권장된다.
- `allowTTL`/`denyTTL`: 허용/거부 응답의 캐시 유효 기간이다.
- `retryBackoff`: 웹훅 호출 실패 시 재시도 간격이다.

---

### 5.3 이미지 서명/검증 (Cosign, Notary)

#### 개념

컨테이너 이미지의 무결성과 출처를 검증하기 위해 이미지에 디지털 서명을 적용하고, 배포 시 서명을 검증하는 것이 중요하다.

#### Cosign

Cosign은 Sigstore 프로젝트의 일부로, 컨테이너 이미지에 서명하고 검증하는 도구이다.

```bash
# 키 쌍 생성
cosign generate-key-pair

# 이미지 서명
cosign sign --key cosign.key my-registry/my-image:tag

# 이미지 서명 검증
cosign verify --key cosign.pub my-registry/my-image:tag
```

#### Notary / Docker Content Trust

Notary는 Docker Content Trust(DCT)의 기반 기술로, 이미지 서명 및 검증을 제공한다.

```bash
# Docker Content Trust 활성화
export DOCKER_CONTENT_TRUST=1

# 서명된 이미지 푸시
docker push my-registry/my-image:tag

# 서명 검증 후 풀
docker pull my-registry/my-image:tag
```

#### Admission Controller와 연동

Connaisseur, Kyverno, OPA Gatekeeper 등의 도구를 사용하여 서명되지 않은 이미지의 배포를 차단할 수 있다.

---

### 5.4 Allowlist 레지스트리

#### 개념

클러스터에서 사용할 수 있는 컨테이너 이미지 레지스트리를 허용 목록(Allowlist)으로 제한하여, 신뢰할 수 없는 소스에서 이미지가 배포되는 것을 방지한다.

#### 구현 방법

1. **OPA Gatekeeper**: ConstraintTemplate에서 허용된 레지스트리 목록을 검사하는 정책을 작성한다.
2. **Kyverno**: ClusterPolicy에서 이미지 레지스트리를 검증하는 규칙을 작성한다.
3. **ImagePolicyWebhook**: 외부 웹훅 서버에서 레지스트리를 검증한다.

#### 모범 사례

- 프라이빗 레지스트리(예: Harbor, ECR, GCR, ACR)만 허용하고 Docker Hub 등 공개 레지스트리를 차단한다.
- `latest` 태그 사용을 금지하고, 특정 버전 태그 또는 다이제스트(SHA256)를 사용하도록 강제한다.
- 이미지 다이제스트(예: `nginx@sha256:abc123...`)를 사용하면 이미지 변조를 방지할 수 있다.

---

### 5.5 Dockerfile 보안 (non-root, 최소 베이스 이미지)

#### 개념

Dockerfile 작성 시 보안 모범 사례를 따르면 컨테이너의 공격 표면을 줄일 수 있다.

#### Dockerfile 보안 모범 사례

1. **최소 베이스 이미지 사용**: `alpine`, `distroless`, `scratch` 등 최소한의 패키지만 포함된 베이스 이미지를 사용한다.
   - `alpine`: 최소한의 리눅스 배포판 (약 5MB)
   - `distroless`: 구글이 제공하는 이미지로, 셸도 포함하지 않는다
   - `scratch`: 빈 이미지로, 정적 바이너리에 적합하다

2. **non-root 사용자로 실행**: `USER` 지시어를 사용하여 컨테이너를 비root 사용자로 실행한다.
   ```dockerfile
   RUN addgroup -S appgroup && adduser -S appuser -G appgroup
   USER appuser
   ```

3. **멀티스테이지 빌드**: 빌드 도구와 소스 코드를 최종 이미지에 포함시키지 않는다.
   ```dockerfile
   # 빌드 스테이지
   FROM golang:1.21 AS builder
   WORKDIR /app
   COPY . .
   RUN CGO_ENABLED=0 go build -o myapp

   # 실행 스테이지
   FROM alpine:3.19
   COPY --from=builder /app/myapp /usr/local/bin/
   USER 1000
   CMD ["myapp"]
   ```

4. **COPY 대신 ADD 지양**: `ADD`는 URL 다운로드와 자동 압축 해제 기능이 있어 의도치 않은 파일이 포함될 수 있다. `COPY`를 사용하는 것이 안전하다.

5. **고정 버전 태그 사용**: `FROM nginx:latest` 대신 `FROM nginx:1.25.3-alpine`처럼 정확한 버전을 지정한다.

6. **불필요한 패키지 설치 금지**: 빌드에 필요 없는 패키지를 설치하지 않는다. `--no-install-recommends` 옵션을 사용한다.

7. **.dockerignore 활용**: `.git`, `.env`, `node_modules` 등 불필요한 파일이 이미지에 포함되지 않도록 한다.

8. **시크릿을 이미지에 포함하지 않기**: 빌드 시 필요한 시크릿은 Docker BuildKit의 `--secret` 플래그를 사용한다.

---

### 5.6 Static Analysis (kubesec, conftest)

#### 개념

정적 분석(Static Analysis)은 코드를 실행하지 않고 분석하여 보안 취약점이나 설정 오류를 발견하는 방법이다.

#### kubesec

kubesec은 쿠버네티스 매니페스트의 보안 위험을 점수화하여 평가하는 도구이다.

```bash
# 매니페스트 스캔
kubesec scan pod.yaml

# HTTP API 사용
curl -sSX POST --data-binary @pod.yaml https://v2.kubesec.io/scan
```

kubesec이 검사하는 항목:
- `runAsNonRoot` 설정 여부
- `readOnlyRootFilesystem` 설정 여부
- 리소스 제한 설정 여부
- `privileged` 모드 사용 여부
- Capability 설정
- hostNetwork/hostPID/hostIPC 사용 여부

#### conftest

conftest는 OPA/Rego 정책을 사용하여 구조화된 데이터(YAML, JSON, Dockerfile 등)를 검증하는 도구이다.

```bash
# Rego 정책 파일 작성 (policy/base.rego)
# 매니페스트 검증
conftest test deployment.yaml

# 특정 정책 디렉토리 지정
conftest test --policy /path/to/policies deployment.yaml

# Dockerfile 검증
conftest test --policy dockerfile-policies Dockerfile
```

#### CI/CD 파이프라인 통합

정적 분석 도구를 CI/CD 파이프라인에 통합하여 보안 취약점이 있는 매니페스트가 배포되지 않도록 해야 한다.

```bash
# CI/CD 파이프라인 예시
kubesec scan deployment.yaml | jq '.[].score'
trivy config --exit-code 1 --severity HIGH,CRITICAL .
conftest test --policy policies/ k8s/
```

---

## 6. Monitoring, Logging and Runtime Security (모니터링, 로깅 및 런타임 보안) - 20%

런타임 환경에서의 보안 모니터링, 감사 로깅, 위협 탐지에 관한 도메인이다.

### 6.1 Audit Policy 설정

#### 개념

쿠버네티스 감사 로깅(Audit Logging)은 API Server로 들어오는 모든 요청을 기록하여, 누가, 언제, 무엇을 했는지 추적할 수 있게 한다. 보안 사고 조사, 컴플라이언스 준수, 이상 활동 감지에 필수적이다.

#### Audit Policy 레벨

1. **None**: 로깅하지 않는다.
2. **Metadata**: 요청의 메타데이터(사용자, 타임스탬프, 리소스, 동작)만 기록한다.
3. **Request**: 메타데이터와 요청 본문을 기록한다.
4. **RequestResponse**: 메타데이터, 요청 본문, 응답 본문을 모두 기록한다. 가장 상세하지만 스토리지를 많이 사용한다.

#### Audit Policy 구조

```yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # Secret에 대한 모든 요청을 RequestResponse 레벨로 기록
  - level: RequestResponse
    resources:
    - group: ""
      resources: ["secrets"]

  # ConfigMap 변경은 Request 레벨로 기록
  - level: Request
    resources:
    - group: ""
      resources: ["configmaps"]
    verbs: ["create", "update", "patch", "delete"]

  # 읽기 전용 요청은 Metadata만 기록
  - level: Metadata
    verbs: ["get", "list", "watch"]

  # 나머지는 Metadata 레벨로 기록
  - level: Metadata
    omitStages:
    - "RequestReceived"
```

#### API Server 설정

```
--audit-policy-file=/etc/kubernetes/audit-policy.yaml
--audit-log-path=/var/log/kubernetes/audit/audit.log
--audit-log-maxage=30        # 로그 보관 일수
--audit-log-maxbackup=10     # 백업 파일 최대 수
--audit-log-maxsize=100      # 파일 최대 크기 (MB)
```

#### Audit Backend

1. **Log Backend**: 감사 로그를 파일에 기록한다. `--audit-log-path`로 경로를 지정한다.
2. **Webhook Backend**: 감사 이벤트를 외부 서비스로 전송한다. `--audit-webhook-config-file`로 설정한다.

---

### 6.2 Falco 룰 작성

#### 개념

Falco는 CNCF에서 관리하는 클라우드 네이티브 런타임 보안 도구이다. 시스템 콜을 모니터링하여 의심스러운 활동을 실시간으로 탐지하고 경보를 생성한다.

#### Falco 아키텍처

1. **커널 모듈/eBPF 프로브**: 시스템 콜을 캡처한다. 커널 모듈 또는 eBPF를 사용할 수 있다.
2. **시스템 콜 버퍼**: 캡처된 시스템 콜을 버퍼에 저장한다.
3. **룰 엔진**: 시스템 콜 이벤트를 룰과 매칭하여 보안 위반을 감지한다.
4. **출력**: 경보를 stdout, 파일, syslog, HTTP, gRPC 등으로 출력한다.

#### Falco 룰 구성 요소

1. **rule**: 경보를 생성할 조건이다. `condition`, `desc`, `output`, `priority` 등을 포함한다.
2. **macro**: 재사용 가능한 조건 조각이다.
3. **list**: 항목 목록이다. 룰이나 매크로에서 참조한다.

#### Falco 룰 문법

```yaml
- rule: Terminal shell in container
  desc: A shell was opened in a container with an attached terminal
  condition: >
    spawned_process and container and
    shell_procs and proc.tty != 0
  output: >
    A shell was spawned in a container with an attached terminal
    (user=%user.name container_id=%container.id container_name=%container.name
     shell=%proc.name parent=%proc.pname cmdline=%proc.cmdline)
  priority: WARNING
  tags: [container, shell, mitre_execution]
```

#### 주요 Falco 조건 필드

- `evt.type`: 이벤트(시스템 콜) 타입 (open, execve, connect 등)
- `proc.name`: 프로세스 이름
- `proc.cmdline`: 프로세스 명령줄
- `proc.pname`: 부모 프로세스 이름
- `fd.name`: 파일 디스크립터 이름 (파일 경로, 네트워크 주소 등)
- `container.id`: 컨테이너 ID
- `container.name`: 컨테이너 이름
- `container.image.repository`: 컨테이너 이미지 저장소
- `user.name`: 사용자 이름
- `k8s.ns.name`: 쿠버네티스 네임스페이스 이름
- `k8s.pod.name`: Pod 이름

#### Falco 우선순위

- `EMERGENCY`: 시스템 사용 불가
- `ALERT`: 즉시 조치 필요
- `CRITICAL`: 심각한 상태
- `ERROR`: 오류 상태
- `WARNING`: 경고 상태
- `NOTICE`: 주의 필요
- `INFORMATIONAL`: 정보 제공
- `DEBUG`: 디버그 정보

#### 유용한 기본 룰 예시

```yaml
# 민감한 파일 읽기 감지
- rule: Read sensitive file untrusted
  desc: Sensitive file opened for reading by non-trusted program
  condition: >
    sensitive_files and open_read and
    not proc.name in (trusted_readers)
  output: >
    Sensitive file opened for reading
    (user=%user.name file=%fd.name program=%proc.name command=%proc.cmdline)
  priority: WARNING

# 컨테이너 내 패키지 관리자 실행 감지
- rule: Launch Package Management in Container
  desc: Package management process launched in a container
  condition: >
    spawned_process and container and
    package_mgmt_procs
  output: >
    Package management process launched in container
    (user=%user.name command=%proc.cmdline container=%container.name)
  priority: ERROR
```

---

### 6.3 컨테이너 불변성 (readOnlyRootFilesystem)

#### 개념

컨테이너 불변성(Immutability)은 컨테이너가 실행 중에 파일 시스템을 수정할 수 없도록 하는 보안 원칙이다. 공격자가 컨테이너에 침입하더라도 악성 코드를 기록하거나 설정 파일을 변조할 수 없게 한다.

#### readOnlyRootFilesystem

`securityContext.readOnlyRootFilesystem: true`를 설정하면 컨테이너의 루트 파일 시스템을 읽기 전용으로 마운트한다.

```yaml
spec:
  containers:
  - name: app
    image: nginx
    securityContext:
      readOnlyRootFilesystem: true
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

#### 주의사항

- 애플리케이션이 파일 시스템에 쓰기가 필요한 경우(로그, 캐시, 임시 파일 등), `emptyDir` 볼륨을 특정 경로에 마운트하여 쓰기를 허용한다.
- `/tmp`, `/var/run`, `/var/cache` 등 일반적으로 쓰기가 필요한 경로에 `emptyDir`을 마운트한다.
- readOnlyRootFilesystem과 함께 `allowPrivilegeEscalation: false`, `runAsNonRoot: true`를 설정하면 보안이 더욱 강화된다.

#### 불변 컨테이너의 이점

1. **변조 방지**: 공격자가 바이너리를 교체하거나 백도어를 설치할 수 없다.
2. **일관성 보장**: 컨테이너가 항상 알려진 상태로 실행된다.
3. **포렌식 지원**: 파일 시스템 변경이 불가능하므로, 이상 활동을 쉽게 탐지할 수 있다.
4. **시크릿 보호**: 디스크에 시크릿을 기록하는 것을 방지한다.

---

### 6.4 런타임 이상 탐지

#### 개념

런타임 이상 탐지는 실행 중인 컨테이너와 시스템에서 비정상적인 동작을 감지하는 프로세스이다. 알려진 공격 패턴(시그니처 기반)과 비정상적인 행동(행동 기반)을 모두 탐지할 수 있다.

#### 탐지 대상

1. **프로세스 실행**: 예상치 못한 프로세스 실행 (예: 컨테이너 내 셸 실행, 패키지 관리자 실행)
2. **파일 접근**: 민감한 파일 접근 (예: /etc/shadow, /etc/passwd, ServiceAccount 토큰)
3. **네트워크 활동**: 비정상적인 네트워크 연결 (예: 암호화폐 채굴 풀 연결, 외부 C2 서버 통신)
4. **시스템 콜**: 위험한 시스템 콜 사용 (예: ptrace, mount)
5. **권한 변경**: 비정상적인 권한 변경 (예: setuid/setgid)

#### 탐지 도구

1. **Falco**: 시스템 콜 기반의 런타임 위협 탐지 (앞서 상세히 설명)
2. **Sysdig**: 시스템 콜 기반의 모니터링 및 트러블슈팅 도구
3. **Tetragon**: eBPF 기반의 보안 관찰 도구
4. **Tracee**: Aqua Security의 eBPF 기반 런타임 보안 도구

---

### 6.5 Sysdig, Falco를 이용한 위협 탐지

#### Sysdig

Sysdig은 시스템 레벨의 모니터링 및 보안 도구이다. 시스템 콜을 캡처하고 분석하여 컨테이너 환경의 문제를 진단할 수 있다.

```bash
# 특정 컨테이너의 시스템 콜 캡처
sysdig container.name=my-container

# 파일 접근 이벤트 필터링
sysdig "evt.type=open and container.name=my-container"

# 네트워크 연결 이벤트 필터링
sysdig "evt.type=connect and container.name=my-container"

# 프로세스 실행 이벤트
sysdig "evt.type=execve and container.name=my-container"

# 출력을 파일로 저장
sysdig -w capture.scap

# 캡처 파일 분석
sysdig -r capture.scap
```

#### Sysdig 주요 필드

- `evt.type`: 이벤트 타입
- `evt.dir`: 이벤트 방향 (> 진입, < 종료)
- `proc.name`: 프로세스 이름
- `proc.pid`: 프로세스 ID
- `fd.name`: 파일 디스크립터 이름
- `container.name`: 컨테이너 이름
- `k8s.pod.name`: Pod 이름
- `k8s.ns.name`: 네임스페이스 이름

#### Falco와 Sysdig의 차이

| 특성 | Falco | Sysdig |
|------|-------|--------|
| 용도 | 런타임 위협 탐지 | 시스템 모니터링/트러블슈팅 |
| 동작 방식 | 룰 기반 실시간 경보 | 시스템 콜 캡처/분석 |
| 출력 | 경보 메시지 | 상세 시스템 콜 데이터 |
| 적합한 상황 | 보안 모니터링 | 사고 분석, 디버깅 |

#### 위협 탐지 시나리오

1. **컨테이너 탈출 시도**: `nsenter`, `mount` 등 시스템 콜 감지
2. **암호화폐 채굴**: 알려진 채굴 풀 IP/도메인으로의 네트워크 연결 감지
3. **리버스 셸**: 셸 프로세스에서 외부로의 네트워크 연결 감지
4. **시크릿 접근**: ServiceAccount 토큰 파일 읽기 감지
5. **권한 상승**: setuid/setgid 비트가 설정된 바이너리 실행 감지
6. **데이터 유출**: 대량의 아웃바운드 네트워크 트래픽 감지
7. **백도어 설치**: 컨테이너 내 새로운 바이너리 다운로드 및 실행 감지

---

## 보안 개념 종합 체크리스트

| 도메인 | 핵심 개념 | 관련 도구/리소스 |
|--------|----------|----------------|
| Cluster Setup | NetworkPolicy | Calico, Cilium |
| Cluster Setup | CIS Benchmark | kube-bench |
| Cluster Setup | Ingress TLS | cert-manager |
| Cluster Setup | 노드 메타데이터 보호 | NetworkPolicy |
| Cluster Setup | Dashboard 보안 | RBAC |
| Cluster Setup | 바이너리 검증 | sha512sum |
| Cluster Hardening | RBAC | kubectl auth can-i |
| Cluster Hardening | ServiceAccount | automountServiceAccountToken |
| Cluster Hardening | API Server 보안 | Admission Controller |
| Cluster Hardening | 업그레이드 | kubeadm upgrade |
| System Hardening | OS 보안 | systemctl, ufw |
| System Hardening | AppArmor | apparmor_parser |
| System Hardening | seccomp | securityContext |
| System Hardening | IAM | IRSA, Workload Identity |
| Microservice | Pod Security | PSA/PSS |
| Microservice | OPA Gatekeeper | Rego |
| Microservice | Secret 관리 | Vault, sealed-secrets |
| Microservice | RuntimeClass | gVisor, Kata |
| Microservice | mTLS | Istio |
| Supply Chain | 이미지 스캔 | Trivy |
| Supply Chain | ImagePolicyWebhook | Admission Controller |
| Supply Chain | 이미지 서명 | Cosign, Notary |
| Supply Chain | Dockerfile 보안 | distroless, non-root |
| Supply Chain | 정적 분석 | kubesec, conftest |
| Monitoring | Audit Policy | audit.k8s.io |
| Monitoring | Falco | Falco rules |
| Monitoring | 컨테이너 불변성 | readOnlyRootFilesystem |
| Monitoring | 런타임 탐지 | Sysdig, Falco |
