# CKS 핵심 개념 정리

CKS 시험의 6개 도메인에 해당하는 모든 핵심 개념을 정리한 문서이다. 각 도메인의 출제 비율과 세부 토픽을 체계적으로 다룬다. CKS는 쿠버네티스 자격증 중 가장 어려운 실기 시험으로, 보안 도구 생태계에 대한 깊이 있는 이해가 필수적이다.

---

## 1. Cluster Setup (10%)

클러스터의 기본 보안 설정을 다루는 도메인이다. 출제 비율은 낮지만, 기본적인 내용이므로 반드시 득점해야 하는 영역이다.

### 1.1 NetworkPolicy로 클러스터 접근 제어

NetworkPolicy는 Pod 간 네트워크 트래픽을 제어하는 쿠버네티스 리소스이다. CKS에서 가장 빈번하게 출제되는 주제 중 하나이다.

**핵심 개념:**
- NetworkPolicy는 네임스페이스 단위로 적용된다
- NetworkPolicy가 없으면 모든 트래픽이 허용된다 (default allow all)
- NetworkPolicy가 하나라도 적용되면, 해당 정책에 명시되지 않은 트래픽은 차단된다
- `podSelector: {}`는 해당 네임스페이스의 모든 Pod를 선택한다
- Ingress(인바운드)와 Egress(아웃바운드)를 각각 또는 동시에 제어할 수 있다

**NetworkPolicy 구성 요소:**
- `spec.podSelector`: 정책이 적용될 대상 Pod를 라벨로 선택한다
- `spec.policyTypes`: Ingress, Egress, 또는 둘 다 지정한다
- `spec.ingress`: 허용할 인바운드 트래픽 소스를 정의한다
- `spec.egress`: 허용할 아웃바운드 트래픽 대상을 정의한다
- `from`/`to` 내에 `podSelector`, `namespaceSelector`, `ipBlock`을 사용할 수 있다

**주의 사항:**
- NetworkPolicy는 CNI 플러그인이 지원해야 동작한다 (Calico, Cilium, Weave Net 등)
- Flannel은 NetworkPolicy를 지원하지 않는다
- `namespaceSelector`와 `podSelector`를 같은 `from` 항목에 넣으면 AND 조건이다
- 별도의 `from` 항목으로 분리하면 OR 조건이다

**Default Deny All 전략:**
- 보안의 기본 원칙은 "기본 차단, 필요한 것만 허용"이다
- 모든 네임스페이스에 default deny all ingress/egress 정책을 먼저 적용하고, 필요한 트래픽만 개별적으로 허용하는 것이 권장된다
- DNS(포트 53) 트래픽을 허용하지 않으면 서비스 디스커버리가 작동하지 않으므로 주의해야 한다

### 1.2 CIS Benchmark (kube-bench)

CIS(Center for Internet Security) Benchmark는 쿠버네티스 클러스터의 보안 설정을 점검하는 표준 가이드라인이다. kube-bench는 CIS Benchmark를 자동으로 점검하는 도구이다.

**kube-bench 사용법:**
```bash
# 마스터 노드 점검
kube-bench run --targets master

# 워커 노드 점검
kube-bench run --targets node

# 특정 체크 항목만 점검
kube-bench run --targets master --check 1.2.1,1.2.2

# JSON 형식으로 결과 출력
kube-bench run --targets master --json
```

**주요 체크 항목 (시험 빈출):**

| 체크 ID | 내용 | 관련 설정 |
|---------|------|-----------|
| 1.2.1 | anonymous-auth 비활성화 | `--anonymous-auth=false` |
| 1.2.2 | basic-auth 비활성화 | `--basic-auth-file` 제거 |
| 1.2.6 | kubelet 인증서 인증 | `--kubelet-certificate-authority` |
| 1.2.16 | admission controller 활성화 | `--enable-admission-plugins` |
| 1.2.18 | insecure-bind-address 비활성화 | `--insecure-bind-address` 제거 |
| 1.2.19 | insecure-port 비활성화 | `--insecure-port=0` |
| 1.2.20 | audit-log 활성화 | `--audit-log-path` |
| 1.2.29 | etcd TLS 설정 | `--etcd-certfile`, `--etcd-keyfile` |
| 4.2.1 | kubelet anonymous auth | `authentication.anonymous.enabled: false` |
| 4.2.2 | kubelet authorization mode | `authorization.mode: Webhook` |

**kube-bench 결과 해석:**
- `[PASS]`: 보안 기준을 충족한다
- `[FAIL]`: 보안 기준을 충족하지 않는다. 수정이 필요하다
- `[WARN]`: 수동 점검이 필요하다
- `[INFO]`: 참고 정보이다

**CKS 시험에서의 활용:**
- kube-bench를 실행하고 실패한 항목을 수정하는 문제가 출제된다
- 주로 API server, kubelet의 설정 파일을 수정해야 한다
- 수정 후 서비스를 재시작하고 kube-bench를 다시 실행하여 PASS를 확인해야 한다

### 1.3 Ingress TLS 설정

Ingress 리소스에 TLS를 적용하여 외부 트래픽을 암호화하는 설정이다.

**설정 절차:**
1. TLS 인증서와 키를 생성한다 (또는 기존 것을 사용한다)
2. 인증서와 키를 쿠버네티스 Secret으로 생성한다 (type: kubernetes.io/tls)
3. Ingress 리소스에 TLS 설정을 추가한다

**핵심 포인트:**
- Secret 타입은 `kubernetes.io/tls`이어야 한다
- Secret에는 `tls.crt`와 `tls.key` 키가 있어야 한다
- Ingress의 `spec.tls[].secretName`에 Secret 이름을 지정한다
- `spec.tls[].hosts`에 TLS를 적용할 호스트명을 지정한다
- TLS Secret은 Ingress와 같은 네임스페이스에 있어야 한다

### 1.4 노드 메타데이터 보호

클라우드 환경(AWS, GCP, Azure)에서 실행되는 쿠버네티스 노드는 클라우드 인스턴스 메타데이터 API에 접근할 수 있다. 이 메타데이터에는 IAM 자격 증명, 네트워크 설정 등 민감한 정보가 포함되어 있으므로 Pod에서의 접근을 차단해야 한다.

**클라우드별 메타데이터 엔드포인트:**
- AWS: `http://169.254.169.254/latest/meta-data/`
- GCP: `http://metadata.google.internal/` 또는 `http://169.254.169.254/`
- Azure: `http://169.254.169.254/metadata/`

**차단 방법:**
- NetworkPolicy로 해당 IP(169.254.169.254)로의 Egress 트래픽을 차단한다
- 이것이 CKS 시험에서 가장 자주 출제되는 방식이다

### 1.5 Dashboard 보안, GUI 접근 제한

Kubernetes Dashboard는 웹 기반 UI로, 보안 설정이 미흡하면 심각한 보안 위협이 된다.

**보안 권장사항:**
- Dashboard를 인터넷에 직접 노출하지 않아야 한다
- `--enable-skip-login` 플래그를 제거하여 로그인 우회를 방지해야 한다
- Dashboard의 ServiceAccount에 최소 권한만 부여해야 한다 (cluster-admin 바인딩 금지)
- NodePort 대신 ClusterIP 타입으로 서비스를 노출하고 kubectl proxy를 사용해야 한다
- Dashboard에 접근 가능한 네임스페이스를 제한해야 한다

### 1.6 바이너리 검증

kubelet, kubectl 등 쿠버네티스 바이너리의 무결성을 sha512sum으로 검증하는 방법이다.

**검증 절차:**
```bash
# 1. 바이너리의 해시값 계산
sha512sum /usr/bin/kubelet

# 2. 공식 릴리스의 해시값 다운로드
curl -LO https://dl.k8s.io/v1.29.0/bin/linux/amd64/kubelet.sha512

# 3. 해시값 비교
echo "$(cat kubelet.sha512)  /usr/bin/kubelet" | sha512sum --check
```

**CKS 시험에서의 활용:**
- 특정 바이너리가 변조되었는지 확인하는 문제가 출제된다
- `sha512sum`으로 계산한 해시값을 공식 해시값과 비교해야 한다
- 해시값이 다르면 바이너리가 변조된 것이므로, 공식 바이너리로 교체해야 한다

---

## 2. Cluster Hardening (15%)

클러스터 접근 제어와 강화를 다루는 도메인이다. RBAC과 ServiceAccount 보안이 핵심이다.

### 2.1 RBAC 최소 권한 원칙 (Least Privilege)

RBAC(Role-Based Access Control)은 쿠버네티스에서 인증된 사용자/서비스의 권한을 제어하는 메커니즘이다. CKS에서는 "최소 권한 원칙"에 따라 RBAC을 설정하는 능력을 평가한다.

**RBAC 4가지 리소스:**

| 리소스 | 범위 | 용도 |
|--------|------|------|
| Role | 네임스페이스 | 특정 네임스페이스 내 권한 정의 |
| ClusterRole | 클러스터 전체 | 클러스터 전체 또는 비네임스페이스 리소스 권한 정의 |
| RoleBinding | 네임스페이스 | Role/ClusterRole을 사용자/그룹/SA에 바인딩 |
| ClusterRoleBinding | 클러스터 전체 | ClusterRole을 클러스터 전체에 바인딩 |

**최소 권한 원칙 적용:**
- `*` (와일드카드) 사용을 피하고, 필요한 verb와 resource만 명시적으로 지정한다
- `cluster-admin` ClusterRole 바인딩은 최소화한다
- 가능하면 ClusterRoleBinding보다 RoleBinding을 사용하여 범위를 제한한다
- `resourceNames`를 사용하여 특정 리소스에만 접근을 허용할 수 있다

**주요 verb 목록:**
- `get`: 특정 리소스 조회
- `list`: 리소스 목록 조회
- `watch`: 리소스 변경 감시
- `create`: 리소스 생성
- `update`: 리소스 수정
- `patch`: 리소스 부분 수정
- `delete`: 리소스 삭제
- `deletecollection`: 리소스 일괄 삭제

**CKS 시험에서의 활용:**
- 과도한 권한이 부여된 Role/ClusterRole을 식별하고 최소 권한으로 수정하는 문제가 출제된다
- `kubectl auth can-i` 명령으로 권한을 확인하는 방법을 알아야 한다:
  ```bash
  kubectl auth can-i create pods --as=system:serviceaccount:default:mysa
  kubectl auth can-i '*' '*' --as=system:serviceaccount:kube-system:default
  ```

### 2.2 ServiceAccount 보안

ServiceAccount는 Pod 내에서 실행되는 프로세스가 API server와 통신할 때 사용하는 자격 증명이다. 보안을 위해 불필요한 ServiceAccount 토큰 마운트를 비활성화해야 한다.

**핵심 설정:**

1. **automountServiceAccountToken: false**
   - ServiceAccount 또는 Pod에서 이 필드를 `false`로 설정하면 토큰이 자동 마운트되지 않는다
   - Pod에서의 설정이 ServiceAccount에서의 설정보다 우선한다
   - API server에 접근할 필요가 없는 Pod에는 반드시 비활성화해야 한다

2. **default ServiceAccount 사용 금지**
   - 모든 네임스페이스에는 `default` ServiceAccount가 자동 생성된다
   - `default` SA에는 추가 권한을 부여하지 않아야 한다
   - 워크로드별로 전용 ServiceAccount를 생성하고 최소 권한만 부여해야 한다

3. **TokenRequestAPI 사용 (Bound Service Account Token)**
   - K8s 1.22+에서는 시간 제한이 있는 바운드 토큰이 기본으로 사용된다
   - projected volume으로 토큰의 만료 시간과 audience를 설정할 수 있다
   - 만료 시간이 없는 시크릿 기반 토큰보다 안전하다

### 2.3 API Server 접근 제한

API Server는 쿠버네티스 클러스터의 중심 컴포넌트로, 모든 요청이 이곳을 거친다. 보안 강화를 위해 다양한 설정을 적용해야 한다.

**핵심 설정 플래그:**

| 플래그 | 권장 값 | 설명 |
|--------|---------|------|
| `--anonymous-auth` | `false` | 익명 요청 거부 |
| `--authorization-mode` | `Node,RBAC` | Node/RBAC 인가 모드 사용 |
| `--enable-admission-plugins` | (아래 참조) | Admission Controller 활성화 |
| `--insecure-port` | `0` | 비암호화 포트 비활성화 |
| `--profiling` | `false` | 프로파일링 비활성화 |
| `--audit-log-path` | `/var/log/audit.log` | 감사 로그 경로 |
| `--audit-log-maxage` | `30` | 감사 로그 보존 일수 |
| `--audit-log-maxbackup` | `10` | 감사 로그 백업 수 |
| `--audit-log-maxsize` | `100` | 감사 로그 최대 크기(MB) |
| `--kubelet-certificate-authority` | (CA 경로) | kubelet 인증서 검증 |

**필수 Admission Controller:**
- `NodeRestriction`: kubelet이 자신의 노드와 해당 노드에서 실행 중인 Pod만 수정할 수 있도록 제한한다
- `PodSecurity`: Pod Security Standards를 적용한다
- `ImagePolicyWebhook`: 이미지 정책 검증을 위한 외부 웹훅을 호출한다

**설정 수정 방법:**
```bash
# 1. API server 매니페스트 백업
cp /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/kube-apiserver.yaml.bak

# 2. 매니페스트 수정
vi /etc/kubernetes/manifests/kube-apiserver.yaml

# 3. API server 자동 재시작 대기 (static pod이므로 kubelet이 감지)
watch crictl ps | grep kube-apiserver

# 4. API server 정상 동작 확인
kubectl get nodes
```

### 2.4 업그레이드를 통한 보안 패치 적용

쿠버네티스는 주기적으로 보안 패치를 포함한 업데이트를 릴리스한다. 최신 보안 패치를 적용하기 위해 클러스터를 업그레이드하는 방법을 알아야 한다.

**kubeadm 업그레이드 절차:**
```bash
# 1. 업그레이드 가능 버전 확인
kubeadm upgrade plan

# 2. kubeadm 업그레이드 (컨트롤 플레인 노드)
apt-get update
apt-get install -y kubeadm=1.29.x-*
kubeadm upgrade apply v1.29.x

# 3. 노드 드레인
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data

# 4. kubelet, kubectl 업그레이드
apt-get install -y kubelet=1.29.x-* kubectl=1.29.x-*
systemctl daemon-reload
systemctl restart kubelet

# 5. 노드 uncordon
kubectl uncordon <node-name>
```

**핵심 포인트:**
- 한 번에 한 마이너 버전씩만 업그레이드해야 한다 (예: 1.28 -> 1.29)
- 컨트롤 플레인 노드를 먼저 업그레이드한 후 워커 노드를 업그레이드한다
- 업그레이드 전 etcd 백업을 권장한다

### 2.5 kubeconfig 보안 관리

kubeconfig 파일은 클러스터 접근 자격 증명을 포함하고 있으므로 보안 관리가 중요하다.

**보안 권장사항:**
- kubeconfig 파일의 권한을 `600`(소유자만 읽기/쓰기)으로 설정한다
- 클라이언트 인증서/키를 파일로 참조할 때 해당 파일의 권한도 제한한다
- 불필요한 context는 제거한다
- kubeconfig에 인라인으로 포함된 인증서/키를 주기적으로 갱신한다
- kubeconfig 파일을 버전 관리 시스템(Git)에 커밋하지 않아야 한다

---

## 3. System Hardening (15%)

운영체제와 시스템 수준의 보안 강화를 다루는 도메인이다. 리눅스 보안 모듈(AppArmor, seccomp)에 대한 이해가 핵심이다.

### 3.1 OS 최소 설치, 불필요한 패키지/서비스 제거

쿠버네티스 노드에는 필요한 최소한의 패키지와 서비스만 설치해야 한다. 공격 표면(Attack Surface)을 줄이는 것이 목적이다.

**점검 및 제거 방법:**
```bash
# 불필요한 서비스 확인
systemctl list-units --type=service --state=running

# 서비스 중지 및 비활성화
systemctl stop <service-name>
systemctl disable <service-name>

# 불필요한 패키지 제거
apt-get remove --purge <package-name>

# 열려 있는 포트 확인
ss -tlnp
netstat -tlnp

# 불필요한 사용자 확인
cat /etc/passwd
```

**주요 원칙:**
- 노드에서 실행되는 서비스는 kubelet, container runtime, kube-proxy 등 필수 서비스로 제한한다
- SSH 접근은 필요한 경우에만 허용하고, 키 기반 인증만 사용한다
- 불필요한 커널 모듈은 비활성화한다

### 3.2 AppArmor 프로파일 작성 및 적용

AppArmor는 리눅스 커널 보안 모듈로, 프로그램별로 파일, 네트워크, 프로세스 등에 대한 접근을 제한한다. CKS에서 자주 출제되는 주제이다.

**AppArmor 모드:**
- `enforce`: 정책을 강제 적용한다. 위반 시 차단하고 로그를 기록한다
- `complain`: 위반 시 로그만 기록하고 차단하지 않는다 (디버깅용)
- `unconfined`: AppArmor 정책이 적용되지 않는다

**프로파일 작성 예시:**
```
#include <tunables/global>

profile k8s-deny-write flags=(attach_disconnected) {
  #include <abstractions/base>

  file,

  # 모든 파일 쓰기 거부
  deny /** w,

  # /tmp에만 쓰기 허용
  /tmp/** rw,
}
```

**프로파일 관리 명령어:**
```bash
# 프로파일 로드 (enforce 모드)
apparmor_parser -r /etc/apparmor.d/k8s-deny-write

# 프로파일 로드 (complain 모드)
apparmor_parser -C /etc/apparmor.d/k8s-deny-write

# 로드된 프로파일 확인
aa-status

# 프로파일 제거
apparmor_parser -R /etc/apparmor.d/k8s-deny-write
```

**Pod에 AppArmor 적용 (K8s 1.30+):**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  securityContext:
    appArmorProfile:
      type: Localhost
      localhostProfile: k8s-deny-write
  containers:
  - name: app
    image: nginx
```

**Pod에 AppArmor 적용 (K8s 1.29 이하, annotation 방식):**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
  annotations:
    container.apparmor.security.beta.kubernetes.io/app: localhost/k8s-deny-write
spec:
  containers:
  - name: app
    image: nginx
```

**중요 포인트:**
- AppArmor 프로파일은 Pod가 스케줄링되는 **노드**에 로드되어 있어야 한다
- 프로파일이 로드되지 않은 노드에서 Pod가 실행되면 에러가 발생한다
- K8s 1.30부터 securityContext 방식이 GA로 승격되었다. 시험 버전에 따라 annotation 방식 또는 securityContext 방식을 사용한다

### 3.3 seccomp 프로파일

seccomp(Secure Computing Mode)는 컨테이너에서 사용할 수 있는 시스템콜을 제한하는 리눅스 커널 기능이다.

**seccomp 프로파일 타입:**

| 타입 | 설명 |
|------|------|
| `RuntimeDefault` | 컨테이너 런타임의 기본 프로파일 사용 (권장) |
| `Localhost` | 노드의 로컬 프로파일 파일 사용 |
| `Unconfined` | seccomp 미적용 (비권장) |

**프로파일 구조 (JSON):**
```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": ["SCMP_ARCH_X86_64"],
  "syscalls": [
    {
      "names": ["read", "write", "open", "close", "stat", "fstat", "mmap", "mprotect", "exit_group"],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

**프로파일 액션:**
- `SCMP_ACT_ALLOW`: 시스템콜 허용
- `SCMP_ACT_ERRNO`: 시스템콜 차단 (에러 반환)
- `SCMP_ACT_LOG`: 시스템콜 로그 기록 (허용)
- `SCMP_ACT_KILL`: 시스템콜 차단 (프로세스 종료)

**Pod에 seccomp 적용:**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: nginx
```

**Localhost 프로파일 사용:**
```yaml
spec:
  securityContext:
    seccompProfile:
      type: Localhost
      localhostProfile: profiles/my-profile.json
```
- Localhost 프로파일 파일은 노드의 `/var/lib/kubelet/seccomp/` 디렉토리에 위치해야 한다
- `localhostProfile`은 해당 디렉토리의 상대 경로이다

### 3.4 Syscall 제한 원리

시스템콜(Syscall)은 프로세스가 커널에 서비스를 요청하는 인터페이스이다. 불필요한 시스템콜을 차단하면 공격 표면을 줄일 수 있다.

**주요 시스템콜 카테고리:**
- **파일 관련**: `open`, `read`, `write`, `close`, `stat`, `chmod`, `chown`
- **프로세스 관련**: `fork`, `execve`, `exit`, `kill`, `ptrace`
- **네트워크 관련**: `socket`, `bind`, `listen`, `accept`, `connect`
- **시스템 관련**: `mount`, `umount`, `reboot`, `sethostname`

**위험한 시스템콜 (차단 권장):**
- `ptrace`: 다른 프로세스 디버깅/추적 (컨테이너 이스케이프에 악용 가능)
- `mount`: 파일시스템 마운트 (호스트 파일시스템 접근에 악용 가능)
- `reboot`: 시스템 재부팅
- `sethostname`: 호스트명 변경
- `unshare`: 네임스페이스 생성 (권한 상승에 악용 가능)

### 3.5 IAM 역할 관리, 최소 권한

클라우드 환경에서 쿠버네티스 노드와 Pod에 할당되는 IAM(Identity and Access Management) 역할을 최소 권한으로 관리해야 한다.

**원칙:**
- 노드 IAM 역할에는 필수 권한만 부여한다 (EC2, ECR, ELB 관련)
- Pod별로 서로 다른 IAM 역할이 필요하면 IRSA(IAM Roles for Service Accounts) 또는 Workload Identity를 사용한다
- 노드 IAM 역할에 S3, DynamoDB 등 애플리케이션 레벨 권한을 부여하지 않아야 한다
- 정기적으로 미사용 IAM 역할과 정책을 검토하고 제거해야 한다

---

## 4. Minimize Microservice Vulnerabilities (20%)

마이크로서비스의 취약점을 최소화하는 도메인이다. 전체 출제 비율의 20%를 차지하며, Pod Security, OPA Gatekeeper, Secret 관리 등 다양한 주제를 다룬다.

### 4.1 Pod Security Standards (Privileged/Baseline/Restricted)

Pod Security Standards는 쿠버네티스에서 Pod의 보안 수준을 정의하는 세 가지 정책 레벨이다.

**세 가지 레벨:**

| 레벨 | 설명 | 사용 사례 |
|------|------|-----------|
| **Privileged** | 제한 없음. 모든 권한 허용 | 시스템 데몬, CNI 플러그인 |
| **Baseline** | 알려진 위험한 설정만 차단. 최소한의 보안 | 일반 워크로드 기본 정책 |
| **Restricted** | 가장 엄격한 보안 정책. Pod 강화 모범 사례 적용 | 보안에 민감한 워크로드 |

**Baseline 레벨에서 차단하는 항목:**
- `hostNetwork: true`
- `hostPID: true`
- `hostIPC: true`
- `privileged: true`
- `hostPath` 볼륨
- 위험한 capabilities (NET_RAW 제외한 추가 capabilities)
- hostPort 사용

**Restricted 레벨에서 추가로 요구하는 항목:**
- `runAsNonRoot: true` 필수
- `allowPrivilegeEscalation: false` 필수
- `seccompProfile.type: RuntimeDefault` 또는 `Localhost` 필수
- capabilities를 `ALL` drop 후 필요한 것만 add
- 볼륨 타입 제한 (configMap, emptyDir, secret 등만 허용)

### 4.2 Pod Security Admission (enforce/audit/warn 모드)

Pod Security Admission은 Pod Security Standards를 네임스페이스 단위로 적용하는 빌트인 Admission Controller이다. PodSecurityPolicy(PSP)의 후속 메커니즘이다.

**세 가지 모드:**

| 모드 | 동작 |
|------|------|
| `enforce` | 위반하는 Pod 생성을 **거부**한다 |
| `audit` | 위반을 감사 로그에 기록하지만 Pod 생성은 허용한다 |
| `warn` | 사용자에게 경고 메시지를 표시하지만 Pod 생성은 허용한다 |

**네임스페이스에 적용:**
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: secure-ns
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

**핵심 포인트:**
- 라벨 형식: `pod-security.kubernetes.io/<mode>: <level>`
- 버전 고정 가능: `pod-security.kubernetes.io/<mode>-version: v1.29`
- `latest`를 사용하면 클러스터 버전에 따라 자동으로 최신 기준이 적용된다
- enforce 모드를 적용하기 전에 audit/warn 모드로 먼저 테스트하는 것이 권장된다
- kube-system 등 시스템 네임스페이스에는 privileged를 유지해야 한다

### 4.3 OPA Gatekeeper (ConstraintTemplate, Constraint)

OPA(Open Policy Agent) Gatekeeper는 쿠버네티스에서 정책을 코드로 정의하고 적용하는 Admission Controller이다. Rego 언어로 정책을 작성한다.

**아키텍처:**
- **ConstraintTemplate**: 정책의 "템플릿"을 정의한다. Rego 코드와 파라미터 스키마를 포함한다
- **Constraint**: ConstraintTemplate을 기반으로 실제 정책 인스턴스를 생성한다. 파라미터 값과 적용 대상을 지정한다

**Rego 기본 문법:**
```rego
package k8srequiredlabels

violation[{"msg": msg}] {
  provided := {label | input.review.object.metadata.labels[label]}
  required := {label | label := input.parameters.labels[_]}
  missing := required - provided
  count(missing) > 0
  msg := sprintf("필수 라벨 누락: %v", [missing])
}
```

**CKS 시험에서의 활용:**
- ConstraintTemplate과 Constraint를 작성하는 문제가 출제된다
- 주로 허용된 레지스트리 제한, 필수 라벨 검증 등의 정책이 출제된다
- Rego 문법을 완벽히 외울 필요는 없지만, 기본 구조는 이해해야 한다
- `input.review.object`가 검사 대상 쿠버네티스 리소스를 나타낸다는 것을 알아야 한다

### 4.4 Secret 관리

쿠버네티스 Secret은 기본적으로 base64 인코딩만 되어 있어 보안이 충분하지 않다. 추가적인 보안 조치가 필요하다.

**Secret 보안 강화 방법:**

1. **Encryption at Rest (유휴 시 암호화)**
   - etcd에 저장되는 Secret 데이터를 암호화한다
   - EncryptionConfiguration을 작성하고 API server에 적용한다
   - 암호화 프로바이더: `aescbc`, `aesgcm`, `secretbox`, `kms`(권장)

2. **외부 Secret 관리 도구:**
   - **HashiCorp Vault**: 중앙 집중형 시크릿 관리. Vault Agent Injector를 통해 Pod에 시크릿 주입
   - **Sealed Secrets**: 클러스터 외부에서 암호화된 SealedSecret을 생성하고, 클러스터 내에서 컨트롤러가 복호화하여 Secret 생성
   - **External Secrets Operator**: AWS Secrets Manager, GCP Secret Manager 등 외부 시크릿 저장소와 연동

3. **Secret 접근 제한:**
   - RBAC으로 Secret에 대한 get/list/watch 권한을 제한한다
   - Secret을 사용하는 네임스페이스를 제한한다

### 4.5 RuntimeClass (gVisor/runsc, Kata Containers)

RuntimeClass는 Pod에서 사용할 컨테이너 런타임을 지정하는 쿠버네티스 리소스이다. 기본 runc 대신 보안이 강화된 런타임을 사용할 수 있다.

**주요 샌드박스 런타임:**

| 런타임 | 설명 | handler 이름 |
|--------|------|-------------|
| **gVisor (runsc)** | 사용자 공간에서 시스템콜을 인터셉트하여 커널 격리를 제공한다 | `runsc` |
| **Kata Containers** | 경량 VM으로 컨테이너를 실행하여 하드웨어 레벨 격리를 제공한다 | `kata` |

**RuntimeClass 정의:**
```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
```

**Pod에서 RuntimeClass 사용:**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: sandboxed-pod
spec:
  runtimeClassName: gvisor
  containers:
  - name: app
    image: nginx
```

**CKS 시험에서의 활용:**
- RuntimeClass를 생성하고 Pod에 적용하는 문제가 출제된다
- handler 이름은 노드의 containerd 설정(`/etc/containerd/config.toml`)에 정의된 런타임과 일치해야 한다

### 4.6 mTLS (Istio 서비스 메시)

mTLS(mutual TLS)는 클라이언트와 서버가 상호 인증하는 TLS 통신이다. Istio 서비스 메시를 통해 마이크로서비스 간 mTLS를 자동으로 적용할 수 있다.

**Istio mTLS 모드:**
- `STRICT`: mTLS만 허용. 평문 트래픽 거부
- `PERMISSIVE`: mTLS와 평문 모두 허용 (마이그레이션 시 사용)
- `DISABLE`: mTLS 비활성화

**PeerAuthentication으로 mTLS 적용:**
```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: istio-system  # 전역 적용
spec:
  mtls:
    mode: STRICT
```

**핵심 포인트:**
- Istio는 사이드카 프록시(Envoy)를 Pod에 자동 주입하여 mTLS를 처리한다
- 서비스 간 통신이 자동으로 암호화되므로 애플리케이션 코드 변경 없이 mTLS를 적용할 수 있다
- CKS에서는 Istio 설치/운영보다는 mTLS의 개념과 PeerAuthentication 리소스 이해를 평가한다

---

## 5. Supply Chain Security (20%)

소프트웨어 공급망 보안을 다루는 도메인이다. 컨테이너 이미지의 빌드, 스캔, 서명, 검증 등을 포함한다.

### 5.1 이미지 취약점 스캔 (Trivy)

Trivy는 Aqua Security에서 개발한 오픈소스 취약점 스캐너이다. 컨테이너 이미지, 파일시스템, Git 리포지토리 등을 스캔할 수 있다.

**기본 사용법:**
```bash
# 이미지 스캔
trivy image nginx:1.21

# 심각도 필터링
trivy image --severity CRITICAL,HIGH nginx:1.21

# CI/CD 파이프라인에서 사용 (취약점 발견 시 빌드 실패)
trivy image --exit-code 1 --severity CRITICAL nginx:1.21

# 특정 취약점만 무시
trivy image --ignore-unfixed nginx:1.21

# JSON 출력
trivy image --format json -o result.json nginx:1.21

# 파일시스템 스캔
trivy fs /path/to/project

# SBOM 생성
trivy image --format cyclonedx -o sbom.json nginx:1.21
```

**심각도 레벨:**
| 레벨 | 설명 |
|------|------|
| CRITICAL | 즉시 수정 필요. 원격 코드 실행 등 심각한 위협 |
| HIGH | 빠른 수정 필요 |
| MEDIUM | 계획된 업데이트에서 수정 |
| LOW | 위험도 낮음 |
| UNKNOWN | 심각도 미분류 |

**CKS 시험에서의 활용:**
- 이미지를 스캔하고 특정 심각도 이상의 취약점이 있는 이미지를 식별하는 문제가 출제된다
- `--severity`와 `--exit-code` 옵션을 사용하는 방법을 알아야 한다

### 5.2 ImagePolicyWebhook

ImagePolicyWebhook은 Admission Controller의 하나로, Pod가 사용하는 컨테이너 이미지를 외부 웹훅 서비스를 통해 검증한다.

**설정 구성 요소:**
1. **AdmissionConfiguration**: 웹훅 설정 파일 경로를 지정한다
2. **ImageReview webhook config**: 웹훅 서비스의 URL, TLS 설정 등을 정의한다
3. **API server 플래그**: `--enable-admission-plugins=ImagePolicyWebhook`과 `--admission-control-config-file`을 설정한다

**동작 방식:**
1. Pod 생성 요청이 들어온다
2. API server가 ImagePolicyWebhook을 호출한다
3. 웹훅이 ImageReview 요청을 받아 이미지를 검증한다
4. 검증 결과(allowed: true/false)를 반환한다
5. API server가 결과에 따라 Pod 생성을 허용/거부한다

**핵심 설정:**
- `defaultAllow`: 웹훅이 응답하지 않을 때 기본 동작 (true: 허용, false: 거부)
- 보안 관점에서 `defaultAllow: false`가 권장된다 (fail-closed)

### 5.3 이미지 서명/검증 (Cosign, Notary/TUF)

컨테이너 이미지의 무결성과 출처를 검증하기 위해 이미지에 서명하고, 배포 시 서명을 검증하는 프로세스이다.

**Cosign (Sigstore 프로젝트):**
```bash
# 키 쌍 생성
cosign generate-key-pair

# 이미지 서명
cosign sign --key cosign.key <image-reference>

# 서명 검증
cosign verify --key cosign.pub <image-reference>

# 키 없는 서명 (OIDC 기반, keyless signing)
cosign sign <image-reference>
cosign verify --certificate-identity=email@example.com --certificate-oidc-issuer=https://accounts.google.com <image-reference>
```

**Notary/TUF:**
- The Update Framework(TUF) 기반의 이미지 서명 프레임워크이다
- Docker Content Trust(DCT)의 기반 기술이다
- `DOCKER_CONTENT_TRUST=1` 환경변수를 설정하면 서명된 이미지만 pull할 수 있다

### 5.4 Allowlist 레지스트리 (OPA로 허용된 레지스트리만 허용)

신뢰할 수 있는 컨테이너 레지스트리에서만 이미지를 pull하도록 제한하는 정책이다. OPA Gatekeeper로 구현한다.

**구현 방식:**
- ConstraintTemplate에서 이미지 레지스트리를 검사하는 Rego 정책을 작성한다
- Constraint에서 허용할 레지스트리 목록을 파라미터로 전달한다
- Pod의 `spec.containers[].image`와 `spec.initContainers[].image`를 모두 검사해야 한다

### 5.5 Dockerfile 보안

Dockerfile을 작성할 때 보안을 고려해야 한다.

**보안 모범 사례:**
1. **non-root USER 사용**: `USER 1000:1000` 또는 `USER appuser`
2. **최소 베이스 이미지**: `scratch`, `distroless`, `alpine` 사용
3. **멀티스테이지 빌드**: 빌드 도구를 최종 이미지에 포함하지 않는다
4. **COPY vs ADD**: `ADD`보다 `COPY`를 사용한다 (`ADD`는 URL 다운로드, tar 해제 등 예상치 못한 동작 가능)
5. **패키지 버전 고정**: `apt-get install -y curl=7.68.0-1` 형태로 버전을 고정한다
6. **HEALTHCHECK 추가**: 컨테이너 상태 확인을 위한 HEALTHCHECK를 정의한다
7. **불필요한 파일 제거**: `.dockerignore`로 민감한 파일을 이미지에 포함시키지 않는다
8. **최신 태그 사용 금지**: `latest` 대신 특정 버전 태그를 사용한다

**CKS 시험에서의 활용:**
- 주어진 Dockerfile에서 보안 문제를 식별하고 수정하는 문제가 출제된다
- 주로 root 유저 실행, 불필요한 패키지, 부적절한 베이스 이미지 등을 수정해야 한다

### 5.6 Static Analysis (kubesec, conftest, checkov)

쿠버네티스 매니페스트와 IaC(Infrastructure as Code) 파일의 보안을 정적으로 분석하는 도구들이다.

**kubesec:**
```bash
# 매니페스트 보안 점수 계산
kubesec scan pod.yaml

# 온라인 스캔
curl -sSX POST --data-binary @pod.yaml https://v2.kubesec.io/scan
```

**conftest:**
```bash
# OPA 기반 정책 테스트
conftest test deployment.yaml --policy policy/
```

**checkov:**
```bash
# 쿠버네티스 매니페스트 스캔
checkov -f deployment.yaml

# 디렉토리 스캔
checkov -d k8s-manifests/
```

### 5.7 SBOM (Software Bill of Materials)

SBOM은 소프트웨어를 구성하는 모든 컴포넌트(라이브러리, 의존성 등)의 목록이다. 공급망 보안의 핵심 요소이다.

**주요 형식:**
- **SPDX**: Linux Foundation에서 관리하는 표준
- **CycloneDX**: OWASP에서 관리하는 표준

**Trivy로 SBOM 생성:**
```bash
trivy image --format spdx-json -o sbom.spdx.json nginx:1.21
trivy image --format cyclonedx -o sbom.cdx.json nginx:1.21
```

**활용:**
- 이미지에 포함된 모든 패키지와 버전을 파악할 수 있다
- 새로운 CVE가 발표되면 SBOM을 기반으로 영향 받는 이미지를 신속하게 식별할 수 있다

---

## 6. Monitoring, Logging and Runtime Security (20%)

런타임 보안 모니터링, 감사 로깅, 이상 탐지를 다루는 도메인이다. Falco와 Audit Policy가 핵심이다.

### 6.1 Audit Policy 설정

쿠버네티스 Audit은 API server를 통과하는 모든 요청을 기록하는 기능이다. 보안 사고 분석, 규정 준수, 이상 탐지에 활용된다.

**4가지 Audit 레벨:**

| 레벨 | 기록 내용 |
|------|-----------|
| `None` | 기록하지 않는다 |
| `Metadata` | 요청의 메타데이터만 기록 (사용자, 타임스탬프, 리소스, verb 등) |
| `Request` | 메타데이터 + 요청 본문 기록 |
| `RequestResponse` | 메타데이터 + 요청 본문 + 응답 본문 기록 |

**Audit Policy 구조:**
```yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # Secret 관련 요청은 RequestResponse 레벨로 기록
  - level: RequestResponse
    resources:
    - group: ""
      resources: ["secrets"]

  # 메타데이터만 기록할 리소스
  - level: Metadata
    resources:
    - group: ""
      resources: ["configmaps", "pods"]

  # 특정 사용자의 요청 제외
  - level: None
    users: ["system:kube-scheduler"]

  # 기본 레벨
  - level: Metadata
```

**규칙 매칭:**
- 규칙은 위에서 아래로 순서대로 평가된다
- 첫 번째로 매칭되는 규칙이 적용된다
- 매칭되는 규칙이 없으면 이벤트가 기록되지 않는다
- 마지막에 catch-all 규칙을 두는 것이 권장된다

**필터링 옵션:**
- `users`: 특정 사용자의 요청만 매칭
- `userGroups`: 특정 그룹의 요청만 매칭
- `verbs`: 특정 동작(get, create, delete 등)만 매칭
- `resources`: 특정 리소스 타입만 매칭
- `namespaces`: 특정 네임스페이스의 리소스만 매칭
- `nonResourceURLs`: `/healthz`, `/version` 등 비리소스 URL 매칭

### 6.2 Audit Log Backend 설정

Audit Policy를 작성했으면 API server에 적용해야 한다. 로그를 파일로 저장하는 Log backend를 설정한다.

**API server 설정:**
```yaml
# /etc/kubernetes/manifests/kube-apiserver.yaml
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

**주의 사항:**
- volumeMounts와 volumes를 모두 설정해야 한다
- hostPath의 파일/디렉토리가 실제로 존재해야 한다
- audit-policy 파일은 readOnly로 마운트하는 것이 권장된다
- 설정 변경 후 API server가 재시작될 때 오류가 발생하지 않는지 확인해야 한다

### 6.3 Falco 아키텍처, 룰 작성

Falco는 CNCF에서 관리하는 런타임 보안 도구로, 시스템콜을 기반으로 이상 행위를 탐지한다.

**아키텍처:**
```
[커널 시스템콜] → [Falco 드라이버 (eBPF/kernel module)] → [Falco 엔진 (룰 매칭)] → [알림 출력]
```

1. **드라이버**: 커널의 시스템콜을 캡처한다 (kernel module 또는 eBPF probe)
2. **라이브러리**: 시스템콜 이벤트를 파싱하고 필터링한다
3. **엔진**: 사전 정의된 룰과 이벤트를 매칭한다
4. **출력**: 매칭된 이벤트를 stdout, 파일, syslog, HTTP 등으로 출력한다

**룰 구성 요소:**

| 필드 | 설명 |
|------|------|
| `rule` | 룰 이름 |
| `desc` | 설명 |
| `condition` | 이벤트 탐지 조건 (필터 표현식) |
| `output` | 알림 출력 메시지 (변수 치환 가능) |
| `priority` | 우선순위 (EMERGENCY, ALERT, CRITICAL, ERROR, WARNING, NOTICE, INFORMATIONAL, DEBUG) |
| `tags` | 분류 태그 |
| `enabled` | 활성화 여부 (true/false) |

**룰 작성 예시:**
```yaml
- rule: Detect Shell in Container
  desc: 컨테이너 내에서 셸 프로세스가 실행되면 탐지한다
  condition: >
    spawned_process and
    container and
    proc.name in (bash, sh, zsh, ksh, csh)
  output: >
    셸이 컨테이너에서 실행됨
    (user=%user.name container_id=%container.id
    container_name=%container.name
    shell=%proc.name parent=%proc.pname
    cmdline=%proc.cmdline image=%container.image.repository)
  priority: WARNING
  tags: [container, shell, mitre_execution]
```

**주요 필터 필드:**
- `proc.name`: 프로세스 이름
- `proc.pname`: 부모 프로세스 이름
- `proc.cmdline`: 전체 명령어
- `fd.name`: 파일 디스크립터 이름 (파일 경로)
- `container.id`: 컨테이너 ID
- `container.name`: 컨테이너 이름
- `container.image.repository`: 컨테이너 이미지
- `user.name`: 사용자 이름
- `evt.type`: 이벤트 타입 (open, connect, execve 등)
- `k8s.pod.name`: Pod 이름
- `k8s.ns.name`: 네임스페이스 이름

**주요 매크로:**
- `spawned_process`: 새로운 프로세스가 생성됨 (`evt.type=execve and evt.dir=<`)
- `container`: 컨테이너 내부 이벤트
- `open_write`: 쓰기 모드로 파일 열기
- `open_read`: 읽기 모드로 파일 열기
- `sensitive_files`: 민감한 파일 경로 (/etc/shadow, /etc/passwd 등)

**Falco 설정 파일:**
- `/etc/falco/falco.yaml`: 메인 설정 (출력, 로그 레벨 등)
- `/etc/falco/falco_rules.yaml`: 기본 룰 파일 (수정하지 않아야 한다)
- `/etc/falco/falco_rules.local.yaml`: 커스텀 룰 파일 (**여기에 추가/오버라이드**)

**CKS 시험에서의 활용:**
- Falco 커스텀 룰을 작성하고 `/etc/falco/falco_rules.local.yaml`에 추가하는 문제가 출제된다
- Falco 로그를 분석하여 이상 행위를 식별하는 문제도 출제될 수 있다
- `falco_rules.yaml`을 직접 수정하지 말고, `falco_rules.local.yaml`에 룰을 추가하거나 오버라이드해야 한다

### 6.4 컨테이너 불변성 (Immutable Infrastructure)

컨테이너는 불변(immutable)으로 운영해야 한다. 실행 중인 컨테이너 내부의 파일을 수정하면 안 된다.

**구현 방법:**

1. **readOnlyRootFilesystem:**
   ```yaml
   securityContext:
     readOnlyRootFilesystem: true
   ```
   - 컨테이너의 루트 파일시스템을 읽기 전용으로 만든다
   - 쓰기가 필요한 디렉토리는 emptyDir 볼륨으로 마운트한다 (/tmp, /var/run 등)

2. **불변성 강화 조합:**
   ```yaml
   securityContext:
     readOnlyRootFilesystem: true
     runAsNonRoot: true
     allowPrivilegeEscalation: false
     capabilities:
       drop: ["ALL"]
   ```

**핵심 포인트:**
- readOnlyRootFilesystem만으로는 볼륨 마운트된 경로에 쓸 수 있다
- emptyDir에 기록된 데이터는 Pod가 삭제되면 사라진다
- 컨테이너 불변성은 보안뿐만 아니라 재현성(reproducibility)도 보장한다

### 6.5 런타임 이상 탐지

런타임에 발생하는 비정상적인 행위를 탐지하는 것이다. Falco가 주요 도구이다.

**탐지 대상 이상 행위:**
- 컨테이너 내에서 예상하지 않은 프로세스 실행 (셸, 패키지 매니저 등)
- 민감한 파일 접근 (/etc/shadow, /etc/passwd, /proc 등)
- 예상하지 않은 네트워크 연결 (외부 IP로의 연결)
- 파일시스템 변경 (바이너리 수정, 새로운 실행 파일 생성)
- 권한 상승 시도 (setuid, setgid)
- 네임스페이스 이스케이프 시도

**탐지 방법:**
1. **Falco 룰**: 위에서 설명한 Falco 룰로 이상 행위를 탐지한다
2. **Audit Log 분석**: API server audit log에서 비정상적인 API 호출을 탐지한다
3. **프로세스 모니터링**: 컨테이너 내 실행 중인 프로세스를 모니터링한다

### 6.6 Sysdig를 이용한 시스템콜 분석

Sysdig는 시스템콜을 캡처하고 분석하는 도구이다. Falco의 기반 기술이기도 하다.

**기본 사용법:**
```bash
# 모든 시스템콜 캡처
sysdig

# 특정 컨테이너의 시스템콜만 캡처
sysdig container.name=nginx

# 파일 열기 이벤트만 필터링
sysdig evt.type=open

# 네트워크 연결 이벤트만 필터링
sysdig evt.type=connect

# 특정 프로세스의 시스템콜 캡처
sysdig proc.name=bash

# 캡처 결과를 파일로 저장
sysdig -w capture.scap

# 저장된 캡처 파일 분석
sysdig -r capture.scap

# chisel(분석 스크립트) 사용
sysdig -c topprocs_cpu  # CPU 사용량 상위 프로세스
sysdig -c topfiles_bytes  # I/O 상위 파일
sysdig -c spy_users  # 사용자 활동 추적
```

**CKS 시험에서의 활용:**
- 특정 컨테이너에서 실행된 프로세스나 접근된 파일을 sysdig/Falco로 분석하는 문제가 출제될 수 있다
- `sysdig -r <capture-file>` 형태로 캡처 파일을 분석하는 문제도 출제될 수 있다

---

## 요약: 도메인별 핵심 키워드

| 도메인 | 핵심 도구/개념 | 비율 |
|--------|---------------|------|
| Cluster Setup | NetworkPolicy, kube-bench, Ingress TLS, 바이너리 검증 | 10% |
| Cluster Hardening | RBAC, ServiceAccount, API Server 설정, kubeadm upgrade | 15% |
| System Hardening | AppArmor, seccomp, OS 최소화, IAM | 15% |
| Microservice Vuln | Pod Security Standards/Admission, OPA Gatekeeper, Secret, RuntimeClass, mTLS | 20% |
| Supply Chain | Trivy, ImagePolicyWebhook, Cosign, Allowlist Registry, Dockerfile, SBOM | 20% |
| Runtime Security | Audit Policy, Falco, readOnlyRootFilesystem, Sysdig | 20% |
