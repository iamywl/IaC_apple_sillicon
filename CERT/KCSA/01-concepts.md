# KCSA 핵심 개념 정리

> KCSA(Kubernetes and Cloud Native Security Associate) 시험의 모든 도메인을 다루는 핵심 개념 정리이다.

---

## 1. Overview of Cloud Native Security (14%)

### 1.1 클라우드 네이티브 보안의 4C

클라우드 네이티브 보안은 4개의 계층(Layer)으로 구성되며, 각 계층은 바깥에서 안쪽으로 보호 범위를 좁혀가는 심층 방어(Defense in Depth) 모델이다.

| 계층 | 설명 | 주요 보안 영역 |
|------|------|---------------|
| **Cloud** | 인프라스트럭처 계층. 클라우드 제공자 또는 데이터센터의 물리적/논리적 보안이다. | IAM, 네트워크 방화벽, 암호화, 감사 로그 |
| **Cluster** | Kubernetes 클러스터 자체의 보안이다. | API Server 인증/인가, etcd 암호화, RBAC, NetworkPolicy |
| **Container** | 컨테이너 이미지 및 런타임 보안이다. | 이미지 스캐닝, 최소 권한 실행, 읽기 전용 파일시스템, seccomp/AppArmor |
| **Code** | 애플리케이션 코드 레벨의 보안이다. | 의존성 스캐닝, 시크릿 관리, TLS 통신, 입력 검증 |

핵심 원칙: 바깥 계층이 뚫려도 안쪽 계층이 추가 방어를 제공해야 한다. 하나의 계층에만 의존하는 것은 단일 실패 지점(Single Point of Failure)을 만드는 것이다.

### 1.2 CNCF Security TAG (Technical Advisory Group)

CNCF Security TAG는 클라우드 네이티브 생태계의 보안 관련 가이드라인, 도구, 모범 사례를 제공하는 기술 자문 그룹이다.

- **역할**: 보안 관련 프로젝트 평가, 보안 백서 발행, 보안 감사 지원이다.
- **주요 산출물**:
  - Cloud Native Security Whitepaper: 클라우드 네이티브 환경에서의 보안 원칙과 모범 사례를 정의한 문서이다.
  - Supply Chain Security Paper: 소프트웨어 공급망 보안에 대한 가이드이다.
  - 보안 관련 CNCF 프로젝트 리뷰 및 평가를 수행한다.
- **관련 프로젝트**: Falco, OPA, TUF(The Update Framework), Notary, SPIFFE/SPIRE 등이 있다.

### 1.3 공격 표면(Attack Surface)

Kubernetes 환경의 주요 공격 표면은 다음과 같다.

| 공격 표면 | 위험 요소 | 완화 방법 |
|----------|----------|----------|
| API Server | 인증되지 않은 접근, 과도한 권한 | 강력한 인증, RBAC, Admission Control |
| etcd | 평문 데이터 저장, 무단 접근 | TLS 통신, 암호화, 접근 제한 |
| kubelet | 익명 접근, 명령 실행 | 인증 활성화, authorization mode webhook |
| 컨테이너 런타임 | 컨테이너 탈출, 권한 상승 | seccomp, AppArmor, 비특권 실행 |
| 네트워크 | Pod 간 무제한 통신, 스니핑 | NetworkPolicy, mTLS, CNI 보안 |
| 이미지 레지스트리 | 변조된 이미지, 취약한 이미지 | 이미지 서명, 스캐닝, Admission webhook |
| 공급망 | 악성 의존성, 빌드 파이프라인 침해 | SBOM, Cosign, SLSA 프레임워크 |

### 1.4 위협 모델링(Threat Modeling)

위협 모델링은 시스템의 잠재적 위협을 체계적으로 식별하고 대응 방안을 수립하는 프로세스이다.

- **목적**: 보안 위협을 사전에 파악하여 설계 단계에서 대응책을 마련하는 것이다.
- **프로세스**:
  1. 자산 식별: 보호해야 할 데이터와 시스템을 파악한다.
  2. 아키텍처 분석: 데이터 흐름도(DFD)를 작성하고 신뢰 경계(Trust Boundary)를 정의한다.
  3. 위협 식별: STRIDE 등의 프레임워크를 사용하여 위협을 분류한다.
  4. 위험 평가: 각 위협의 가능성과 영향도를 평가한다.
  5. 대응책 수립: 위험을 완화하기 위한 보안 통제를 설계한다.

---

## 2. Kubernetes Cluster Component Security (22%)

### 2.1 API Server 보안

API Server는 Kubernetes의 중앙 관리 지점이며, 모든 요청은 다음 3단계를 거쳐 처리된다.

#### 2.1.1 인증(Authentication)

API Server에 접근하는 주체의 신원을 확인하는 단계이다. Kubernetes는 여러 인증 방법을 지원한다.

| 인증 방법 | 설명 | 사용 시나리오 |
|----------|------|-------------|
| **X.509 클라이언트 인증서** | TLS 인증서 기반 인증이다. `--client-ca-file` 플래그로 CA를 지정한다. | 관리자, 컴포넌트 간 통신 |
| **Bearer Token** | 정적 토큰 파일 또는 Bootstrap Token을 사용한다. | 서비스 간 통신, 부트스트랩 |
| **ServiceAccount Token** | Pod에 자동 마운트되는 JWT 토큰이다. API 1.22+에서는 Bound ServiceAccount Token을 사용한다. | Pod 내 API 접근 |
| **OIDC (OpenID Connect)** | 외부 ID 제공자(Google, Azure AD 등)를 통한 인증이다. | 사용자 인증, SSO |
| **Webhook Token** | 외부 인증 서비스로 토큰을 검증한다. | 커스텀 인증 |
| **Authenticating Proxy** | 프록시 서버가 인증을 수행하고 헤더로 사용자 정보를 전달한다. | 기업 인증 시스템 통합 |

중요 보안 설정:
- `--anonymous-auth=false`: 익명 인증을 비활성화한다.
- `--token-auth-file` 사용은 피해야 한다(정적 토큰은 위험하다).
- `--oidc-issuer-url`을 활용한 OIDC 통합을 권장한다.

#### 2.1.2 인가(Authorization)

인증된 주체가 특정 리소스에 대해 수행할 수 있는 작업을 결정하는 단계이다.

| 인가 모드 | 설명 |
|----------|------|
| **RBAC** | Role-Based Access Control. 역할 기반으로 권한을 부여하는 가장 권장되는 방식이다. |
| **ABAC** | Attribute-Based Access Control. 속성 기반 접근 제어이다. 파일 기반이므로 유연성이 떨어진다. |
| **Node** | kubelet의 API 접근을 제한하는 특수 인가 모드이다. NodeRestriction admission plugin과 함께 사용한다. |
| **Webhook** | 외부 서비스에 인가 결정을 위임한다. |
| **AlwaysAllow / AlwaysDeny** | 테스트 용도이다. 프로덕션에서는 절대 사용하지 않아야 한다. |

권장 설정: `--authorization-mode=Node,RBAC` 이다.

#### 2.1.3 Admission Control

인증과 인가를 통과한 요청이 etcd에 저장되기 전에 추가 검증 및 변환을 수행하는 단계이다.

두 가지 유형이 있다:
- **Mutating Admission Webhook**: 요청을 수정할 수 있다(예: 기본값 주입, 사이드카 추가).
- **Validating Admission Webhook**: 요청을 검증하여 승인 또는 거부한다(예: 정책 위반 차단).

주요 내장 Admission Controller:

| 컨트롤러 | 역할 |
|---------|------|
| `NamespaceLifecycle` | 삭제 중인 네임스페이스에 새 오브젝트 생성을 방지한다. |
| `LimitRanger` | Pod/Container에 리소스 기본값과 제한을 적용한다. |
| `ServiceAccount` | Pod에 ServiceAccount를 자동 할당한다. |
| `NodeRestriction` | kubelet이 자신의 노드와 해당 Pod만 수정할 수 있도록 제한한다. |
| `PodSecurity` | Pod Security Standards를 적용한다(PSP의 후속이다). |
| `ResourceQuota` | 네임스페이스의 리소스 사용량을 제한한다. |
| `ValidatingAdmissionPolicy` | CEL 표현식을 사용하여 인라인 검증 정책을 정의한다(1.28+). |

처리 순서: 인증 -> 인가 -> Mutating Admission -> Schema Validation -> Validating Admission -> etcd 저장

### 2.2 etcd 보안

etcd는 Kubernetes의 모든 클러스터 상태를 저장하는 핵심 데이터 저장소이다. 가장 민감한 컴포넌트 중 하나이다.

#### 보안 설정 항목

| 설정 | 설명 | 구성 방법 |
|------|------|----------|
| **TLS 통신** | 클라이언트-서버 및 피어 간 TLS 암호화이다. | `--cert-file`, `--key-file`, `--peer-cert-file`, `--peer-key-file` |
| **클라이언트 인증** | API Server만 etcd에 접근할 수 있도록 클라이언트 인증서를 요구한다. | `--client-cert-auth=true`, `--trusted-ca-file` |
| **암호화 at rest** | etcd에 저장되는 데이터를 암호화한다. | API Server의 `--encryption-provider-config` 플래그 |
| **접근 제한** | etcd 포트(2379, 2380)에 대한 네트워크 접근을 제한한다. | 방화벽 규칙, 별도 네트워크 세그먼트 |
| **백업 암호화** | etcd 스냅샷 백업을 암호화하여 저장한다. | 백업 시 GPG/KMS 암호화 |

#### Encryption at Rest

API Server의 `--encryption-provider-config` 플래그로 EncryptionConfiguration을 지정하면 etcd에 저장되는 리소스를 암호화할 수 있다.

지원되는 암호화 프로바이더:

| 프로바이더 | 설명 |
|----------|------|
| `aescbc` | AES-CBC 암호화이다. 패딩 오라클 공격에 취약할 수 있다. |
| `aesgcm` | AES-GCM 암호화이다. 키 로테이션 시 주의가 필요하다. |
| `kms` (v1/v2) | 외부 KMS(Key Management Service)를 사용한다. 프로덕션에서 가장 권장되는 방식이다. |
| `secretbox` | XSalsa20 + Poly1305 암호화이다. 가장 빠르고 안전한 로컬 암호화이다. |
| `identity` | 암호화하지 않는다(평문). 기본값이다. |

### 2.3 kubelet 보안

kubelet은 각 노드에서 실행되며 Pod의 라이프사이클을 관리하는 에이전트이다. 노드의 컨테이너에 직접 접근할 수 있으므로 보안이 매우 중요하다.

| 설정 | 권장 값 | 설명 |
|------|---------|------|
| `--anonymous-auth` | `false` | 익명 인증을 비활성화하여 인증되지 않은 접근을 차단한다. |
| `--authorization-mode` | `Webhook` | API Server에 인가를 위임한다. `AlwaysAllow`는 절대 사용하지 않는다. |
| `--read-only-port` | `0` | 읽기 전용 포트(기본 10255)를 비활성화한다. 인증 없이 정보를 노출할 수 있다. |
| `--protect-kernel-defaults` | `true` | kubelet이 커널 파라미터를 변경하지 못하도록 한다. |
| `--rotate-certificates` | `true` | 인증서 자동 로테이션을 활성화한다. |
| `--event-qps` | 적절한 값 | 이벤트 생성 속도를 제한하여 DoS를 방지한다. |
| `--tls-cert-file`, `--tls-private-key-file` | 인증서 경로 | kubelet의 HTTPS 서빙에 TLS 인증서를 사용한다. |

kubelet API는 기본적으로 10250 포트(HTTPS)와 10255 포트(HTTP, 읽기 전용)를 사용한다. 10255 포트는 반드시 비활성화해야 한다.

### 2.4 kube-proxy 보안

kube-proxy는 각 노드에서 서비스의 네트워크 규칙을 관리하는 컴포넌트이다.

- **모드**: iptables(기본), IPVS, nftables 중 하나를 사용한다.
- **보안 고려사항**:
  - kube-proxy의 설정 파일(ConfigMap)에 대한 접근을 RBAC으로 제한해야 한다.
  - `--metrics-bind-address`를 `127.0.0.1`로 설정하여 메트릭 엔드포인트를 localhost로 제한한다.
  - kube-proxy가 호스트 네트워크를 사용하므로 노드 레벨 방화벽 규칙과의 상호작용을 이해해야 한다.

### 2.5 CoreDNS 보안

CoreDNS는 Kubernetes 클러스터의 DNS 서비스를 제공하는 핵심 컴포넌트이다.

- **DNS 스푸핑 방지**: DNS 응답의 무결성을 보장하기 위해 DNSSEC을 고려할 수 있다.
- **접근 제어**: NetworkPolicy를 사용하여 DNS 쿼리를 허용된 Pod로 제한할 수 있다.
- **로깅**: CoreDNS 로그 플러그인을 활성화하여 DNS 쿼리를 감사할 수 있다.
- **DNS 기반 서비스 디스커버리 제한**: 필요한 네임스페이스/서비스만 DNS 조회가 가능하도록 구성할 수 있다.

### 2.6 Control Plane TLS 통신

Kubernetes 컨트롤 플레인의 모든 컴포넌트 간 통신은 TLS로 암호화되어야 한다.

| 통신 경로 | TLS 요구사항 |
|----------|-------------|
| API Server <-> etcd | 상호 TLS(mTLS) 인증이다. etcd는 API Server의 클라이언트 인증서를 검증한다. |
| API Server <-> kubelet | API Server가 kubelet에 접속할 때 kubelet의 서버 인증서를 검증한다. |
| API Server <-> kube-scheduler | kube-scheduler가 API Server에 접속할 때 TLS를 사용한다. |
| API Server <-> kube-controller-manager | controller-manager가 API Server에 접속할 때 TLS를 사용한다. |
| kubectl <-> API Server | 사용자가 kubeconfig의 CA 인증서로 API Server를 검증한다. |

인증서 관리:
- Kubernetes는 자체 CA(Certificate Authority)를 사용하여 인증서를 관리한다.
- `kubeadm`으로 설치 시 `/etc/kubernetes/pki/` 디렉토리에 인증서가 저장된다.
- 인증서의 기본 유효 기간은 1년이며, CA 인증서는 10년이다.
- `kubeadm certs renew all` 명령으로 인증서를 갱신할 수 있다.

---

## 3. Kubernetes Security Fundamentals (22%)

### 3.1 Pod Security Standards (PSS)

Pod Security Standards는 Pod의 보안 수준을 3가지 레벨로 정의한 표준이다. PodSecurityPolicy(PSP)의 후속이며, PSP는 1.25에서 제거되었다.

#### Privileged (특권)

제한 없는 정책이다. 모든 권한 상승이 허용된다. 시스템 및 인프라 수준의 워크로드에 사용한다.

- 모든 securityContext 설정이 허용된다.
- hostNetwork, hostPID, hostIPC 사용이 허용된다.
- 특권 컨테이너 실행이 허용된다.
- 호스트 경로 볼륨 마운트가 허용된다.

#### Baseline (기준)

최소한의 제한으로 알려진 권한 상승을 방지하는 정책이다. 대부분의 일반 워크로드에 적합하다.

주요 제한 사항:
- `hostNetwork`, `hostPID`, `hostIPC`: 사용 금지이다.
- `privileged`: 특권 컨테이너 금지이다.
- `hostPort`: 사용 금지이다 (또는 알려진 범위로 제한).
- `capabilities`: `NET_RAW`를 포함한 위험한 capability 추가 금지이다. `ALL` drop 후 특정 capability만 추가 가능하다.
- `/proc` mount type: `Default`만 허용이다. `Unmasked`는 금지이다.
- `seccomp` 프로파일: 명시적으로 `Unconfined`로 설정하는 것이 금지이다.
- `sysctls`: 안전한 sysctl만 허용이다.

#### Restricted (제한)

현재 Pod 하드닝 모범 사례를 따르는 가장 엄격한 정책이다. 보안에 민감한 워크로드에 사용한다.

Baseline의 모든 제한에 추가로:
- `runAsNonRoot`: `true`여야 한다. root로 실행 금지이다.
- `runAsUser`: UID 0(root) 사용 금지이다.
- `seccompProfile.type`: `RuntimeDefault` 또는 `Localhost`여야 한다. 반드시 설정해야 한다.
- `allowPrivilegeEscalation`: `false`여야 한다.
- `capabilities`: 모든 capability를 drop해야 한다(`ALL` drop 필수). `NET_BIND_SERVICE`만 추가 허용이다.
- 볼륨 유형: `configMap`, `csi`, `downwardAPI`, `emptyDir`, `ephemeral`, `persistentVolumeClaim`, `projected`, `secret`만 허용이다.

### 3.2 Pod Security Admission (PSA)

Pod Security Admission은 네임스페이스 레벨에서 Pod Security Standards를 적용하는 내장 Admission Controller이다.

#### 동작 모드

| 모드 | 동작 | 레이블 형식 |
|------|------|------------|
| **enforce** | 위반하는 Pod 생성을 거부한다. | `pod-security.kubernetes.io/enforce: <level>` |
| **audit** | 위반 사항을 감사 로그에 기록하지만 허용한다. | `pod-security.kubernetes.io/audit: <level>` |
| **warn** | 사용자에게 경고 메시지를 표시하지만 허용한다. | `pod-security.kubernetes.io/warn: <level>` |

각 모드에 대해 버전을 지정할 수도 있다:
- `pod-security.kubernetes.io/enforce-version: v1.30`
- `latest`를 사용하면 항상 최신 버전의 정책을 적용한다.

권장 전략:
1. 먼저 `warn`과 `audit` 모드로 현재 워크로드의 위반 사항을 파악한다.
2. 워크로드를 수정한 후 `enforce` 모드를 활성화한다.
3. 점진적으로 `baseline` -> `restricted`로 레벨을 올린다.

### 3.3 RBAC (Role-Based Access Control)

RBAC는 Kubernetes에서 가장 권장되는 인가 방식이다. 역할(Role)과 바인딩(Binding)의 조합으로 권한을 관리한다.

#### RBAC 리소스

| 리소스 | 범위 | 설명 |
|--------|------|------|
| **Role** | 네임스페이스 | 특정 네임스페이스 내의 리소스에 대한 권한을 정의한다. |
| **ClusterRole** | 클러스터 전체 | 클러스터 전체 리소스 또는 비-네임스페이스 리소스에 대한 권한을 정의한다. |
| **RoleBinding** | 네임스페이스 | Role 또는 ClusterRole을 사용자/그룹/SA에 바인딩한다(네임스페이스 범위). |
| **ClusterRoleBinding** | 클러스터 전체 | ClusterRole을 사용자/그룹/SA에 바인딩한다(클러스터 전체 범위). |

#### 주요 동사(Verbs)

| 동사 | 설명 |
|------|------|
| `get` | 단일 리소스 조회이다. |
| `list` | 리소스 목록 조회이다. |
| `watch` | 리소스 변경 감시이다. |
| `create` | 리소스 생성이다. |
| `update` | 리소스 전체 업데이트이다. |
| `patch` | 리소스 부분 업데이트이다. |
| `delete` | 단일 리소스 삭제이다. |
| `deletecollection` | 리소스 컬렉션 삭제이다. |
| `impersonate` | 다른 사용자로 가장하는 것이다. |
| `bind` | RoleBinding/ClusterRoleBinding 생성이다. |
| `escalate` | Role/ClusterRole의 권한을 상승시키는 것이다. |

#### RBAC 보안 모범 사례

- **최소 권한 원칙(Least Privilege)**: 필요한 최소한의 권한만 부여한다.
- **와일드카드(`*`) 사용 금지**: `verbs: ["*"]`나 `resources: ["*"]`는 사용하지 않는다.
- **ClusterRoleBinding 최소화**: 클러스터 전체 권한은 정말 필요한 경우에만 부여한다.
- **`system:masters` 그룹 사용 금지**: 이 그룹은 모든 RBAC를 우회하므로 비상 시에만 사용한다.
- **정기적인 RBAC 감사**: `kubectl auth can-i --list --as=<user>` 명령으로 권한을 검토한다.
- **ServiceAccount 분리**: 각 워크로드별로 별도의 ServiceAccount를 사용한다.

### 3.4 ServiceAccount 및 Token 관리

#### ServiceAccount

- 모든 네임스페이스에는 `default` ServiceAccount가 자동으로 생성된다.
- Pod에 별도의 ServiceAccount를 지정하지 않으면 `default`가 사용된다.
- 1.24+에서는 ServiceAccount에 자동으로 Secret이 생성되지 않는다. Bound ServiceAccount Token을 사용한다.

#### Bound ServiceAccount Token

Kubernetes 1.22+에서 도입된 Bound ServiceAccount Token의 특징이다:
- **시간 제한**: 토큰에 만료 시간이 있다(기본 1시간, 최대 48시간).
- **대상 제한(Audience Bound)**: 특정 대상(audience)에만 유효하다.
- **오브젝트 바인딩**: 특정 Pod에 바인딩되어 Pod 삭제 시 무효화된다.
- TokenRequest API를 통해 발급되며, projected volume으로 Pod에 마운트된다.

#### automountServiceAccountToken

```
automountServiceAccountToken: false
```

- ServiceAccount 토큰이 Pod에 자동 마운트되는 것을 비활성화하는 설정이다.
- API Server에 접근할 필요가 없는 Pod에는 반드시 `false`로 설정해야 한다.
- ServiceAccount 레벨 또는 Pod 레벨에서 설정할 수 있다.
- Pod 레벨 설정이 ServiceAccount 레벨 설정보다 우선한다.

### 3.5 NetworkPolicy

NetworkPolicy는 Pod 간의 네트워크 트래픽을 제어하는 Kubernetes 리소스이다. 기본적으로 Kubernetes 클러스터 내의 모든 Pod는 서로 자유롭게 통신할 수 있으며, NetworkPolicy를 통해 이를 제한한다.

#### 핵심 개념

- **기본 동작**: NetworkPolicy가 없으면 모든 트래픽이 허용된다.
- **Pod 선택**: `podSelector`로 정책이 적용될 Pod를 선택한다.
- **방향**: `ingress`(들어오는 트래픽), `egress`(나가는 트래픽) 규칙을 정의한다.
- **셀렉터 유형**: `podSelector`, `namespaceSelector`, `ipBlock`으로 트래픽 소스/목적지를 지정한다.
- **CNI 지원 필요**: Calico, Cilium, Weave Net 등 NetworkPolicy를 지원하는 CNI 플러그인이 필요하다. Flannel은 지원하지 않는다.

#### 규칙 동작 방식

- 같은 NetworkPolicy 내의 여러 `from`/`to` 항목은 OR 관계이다.
- 같은 `from`/`to` 항목 내의 여러 셀렉터는 AND 관계이다.
  - `podSelector`와 `namespaceSelector`가 같은 항목에 있으면: 해당 네임스페이스의 해당 Pod만 허용이다.
  - `podSelector`와 `namespaceSelector`가 별도 항목에 있으면: 해당 Pod 또는 해당 네임스페이스의 모든 Pod가 허용이다.

#### Default Deny 정책

보안 모범 사례로, 모든 네임스페이스에 Default Deny 정책을 적용한 후 필요한 트래픽만 명시적으로 허용하는 화이트리스트 방식을 권장한다.

### 3.6 Secret 관리

#### Kubernetes Secret

- Secret은 기본적으로 Base64 인코딩되어 저장된다. 이것은 암호화가 아니다.
- `etcd`에 평문(또는 Base64 인코딩)으로 저장되므로 반드시 Encryption at Rest를 설정해야 한다.
- Secret은 환경 변수 또는 볼륨 마운트로 Pod에 전달할 수 있다.
- 볼륨 마운트 방식이 환경 변수보다 안전하다(환경 변수는 로그에 노출될 수 있다).

#### Secret 유형

| 유형 | 설명 |
|------|------|
| `Opaque` | 기본 유형이다. 임의의 키-값 쌍을 저장한다. |
| `kubernetes.io/tls` | TLS 인증서와 키를 저장한다. |
| `kubernetes.io/dockerconfigjson` | Docker 레지스트리 인증 정보를 저장한다. |
| `kubernetes.io/service-account-token` | ServiceAccount 토큰을 저장한다. |
| `kubernetes.io/basic-auth` | 기본 인증 정보를 저장한다. |
| `kubernetes.io/ssh-auth` | SSH 인증 정보를 저장한다. |

#### 외부 시크릿 관리 솔루션

| 솔루션 | 설명 |
|--------|------|
| **HashiCorp Vault** | 가장 널리 사용되는 외부 시크릿 관리 도구이다. CSI 드라이버 또는 Agent Injector를 통해 통합한다. |
| **AWS Secrets Manager / SSM** | AWS 환경에서 사용한다. |
| **Azure Key Vault** | Azure 환경에서 사용한다. |
| **GCP Secret Manager** | GCP 환경에서 사용한다. |
| **External Secrets Operator** | 외부 시크릿 저장소를 Kubernetes Secret으로 동기화하는 오퍼레이터이다. |
| **Sealed Secrets** | 암호화된 Secret을 Git에 안전하게 저장할 수 있게 한다. |

---

## 4. Kubernetes Threat Model (16%)

### 4.1 STRIDE 위협 모델

STRIDE는 Microsoft에서 개발한 위협 분류 프레임워크이다. 각 카테고리는 특정 유형의 위협을 나타낸다.

| 위협 유형 | 설명 | Kubernetes 예시 | 대응 방법 |
|----------|------|----------------|----------|
| **Spoofing (위장)** | 다른 사용자나 시스템으로 가장하는 행위이다. | 도난된 ServiceAccount 토큰으로 API 접근, 위조된 kubelet 인증서 | 강력한 인증, 토큰 만료 설정, mTLS |
| **Tampering (변조)** | 데이터나 코드를 무단으로 수정하는 행위이다. | etcd 데이터 변조, 컨테이너 이미지 변조, ConfigMap/Secret 수정 | 암호화, 이미지 서명, RBAC, Admission Control |
| **Repudiation (부인)** | 수행한 행위를 부인하는 것이다. | 감사 로그 없이 리소스를 삭제한 행위를 부인 | Audit Logging, 불변 로그 저장소 |
| **Information Disclosure (정보 노출)** | 민감한 정보가 인가되지 않은 주체에게 노출되는 것이다. | Secret이 로그에 노출, etcd 평문 데이터 유출, 환경 변수를 통한 시크릿 노출 | Encryption at Rest, RBAC, Secret 볼륨 마운트 |
| **Denial of Service (서비스 거부)** | 시스템의 가용성을 저해하는 행위이다. | 리소스 제한 없는 Pod가 노드 리소스 고갈, API Server 과부하 | ResourceQuota, LimitRange, Rate Limiting |
| **Elevation of Privilege (권한 상승)** | 부여된 것 이상의 권한을 획득하는 행위이다. | 컨테이너 탈출, 특권 컨테이너 악용, RBAC 에스컬레이션 | Pod Security Standards, seccomp, AppArmor, 최소 권한 |

### 4.2 MITRE ATT&CK for Containers

MITRE ATT&CK는 실제 공격에서 관찰된 전술(Tactics)과 기술(Techniques)을 체계적으로 정리한 프레임워크이다. Containers 매트릭스는 컨테이너 환경에 특화된 공격 기법을 분류한다.

#### 주요 전술(Tactics)

| 전술 | 설명 | Kubernetes 관련 기술 예시 |
|------|------|------------------------|
| **Initial Access (초기 접근)** | 클러스터에 최초 진입하는 방법이다. | 노출된 API Server, 취약한 애플리케이션, 유효한 자격 증명 |
| **Execution (실행)** | 악성 코드를 실행하는 방법이다. | `kubectl exec`, 새 컨테이너 생성, 크론잡 악용 |
| **Persistence (지속성)** | 접근을 유지하는 방법이다. | 백도어 컨테이너, 악성 Admission Webhook, 쿠버네티스 크론잡 |
| **Privilege Escalation (권한 상승)** | 더 높은 권한을 획득하는 방법이다. | 특권 컨테이너, hostPath 마운트, ServiceAccount 토큰 탈취 |
| **Defense Evasion (방어 회피)** | 탐지를 피하는 방법이다. | Pod 로그 삭제, 네임스페이스 변경, 이미지 변조 |
| **Credential Access (자격 증명 접근)** | 자격 증명을 탈취하는 방법이다. | Secret 접근, SA 토큰 탈취, 클라우드 메타데이터 API |
| **Discovery (탐색)** | 환경을 파악하는 방법이다. | API Server 탐색, 네트워크 스캔, 클라우드 메타데이터 |
| **Lateral Movement (횡적 이동)** | 다른 시스템으로 이동하는 방법이다. | 클러스터 내부 서비스 접근, ARP 스푸핑 |
| **Impact (영향)** | 시스템에 피해를 주는 방법이다. | 데이터 파괴, 크립토마이닝, 서비스 거부 |

### 4.3 공급망 보안

소프트웨어 공급망 보안은 코드 작성부터 배포까지의 전체 과정을 보호하는 것이다.

#### SBOM (Software Bill of Materials)

SBOM은 소프트웨어에 포함된 모든 컴포넌트, 라이브러리, 의존성의 목록이다.

- **목적**: 소프트웨어 구성 요소의 투명성을 확보하여 취약점 관리를 용이하게 한다.
- **형식**: SPDX(Linux Foundation), CycloneDX(OWASP) 두 가지 주요 표준이 있다.
- **도구**: Syft, Trivy, SPDX 도구 등이 SBOM 생성을 지원한다.
- **활용**: 새로운 CVE가 발표되면 SBOM을 검색하여 영향받는 소프트웨어를 신속하게 파악할 수 있다.

#### 이미지 서명 (Image Signing)

컨테이너 이미지의 무결성과 출처를 검증하기 위해 이미지 서명을 사용한다.

| 도구 | 설명 |
|------|------|
| **Cosign** | Sigstore 프로젝트의 일부이다. OCI 레지스트리에 서명을 저장하며, 키리스(keyless) 서명을 지원한다. |
| **Notary (v2)** | CNCF 프로젝트이다. OCI 아티팩트 서명 표준을 구현한다. |

#### SLSA (Supply Chain Levels for Software Artifacts)

SLSA(발음: "살사")는 소프트웨어 공급망의 무결성을 보장하기 위한 프레임워크이다. 4개의 레벨로 구성된다:

- **Level 1**: 빌드 프로세스가 문서화되어 있다.
- **Level 2**: 빌드 서비스에 의해 서명된 출처 증명(provenance)이 생성된다.
- **Level 3**: 빌드 환경이 강화되어 있다(격리된 빌드).
- **Level 4**: 모든 의존성에 대한 2인 검토가 수행된다.

#### 이미지 스캐닝

컨테이너 이미지의 알려진 취약점(CVE)을 탐지하는 프로세스이다.

| 도구 | 설명 |
|------|------|
| **Trivy** | Aqua Security에서 개발한 오픈소스 취약점 스캐너이다. 이미지, 파일시스템, Git 리포지토리 등을 스캔한다. |
| **Grype** | Anchore에서 개발한 취약점 스캐너이다. |
| **Clair** | CoreOS(현 Red Hat)에서 개발한 정적 분석 도구이다. |
| **Snyk** | 상용 보안 도구이다. 컨테이너 이미지 및 코드 스캐닝을 지원한다. |

---

## 5. Platform Security (16%)

### 5.1 노드 하드닝

Kubernetes 노드의 운영체제를 보안 강화하는 프로세스이다.

#### OS 최소 설치

- **최소 설치 원칙**: 불필요한 패키지, 서비스, 데몬을 제거하여 공격 표면을 줄인다.
- **컨테이너 최적화 OS**: Bottlerocket(AWS), Container-Optimized OS(GCP), Flatcar Container Linux, Talos Linux 등 컨테이너 실행에 최적화된 불변 OS를 사용할 수 있다.
- **불변 인프라**: 노드를 업데이트하는 대신 새 노드를 생성하고 기존 노드를 교체한다.

#### 노드 보안 설정

| 설정 영역 | 권장 사항 |
|----------|----------|
| **SSH** | 불필요한 경우 비활성화하거나 키 기반 인증만 허용한다. root 로그인을 금지한다. |
| **방화벽** | 필요한 포트만 개방한다(API Server: 6443, kubelet: 10250 등). |
| **커널 보안** | sysctl 파라미터를 적절히 설정한다. 불필요한 커널 모듈을 비활성화한다. |
| **파일시스템** | 중요 디렉토리의 권한을 제한한다. `/etc/kubernetes/`, `/var/lib/kubelet/` 등의 접근을 제한한다. |
| **시간 동기화** | NTP를 설정하여 인증서 유효성 검증과 감사 로그의 시간 정확성을 보장한다. |
| **자동 업데이트** | 보안 패치를 자동으로 적용하거나 정기적으로 업데이트한다. |

### 5.2 런타임 보안

#### Falco

Falco는 CNCF 졸업(Graduated) 프로젝트로, 런타임 보안 위협을 탐지하는 오픈소스 도구이다.

- **동작 원리**: 커널의 시스템 콜을 모니터링하여 규칙 기반으로 비정상 행위를 탐지한다.
- **데이터 소스**: 시스템 콜(eBPF 또는 커널 모듈), Kubernetes Audit Log, CloudTrail 등이다.
- **탐지 예시**:
  - 컨테이너 내에서 쉘 실행 (`Terminal shell in container`)
  - 민감한 파일 읽기 (`/etc/shadow`, `/etc/passwd`)
  - 예상치 못한 네트워크 연결
  - 바이너리 변경 또는 새로운 프로세스 실행
  - 네임스페이스 변경 시도
- **규칙 구성**: YAML 형식의 규칙 파일로 조건과 출력을 정의한다.
- **출력**: stdout, syslog, HTTP webhook, gRPC 등으로 알림을 전송한다.

#### seccomp (Secure Computing Mode)

seccomp은 Linux 커널의 보안 기능으로, 프로세스가 사용할 수 있는 시스템 콜을 제한한다.

- **프로파일 유형**:
  - `RuntimeDefault`: 컨테이너 런타임이 제공하는 기본 프로파일이다. 대부분의 워크로드에 적합하다.
  - `Localhost`: 노드의 로컬 파일시스템에 저장된 커스텀 프로파일이다.
  - `Unconfined`: seccomp을 적용하지 않는다. 보안 위험이 있다.
- **동작 모드**:
  - `SCMP_ACT_ALLOW`: 해당 시스템 콜을 허용한다.
  - `SCMP_ACT_ERRNO`: 해당 시스템 콜을 거부하고 에러를 반환한다.
  - `SCMP_ACT_LOG`: 해당 시스템 콜을 로그에 기록하고 허용한다.
  - `SCMP_ACT_KILL`: 해당 시스템 콜을 사용하면 프로세스를 종료한다.
- Pod Security Standards의 Restricted 레벨에서는 seccomp 프로파일 설정이 필수이다.

#### AppArmor

AppArmor는 Linux의 MAC(Mandatory Access Control) 보안 모듈로, 프로세스의 파일, 네트워크, capability 접근을 프로파일 기반으로 제한한다.

- **프로파일 모드**:
  - `enforce`: 정책을 강제 적용한다. 위반 시 차단하고 로그를 기록한다.
  - `complain`: 위반을 로그에 기록하지만 차단하지는 않는다(테스트용).
  - `unconfined`: AppArmor를 적용하지 않는다.
- Kubernetes 1.30+에서는 `securityContext.appArmorProfile`을 통해 Pod 스펙에서 직접 AppArmor 프로파일을 지정할 수 있다.
- 이전 버전에서는 어노테이션(`container.apparmor.security.beta.kubernetes.io/<container-name>`)을 사용했다.

#### SELinux

SELinux는 Linux의 MAC 보안 모듈로, 레이블 기반으로 접근을 제어한다.

- **컨텍스트**: 사용자(User), 역할(Role), 유형(Type), 레벨(Level)로 구성된다.
- **Pod에서의 사용**: `securityContext.seLinuxOptions`에서 `level`, `role`, `type`, `user`를 설정한다.
- **모드**: Enforcing(강제), Permissive(기록만), Disabled(비활성화)가 있다.
- AppArmor와 SELinux는 상호 배타적이다. 하나의 시스템에서는 둘 중 하나만 사용한다.

### 5.3 네트워크 보안

#### CNI (Container Network Interface)

CNI 플러그인은 Kubernetes Pod의 네트워크를 관리한다. 보안 기능은 플러그인마다 다르다.

| CNI 플러그인 | NetworkPolicy 지원 | 추가 보안 기능 |
|-------------|-------------------|--------------|
| **Calico** | 지원 | 호스트 엔드포인트 정책, DNS 정책, 글로벌 NetworkPolicy |
| **Cilium** | 지원 | eBPF 기반, L7 정책, 투명 암호화(WireGuard/IPsec) |
| **Weave Net** | 지원 | 네트워크 암호화 |
| **Flannel** | 미지원 | 기본 오버레이 네트워크만 제공한다. |
| **AWS VPC CNI** | 부분 지원 | VPC 네이티브 네트워킹이다. |

#### 서비스 메시

서비스 메시는 마이크로서비스 간의 통신을 관리하는 인프라 계층이다.

| 기능 | 설명 |
|------|------|
| **mTLS** | 서비스 간 상호 TLS 인증을 제공한다. 통신을 자동으로 암호화한다. |
| **트래픽 정책** | 세밀한 트래픽 라우팅과 접근 제어를 제공한다. |
| **관찰가능성** | 서비스 간 통신의 메트릭, 트레이스, 로그를 수집한다. |

주요 서비스 메시 프로젝트:

| 프로젝트 | 설명 |
|---------|------|
| **Istio** | 가장 널리 사용되는 서비스 메시이다. Envoy 프록시를 사이드카로 사용한다. |
| **Linkerd** | CNCF 졸업 프로젝트이다. 경량 서비스 메시이다. |
| **Cilium Service Mesh** | eBPF 기반으로 사이드카 없이 서비스 메시 기능을 제공한다. |

#### mTLS (Mutual TLS)

mTLS는 클라이언트와 서버가 서로의 인증서를 검증하는 양방향 TLS 인증이다.

- **일반 TLS**: 클라이언트가 서버의 인증서만 검증한다.
- **mTLS**: 클라이언트와 서버가 서로의 인증서를 검증한다. 양쪽 모두 신뢰할 수 있는 CA에서 발급된 인증서를 가져야 한다.
- **Kubernetes에서의 활용**: 서비스 메시(Istio, Linkerd)를 통해 Pod 간 mTLS를 자동으로 적용할 수 있다.

---

## 6. Compliance and Security Frameworks (10%)

### 6.1 CIS Benchmarks

CIS(Center for Internet Security) Benchmarks는 시스템 보안 구성을 위한 업계 표준 가이드라인이다.

#### CIS Kubernetes Benchmark

Kubernetes 클러스터의 보안 구성을 점검하기 위한 체크리스트이다.

주요 점검 영역:
- **Control Plane Components**: API Server, Controller Manager, Scheduler, etcd 설정이다.
- **Worker Node**: kubelet, kube-proxy 설정이다.
- **Policies**: RBAC, Pod Security, NetworkPolicy 구성이다.
- **Managed Services**: EKS, AKS, GKE에 대한 별도 벤치마크가 있다.

#### kube-bench

kube-bench는 CIS Kubernetes Benchmark를 자동으로 점검하는 오픈소스 도구이다.

- **동작**: 각 노드에서 실행하여 CIS 벤치마크 항목을 자동 점검한다.
- **결과**: PASS, FAIL, WARN, INFO 등으로 분류하여 리포트를 생성한다.
- **실행 방법**: Pod(DaemonSet), Job, 또는 직접 바이너리로 실행할 수 있다.
- **점검 범위**: Master 노드와 Worker 노드를 각각 점검한다.

### 6.2 보안 프레임워크

#### NIST (National Institute of Standards and Technology)

미국 국립표준기술연구소의 사이버보안 프레임워크이다.

| NIST CSF 기능 | 설명 | Kubernetes 적용 |
|--------------|------|----------------|
| **Identify (식별)** | 자산, 위험, 취약점을 식별한다. | 클러스터 인벤토리, RBAC 감사 |
| **Protect (보호)** | 보안 통제를 구현한다. | NetworkPolicy, PSA, RBAC, 암호화 |
| **Detect (탐지)** | 보안 이벤트를 탐지한다. | Falco, Audit Log, 모니터링 |
| **Respond (대응)** | 보안 사고에 대응한다. | Incident Response 계획, 격리 |
| **Recover (복구)** | 정상 운영으로 복구한다. | 백업/복원, Disaster Recovery |

#### SOC 2 (Service Organization Controls 2)

SOC 2는 서비스 조직의 보안, 가용성, 처리 무결성, 기밀성, 프라이버시에 대한 감사 표준이다.

- **Trust Service Criteria**: 보안(필수), 가용성, 처리 무결성, 기밀성, 프라이버시(선택)로 구성된다.
- **Kubernetes 관련**: 접근 제어(RBAC), 변경 관리(GitOps), 모니터링, 감사 로그가 핵심이다.
- **Type I**: 특정 시점에서의 통제 설계를 평가한다.
- **Type II**: 일정 기간(보통 6-12개월) 동안의 통제 운영 효과를 평가한다.

#### PCI DSS (Payment Card Industry Data Security Standard)

PCI DSS는 신용카드 데이터를 처리하는 조직을 위한 보안 표준이다.

- **핵심 요구사항**: 방화벽 구성, 데이터 암호화, 접근 제어, 정기 테스트, 보안 정책이다.
- **Kubernetes 관련**:
  - 카드 데이터를 처리하는 Pod의 네트워크 세그멘테이션(NetworkPolicy)이 필요하다.
  - Secret 암호화(Encryption at Rest)가 필요하다.
  - 감사 로그(Audit Log)의 보존과 보호가 필요하다.
  - 취약점 스캐닝(이미지 스캐닝)이 필요하다.

### 6.3 Audit Logging

Kubernetes Audit Logging은 API Server에 대한 모든 요청을 기록하는 기능이다.

#### Audit 레벨

| 레벨 | 설명 |
|------|------|
| **None** | 이 규칙에 해당하는 이벤트를 기록하지 않는다. |
| **Metadata** | 요청의 메타데이터(사용자, 타임스탬프, 리소스, 동사 등)만 기록한다. 요청/응답 본문은 기록하지 않는다. |
| **Request** | 메타데이터와 요청 본문을 기록한다. 응답 본문은 기록하지 않는다. |
| **RequestResponse** | 메타데이터, 요청 본문, 응답 본문을 모두 기록한다. 가장 상세하지만 저장 공간을 많이 사용한다. |

#### Audit 단계(Stage)

| 단계 | 설명 |
|------|------|
| `RequestReceived` | 요청이 수신된 시점이다. |
| `ResponseStarted` | 응답 헤더가 전송된 시점이다(long-running 요청만). |
| `ResponseComplete` | 응답이 완료된 시점이다. |
| `Panic` | 패닉이 발생한 시점이다. |

#### Audit 백엔드

| 백엔드 | 설명 |
|--------|------|
| **Log** | 파일에 기록한다. `--audit-log-path`, `--audit-log-maxage`, `--audit-log-maxbackup`, `--audit-log-maxsize` 플래그로 구성한다. |
| **Webhook** | 외부 HTTP 서비스로 이벤트를 전송한다. `--audit-webhook-config-file` 플래그로 구성한다. |

#### Audit 정책 설계 모범 사례

- 모든 요청에 `RequestResponse`를 적용하면 로그 양이 과도해진다.
- 민감한 리소스(Secret, ConfigMap)에는 `Metadata`만 기록하여 데이터 노출을 방지한다.
- 읽기 전용 요청(get, list, watch)은 `Metadata` 레벨로 기록한다.
- 변경 요청(create, update, delete)은 `Request` 또는 `RequestResponse` 레벨로 기록한다.
- 헬스 체크 등 노이즈가 많은 요청은 `None`으로 제외한다.

---

## 참고 자료

- [Kubernetes 공식 보안 문서](https://kubernetes.io/docs/concepts/security/)
- [CNCF Security TAG](https://github.com/cncf/tag-security)
- [CIS Kubernetes Benchmark](https://www.cisecurity.org/benchmark/kubernetes)
- [MITRE ATT&CK Containers](https://attack.mitre.org/matrices/enterprise/containers/)
- [KCSA 시험 개요](https://training.linuxfoundation.org/certification/kubernetes-and-cloud-native-security-associate-kcsa/)
