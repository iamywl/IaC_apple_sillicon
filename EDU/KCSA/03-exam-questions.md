# KCSA 모의 시험 문제

KCSA(Kubernetes and Cloud Native Security Associate) 시험 대비 모의 문제 40문항이다.
실제 시험과 동일한 비율로 도메인별 문제를 구성하였다.

| 도메인 | 비중 | 문항 수 |
|--------|------|---------|
| Cloud Native Security Overview | 14% | 6 |
| Kubernetes Cluster Component Security | 22% | 9 |
| Kubernetes Security Fundamentals | 22% | 9 |
| Kubernetes Threat Model | 16% | 6 |
| Platform Security | 16% | 6 |
| Compliance and Security Frameworks | 10% | 4 |

---

## Cloud Native Security Overview (6문항)

### 문제 1.
클라우드 네이티브 보안의 4C 모델에서 가장 바깥쪽 계층은 무엇인가?

A) Container
B) Cluster
C) Cloud
D) Code

<details><summary>정답 확인</summary>

**정답: C) Cloud ✅**

4C 모델은 바깥쪽부터 Cloud -> Cluster -> Container -> Code 순서이다. 각 계층의 보안이 바깥 계층의 보안에 의존하므로, Cloud 계층이 가장 기본적인 보안 기반이 된다. tart-infra에서는 Tart VM이 Cloud 계층에 해당한다.

</details>

### 문제 2.
Zero Trust 보안 모델의 핵심 원칙으로 가장 적절한 것은?

A) 내부 네트워크의 트래픽은 신뢰한다
B) 방화벽 내부의 사용자는 기본적으로 신뢰한다
C) 어떤 주체도 기본적으로 신뢰하지 않고 항상 검증한다
D) VPN을 통한 접근은 자동으로 신뢰한다

<details><summary>정답 확인</summary>

**정답: C) 어떤 주체도 기본적으로 신뢰하지 않고 항상 검증한다 ✅**

Zero Trust는 "Never trust, always verify"가 핵심 원칙이다. 네트워크 위치에 관계없이 모든 접근에 대해 인증과 인가를 수행한다. tart-infra에서 Cilium의 default-deny NetworkPolicy가 이 원칙을 구현한 사례이다.

</details>

### 문제 3.
컨테이너 이미지 보안에서 가장 권장되는 사항은?

A) latest 태그를 사용하여 항상 최신 이미지를 사용한다
B) 이미지 다이제스트(SHA256)를 사용하여 이미지를 고정한다
C) Docker Hub에서 다운로드한 이미지는 스캔 없이 사용해도 안전하다
D) 이미지 크기를 줄이기 위해 보안 패치를 생략한다

<details><summary>정답 확인</summary>

**정답: B) 이미지 다이제스트(SHA256)를 사용하여 이미지를 고정한다 ✅**

이미지 다이제스트를 사용하면 이미지의 무결성을 보장할 수 있다. latest 태그는 언제든 다른 이미지를 가리킬 수 있어 예측 불가능한 동작을 초래할 수 있다. 또한 이미지 서명(cosign 등)과 취약점 스캔(Trivy 등)을 함께 적용하는 것이 권장된다.

</details>

### 문제 4.
클라우드 네이티브 애플리케이션의 소프트웨어 공급망 보안에서 SBOM의 역할은?

A) 컨테이너 런타임의 성능을 최적화한다
B) 소프트웨어에 포함된 모든 구성 요소와 의존성을 문서화한다
C) 네트워크 트래픽을 암호화한다
D) Pod의 리소스 사용량을 제한한다

<details><summary>정답 확인</summary>

**정답: B) 소프트웨어에 포함된 모든 구성 요소와 의존성을 문서화한다 ✅**

SBOM(Software Bill of Materials)은 소프트웨어의 모든 구성 요소, 라이브러리, 의존성을 목록화한 문서이다. 취약점 발견 시 영향 범위를 빠르게 파악하고 대응하는 데 필수적이다. SPDX와 CycloneDX가 대표적인 SBOM 표준 형식이다.

</details>

### 문제 5.
DevSecOps에서 "Shift Left"의 의미는?

A) 보안 검사를 배포 후 모니터링 단계로 미룬다
B) 보안 활동을 개발 초기 단계로 앞당긴다
C) 보안 팀만 보안 검사를 수행한다
D) 운영 환경에서만 보안 테스트를 수행한다

<details><summary>정답 확인</summary>

**정답: B) 보안 활동을 개발 초기 단계로 앞당긴다 ✅**

Shift Left는 보안 활동을 소프트웨어 개발 라이프사이클의 초기 단계(설계, 코딩, 빌드)로 앞당기는 것이다. CI/CD 파이프라인에 이미지 스캔, SAST, DAST 등을 통합하여 취약점을 조기에 발견하고 수정 비용을 절감한다.

</details>

### 문제 6.
Sigstore의 cosign을 사용한 컨테이너 이미지 서명의 주요 목적은?

A) 이미지 크기를 줄인다
B) 이미지의 빌드 속도를 높인다
C) 이미지의 출처와 무결성을 검증한다
D) 이미지의 레이어를 암호화한다

<details><summary>정답 확인</summary>

**정답: C) 이미지의 출처와 무결성을 검증한다 ✅**

cosign은 컨테이너 이미지에 서명하여 이미지가 신뢰할 수 있는 출처에서 빌드되었고 변조되지 않았음을 검증한다. Kubernetes에서는 admission controller(Kyverno, OPA Gatekeeper 등)와 연동하여 서명되지 않은 이미지의 배포를 차단할 수 있다.

</details>

---

## Kubernetes Cluster Component Security (9문항)

### 문제 7.
kube-apiserver에서 익명 접근(anonymous access)을 비활성화하는 플래그는?

A) `--disable-anonymous-auth`
B) `--anonymous-auth=false`
C) `--no-anonymous`
D) `--authentication-mode=strict`

<details><summary>정답 확인</summary>

**정답: B) `--anonymous-auth=false` ✅**

`--anonymous-auth=false` 플래그를 설정하면 인증되지 않은 요청이 거부된다. 기본값은 `true`이며, 이 경우 인증되지 않은 요청은 `system:anonymous` 사용자로 처리된다. kubeadm으로 구성한 tart-infra 클러스터에서 이 설정을 확인할 수 있다.

</details>

### 문제 8.
etcd의 데이터를 보호하기 위해 가장 중요한 보안 설정 두 가지는?

A) etcd 데이터 압축과 로그 로테이션
B) TLS 통신 암호화와 데이터 암호화(encryption at rest)
C) etcd 백업과 스냅샷
D) etcd 클러스터 사이즈와 디스크 성능 최적화

<details><summary>정답 확인</summary>

**정답: B) TLS 통신 암호화와 데이터 암호화(encryption at rest) ✅**

etcd에는 클러스터의 모든 상태 데이터(Secret 포함)가 저장된다. TLS를 통해 API Server-etcd 간 통신을 암호화하고, EncryptionConfiguration을 통해 저장 데이터를 암호화해야 한다. kubeadm은 기본적으로 etcd TLS 인증서를 생성한다.

</details>

### 문제 9.
kubelet의 보안 설정으로 올바르지 않은 것은?

A) `--anonymous-auth=false`로 익명 접근을 차단한다
B) `--authorization-mode=Webhook`으로 API Server를 통한 인가를 사용한다
C) `--read-only-port=10255`로 읽기 전용 포트를 활성화한다
D) `--rotate-certificates=true`로 인증서 자동 갱신을 활성화한다

<details><summary>정답 확인</summary>

**정답: C) `--read-only-port=10255`로 읽기 전용 포트를 활성화한다 ✅**

kubelet의 읽기 전용 포트(10255)는 인증 없이 노드 정보를 노출하므로 `--read-only-port=0`으로 비활성화해야 한다. tart-infra의 kubelet 설정에서 authorization mode가 Webhook으로 설정되어 있는지 확인해 볼 수 있다.

</details>

### 문제 10.
Kubernetes API Server의 인증(Authentication) 방식이 아닌 것은?

A) X.509 클라이언트 인증서
B) Bearer Token
C) NetworkPolicy
D) OpenID Connect (OIDC)

<details><summary>정답 확인</summary>

**정답: C) NetworkPolicy ✅**

NetworkPolicy는 네트워크 트래픽을 제어하는 리소스이며, 인증 방식이 아니다. API Server는 X.509 인증서, Bearer Token, OIDC, ServiceAccount Token, Webhook Token 등 다양한 인증 방식을 지원한다.

</details>

### 문제 11.
kubeadm으로 구성된 클러스터에서 API Server의 TLS 인증서 기본 위치는?

A) `/var/lib/kubelet/pki/`
B) `/etc/kubernetes/pki/`
C) `/opt/kubernetes/certs/`
D) `/root/.kube/certs/`

<details><summary>정답 확인</summary>

**정답: B) `/etc/kubernetes/pki/` ✅**

kubeadm은 `/etc/kubernetes/pki/` 디렉터리에 CA 인증서, API Server 인증서, etcd 인증서 등을 생성한다. tart-infra의 kubeadm 클러스터에서도 동일한 경로를 사용한다.

</details>

### 문제 12.
kube-controller-manager가 관리하는 보안 관련 기능이 아닌 것은?

A) ServiceAccount 토큰 발급
B) 인증서 서명 요청(CSR) 승인
C) Namespace 삭제 시 리소스 정리
D) 네트워크 패킷 필터링

<details><summary>정답 확인</summary>

**정답: D) 네트워크 패킷 필터링 ✅**

네트워크 패킷 필터링은 CNI 플러그인(Cilium, Calico 등)이나 kube-proxy가 담당한다. kube-controller-manager는 ServiceAccount 토큰 컨트롤러, CSR 서명 컨트롤러, Namespace 컨트롤러 등을 통해 보안 관련 기능을 수행한다.

</details>

### 문제 13.
API Server에서 admission controller의 실행 순서로 올바른 것은?

A) Validating -> Mutating -> Webhook
B) Mutating -> Validating
C) Validating -> Mutating
D) 순서 없이 병렬로 실행된다

<details><summary>정답 확인</summary>

**정답: B) Mutating -> Validating ✅**

Admission Controller는 Mutating 단계에서 요청을 수정하고, 이후 Validating 단계에서 수정된 요청을 검증한다. 이 순서가 중요한 이유는 Mutating에서 추가/수정된 필드가 Validating에서 검증되어야 하기 때문이다.

</details>

### 문제 14.
Kubernetes static Pod의 보안 관점에서의 특징은?

A) API Server를 통해 생성되므로 RBAC가 적용된다
B) kubelet이 직접 관리하며 API Server의 admission control이 적용되지 않을 수 있다
C) etcd에 저장되어 암호화 보호를 받는다
D) NetworkPolicy에 의해 자동으로 보호된다

<details><summary>정답 확인</summary>

**정답: B) kubelet이 직접 관리하며 API Server의 admission control이 적용되지 않을 수 있다 ✅**

static Pod는 kubelet이 `/etc/kubernetes/manifests/` 디렉터리의 매니페스트 파일을 직접 읽어 관리한다. kubeadm 클러스터에서 kube-apiserver, etcd, kube-controller-manager, kube-scheduler가 static Pod로 실행된다. API Server를 거치지 않으므로 admission controller의 정책이 우회될 수 있다.

</details>

### 문제 15.
API Server의 `--enable-admission-plugins` 플래그에 포함되어야 하는 보안 관련 admission controller로 적절하지 않은 것은?

A) PodSecurity
B) NodeRestriction
C) AlwaysAdmit
D) ServiceAccount

<details><summary>정답 확인</summary>

**정답: C) AlwaysAdmit ✅**

`AlwaysAdmit`은 모든 요청을 무조건 승인하므로 보안상 사용해서는 안 된다. `PodSecurity`(PSA), `NodeRestriction`(kubelet의 권한 제한), `ServiceAccount`(SA 자동 설정)는 보안을 위해 활성화해야 하는 admission controller이다.

</details>

---

## Kubernetes Security Fundamentals (9문항)

### 문제 16.
RBAC에서 Role과 ClusterRole의 차이점으로 올바른 것은?

A) Role은 네임스페이스 범위이고, ClusterRole은 클러스터 범위이다
B) Role은 클러스터 범위이고, ClusterRole은 네임스페이스 범위이다
C) 둘 다 클러스터 범위이며 차이가 없다
D) Role은 읽기 전용이고, ClusterRole은 읽기/쓰기 권한을 가진다

<details><summary>정답 확인</summary>

**정답: A) Role은 네임스페이스 범위이고, ClusterRole은 클러스터 범위이다 ✅**

Role은 특정 네임스페이스 내에서만 유효한 권한을 정의하고, ClusterRole은 클러스터 전체 범위 또는 네임스페이스에 속하지 않는 리소스(nodes, namespaces 등)에 대한 권한을 정의한다. 단, RoleBinding을 통해 ClusterRole을 특정 네임스페이스에 바인딩하면 해당 네임스페이스 내에서만 권한이 적용된다.

</details>

### 문제 17.
NetworkPolicy에서 `podSelector: {}`의 의미는?

A) 어떤 Pod도 선택하지 않는다
B) 해당 네임스페이스의 모든 Pod를 선택한다
C) 라벨이 없는 Pod만 선택한다
D) 기본(default) 네임스페이스의 Pod만 선택한다

<details><summary>정답 확인</summary>

**정답: B) 해당 네임스페이스의 모든 Pod를 선택한다 ✅**

빈 셀렉터 `{}`는 해당 네임스페이스의 모든 Pod를 선택한다. tart-infra의 dev 클러스터에서 `default-deny` CiliumNetworkPolicy가 `endpointSelector: {}`를 사용하여 demo 네임스페이스의 모든 Pod에 기본 차단 정책을 적용하고 있다.

</details>

### 문제 18.
Kubernetes Secret의 기본 저장 방식은?

A) AES-256으로 암호화하여 etcd에 저장한다
B) Base64로 인코딩하여 etcd에 평문으로 저장한다
C) HashiCorp Vault에 자동으로 저장한다
D) 각 노드의 로컬 파일시스템에 저장한다

<details><summary>정답 확인</summary>

**정답: B) Base64로 인코딩하여 etcd에 평문으로 저장한다 ✅**

기본 설정에서 Secret은 Base64 인코딩된 형태로 etcd에 저장되며, 이는 암호화가 아니다. EncryptionConfiguration을 설정해야 etcd에서 Secret이 암호화된다. tart-infra의 demo 네임스페이스에 postgres, keycloak 등의 패스워드가 Secret으로 저장되어 있다.

</details>

### 문제 19.
Pod Security Admission의 `restricted` 수준에서 반드시 설정해야 하는 것이 아닌 것은?

A) `runAsNonRoot: true`
B) `allowPrivilegeEscalation: false`
C) `readOnlyRootFilesystem: true`
D) `seccompProfile.type: RuntimeDefault`

<details><summary>정답 확인</summary>

**정답: C) `readOnlyRootFilesystem: true` ✅**

`readOnlyRootFilesystem`은 보안 모범 사례이지만, PSA `restricted` 수준의 필수 요구사항은 아니다. `restricted` 수준에서 필수인 것은 `runAsNonRoot`, `allowPrivilegeEscalation: false`, `capabilities.drop: ALL`, `seccompProfile` 설정 등이다.

</details>

### 문제 20.
다음 중 Kubernetes ServiceAccount에 대한 설명으로 올바른 것은?

A) ServiceAccount는 클러스터 범위의 리소스이다
B) 각 네임스페이스에 `default` ServiceAccount가 자동 생성된다
C) ServiceAccount 토큰은 만료 기한이 없다
D) Pod는 반드시 ServiceAccount를 명시해야 실행된다

<details><summary>정답 확인</summary>

**정답: B) 각 네임스페이스에 `default` ServiceAccount가 자동 생성된다 ✅**

모든 네임스페이스에는 `default` ServiceAccount가 자동 생성된다. ServiceAccount는 네임스페이스 범위의 리소스이며, Pod에 ServiceAccount를 명시하지 않으면 `default`가 사용된다. Kubernetes 1.24부터 TokenRequest API를 통해 시간 제한이 있는 토큰이 발급된다.

</details>

### 문제 21.
CiliumNetworkPolicy에서 L7 정책으로 HTTP GET 메서드만 허용하려면 어떤 필드를 사용하는가?

A) `spec.ingress.toPorts.rules.http`
B) `spec.ingress.fromPorts.http`
C) `spec.rules.httpFilter`
D) `spec.ingress.l7Rules.httpMethod`

<details><summary>정답 확인</summary>

**정답: A) `spec.ingress.toPorts.rules.http` ✅**

CiliumNetworkPolicy는 `toPorts.rules.http` 필드를 통해 HTTP 메서드, 경로 등 L7 수준의 필터링을 지원한다. tart-infra의 dev 클러스터에서 `allow-nginx-to-httpbin` 정책이 GET 메서드만 허용하는 L7 필터링을 적용하고 있다. 이는 표준 NetworkPolicy로는 불가능한 기능이다.

</details>

### 문제 22.
OPA Gatekeeper에서 ConstraintTemplate과 Constraint의 관계는?

A) ConstraintTemplate은 정책 인스턴스이고, Constraint는 정책 정의이다
B) ConstraintTemplate은 정책 로직을 정의하고, Constraint는 해당 정책의 구체적 파라미터와 적용 범위를 지정한다
C) 둘은 독립적이며 관계가 없다
D) Constraint가 먼저 생성되어야 ConstraintTemplate을 생성할 수 있다

<details><summary>정답 확인</summary>

**정답: B) ConstraintTemplate은 정책 로직을 정의하고, Constraint는 해당 정책의 구체적 파라미터와 적용 범위를 지정한다 ✅**

ConstraintTemplate은 Rego 언어로 정책 로직을 정의하며, 새로운 CRD를 생성한다. Constraint는 해당 CRD의 인스턴스로서 구체적인 파라미터(예: 필수 레이블 목록, 허용 레지스트리 목록)와 적용 범위(어떤 리소스, 어떤 네임스페이스)를 지정한다.

</details>

### 문제 23.
Kubernetes에서 Secret을 안전하게 관리하기 위한 방법으로 적절하지 않은 것은?

A) RBAC로 Secret 접근 권한을 제한한다
B) Secret을 환경 변수 대신 Volume으로 마운트한다
C) Secret 데이터를 Git 저장소에 평문으로 커밋한다
D) External Secrets Operator를 사용하여 외부 비밀 관리 시스템과 연동한다

<details><summary>정답 확인</summary>

**정답: C) Secret 데이터를 Git 저장소에 평문으로 커밋한다 ✅**

Secret을 Git에 평문으로 저장하면 심각한 보안 위험이 발생한다. Sealed Secrets, SOPS, External Secrets Operator 등을 사용하여 암호화된 형태로 관리해야 한다. 환경 변수보다 Volume 마운트가 권장되는 이유는 환경 변수가 로그나 프로세스 목록에 노출될 수 있기 때문이다.

</details>

### 문제 24.
다음 SecurityContext 설정에서 `capabilities.drop: ["ALL"]`의 효과는?

A) 컨테이너의 모든 네트워크 기능을 비활성화한다
B) 컨테이너의 모든 Linux Capabilities를 제거한다
C) 컨테이너의 모든 환경 변수를 제거한다
D) 컨테이너의 파일 시스템을 읽기 전용으로 만든다

<details><summary>정답 확인</summary>

**정답: B) 컨테이너의 모든 Linux Capabilities를 제거한다 ✅**

Linux Capabilities는 root 권한을 세분화한 것이다. `drop: ALL`로 모든 capability를 제거한 후, 필요한 것만 `add`로 추가하는 것이 최소 권한 원칙에 따른 올바른 접근법이다. PSA `restricted` 수준에서는 `drop: ALL`이 필수이다.

</details>

---

## Kubernetes Threat Model (6문항)

### 문제 25.
STRIDE 위협 모델에서 "S"가 의미하는 위협 유형은?

A) Social Engineering
B) Spoofing
C) SQL Injection
D) Session Hijacking

<details><summary>정답 확인</summary>

**정답: B) Spoofing ✅**

STRIDE는 Spoofing(위장), Tampering(변조), Repudiation(부인), Information Disclosure(정보 노출), Denial of Service(서비스 거부), Elevation of Privilege(권한 상승)의 약자이다. Kubernetes에서 Spoofing의 예시로는 위조된 ServiceAccount 토큰으로 API Server에 접근하는 시도가 있다.

</details>

### 문제 26.
Kubernetes 클러스터에서 컨테이너 탈출(container escape)의 위험이 가장 높은 설정은?

A) `readOnlyRootFilesystem: true`
B) `privileged: true`
C) `runAsNonRoot: true`
D) `allowPrivilegeEscalation: false`

<details><summary>정답 확인</summary>

**정답: B) `privileged: true` ✅**

`privileged: true`로 설정된 컨테이너는 호스트의 모든 디바이스에 접근 가능하고, 모든 Linux Capabilities를 갖는다. 이는 컨테이너에서 호스트로 탈출할 수 있는 가장 직접적인 경로이다. PSA `baseline` 수준에서부터 privileged 컨테이너를 금지한다.

</details>

### 문제 27.
Kubernetes에서 Supply Chain Attack(공급망 공격)의 방어 방법이 아닌 것은?

A) 이미지 서명 검증(cosign, Notary)
B) 이미지 취약점 스캔(Trivy, Grype)
C) 프라이빗 레지스트리 사용
D) Pod에 더 많은 리소스(CPU/Memory)를 할당한다

<details><summary>정답 확인</summary>

**정답: D) Pod에 더 많은 리소스(CPU/Memory)를 할당한다 ✅**

리소스 할당은 성능 관련 설정이며 공급망 보안과 무관하다. 공급망 보안은 이미지 서명 검증, 취약점 스캔, 신뢰할 수 있는 레지스트리 사용, SBOM 생성 등으로 강화한다. tart-infra에서 사용하는 이미지들(docker.io, quay.io, ghcr.io)의 출처를 확인하는 것이 공급망 보안의 첫 단계이다.

</details>

### 문제 28.
Kubernetes에서 RBAC 권한 상승(privilege escalation) 방지를 위한 사항이 아닌 것은?

A) `cluster-admin` ClusterRole의 사용을 최소화한다
B) 와일드카드(`*`) 권한을 피한다
C) `escalate`, `bind` verb의 사용을 제한한다
D) 모든 ServiceAccount에 `cluster-admin` 권한을 부여하여 일관성을 유지한다

<details><summary>정답 확인</summary>

**정답: D) 모든 ServiceAccount에 `cluster-admin` 권한을 부여하여 일관성을 유지한다 ✅**

모든 ServiceAccount에 cluster-admin 권한을 부여하는 것은 최소 권한 원칙에 완전히 반대되는 행위이다. 공격자가 단 하나의 Pod만 침해하더라도 클러스터 전체를 장악할 수 있게 된다. `escalate`와 `bind` verb는 사용자가 자신보다 더 높은 권한을 부여할 수 있게 하므로 특히 주의해야 한다.

</details>

### 문제 29.
Kubernetes 환경에서 런타임 보안 모니터링 도구로 적합한 것은?

A) Terraform
B) Falco
C) Helm
D) ArgoCD

<details><summary>정답 확인</summary>

**정답: B) Falco ✅**

Falco는 CNCF 프로젝트로, 커널 시스템 콜을 모니터링하여 컨테이너의 비정상적인 행위(예: 예상하지 못한 쉘 실행, 민감 파일 접근, 네트워크 활동)를 실시간으로 탐지한다. Terraform은 IaC 도구, Helm은 패키지 매니저, ArgoCD는 GitOps 도구이다.

</details>

### 문제 30.
Kubernetes Pod에서 호스트 네트워크 네임스페이스를 사용(`hostNetwork: true`)할 때의 보안 위험은?

A) Pod가 더 많은 메모리를 사용한다
B) Pod가 호스트의 네트워크 인터페이스에 직접 접근하여 네트워크 격리가 무효화된다
C) Pod의 로그가 호스트에 저장된다
D) Pod의 CPU 사용량이 증가한다

<details><summary>정답 확인</summary>

**정답: B) Pod가 호스트의 네트워크 인터페이스에 직접 접근하여 네트워크 격리가 무효화된다 ✅**

`hostNetwork: true`로 설정하면 Pod가 노드의 네트워크 네임스페이스를 공유한다. 이는 NetworkPolicy가 적용되지 않고, 호스트의 모든 네트워크 인터페이스(127.0.0.1 포함)에 접근 가능하며, 다른 Pod와 노드 서비스를 직접 접근할 수 있어 심각한 보안 위험이 된다.

</details>

---

## Platform Security (6문항)

### 문제 31.
서비스 메시에서 mTLS(Mutual TLS)의 역할은?

A) 서비스 간 통신을 로드 밸런싱한다
B) 서비스 간 통신을 암호화하고 양방향 인증을 수행한다
C) 서비스의 health check를 수행한다
D) 서비스의 자동 스케일링을 관리한다

<details><summary>정답 확인</summary>

**정답: B) 서비스 간 통신을 암호화하고 양방향 인증을 수행한다 ✅**

mTLS는 클라이언트와 서버 양쪽 모두 인증서를 제시하여 상호 인증을 수행하고 통신을 암호화한다. tart-infra의 dev 클러스터에서 Istio가 STRICT 모드로 mTLS를 적용하여 demo 네임스페이스의 모든 서비스 간 통신을 보호하고 있다.

</details>

### 문제 32.
Istio의 PeerAuthentication에서 STRICT 모드와 PERMISSIVE 모드의 차이는?

A) STRICT는 mTLS만 허용하고, PERMISSIVE는 mTLS와 평문 트래픽을 모두 허용한다
B) STRICT는 외부 트래픽을 차단하고, PERMISSIVE는 허용한다
C) STRICT는 인증서 갱신을 하지 않고, PERMISSIVE는 자동 갱신한다
D) 둘의 차이는 없다

<details><summary>정답 확인</summary>

**정답: A) STRICT는 mTLS만 허용하고, PERMISSIVE는 mTLS와 평문 트래픽을 모두 허용한다 ✅**

STRICT 모드에서는 mTLS 연결만 허용하여 암호화되지 않은 트래픽을 거부한다. PERMISSIVE 모드는 마이그레이션 기간에 사용하며, mTLS와 평문 트래픽을 모두 수용한다. tart-infra의 dev 클러스터에서 `kubectl get peerauthentication -n demo`로 STRICT 설정을 확인할 수 있다.

</details>

### 문제 33.
컨테이너 런타임의 보안 격리를 강화하는 기술이 아닌 것은?

A) gVisor (runsc)
B) Kata Containers
C) Docker Compose
D) seccomp profile

<details><summary>정답 확인</summary>

**정답: C) Docker Compose ✅**

Docker Compose는 다중 컨테이너 애플리케이션 정의 도구이며, 보안 격리 기술이 아니다. gVisor는 사용자 공간 커널로 시스템 콜을 중재하고, Kata Containers는 경량 VM으로 컨테이너를 실행하며, seccomp은 시스템 콜을 필터링하여 보안 격리를 강화한다.

</details>

### 문제 34.
CNI(Container Network Interface) 플러그인이 제공하는 보안 기능이 아닌 것은?

A) NetworkPolicy 구현
B) Pod 간 트래픽 암호화 (WireGuard 등)
C) RBAC 권한 관리
D) L3/L4 네트워크 접근 제어

<details><summary>정답 확인</summary>

**정답: C) RBAC 권한 관리 ✅**

RBAC는 API Server가 관리하는 Kubernetes 내장 기능이며, CNI 플러그인과 무관하다. tart-infra에서 사용하는 Cilium은 NetworkPolicy 구현, WireGuard 기반 트래픽 암호화, L3/L4/L7 접근 제어, CiliumNetworkPolicy를 통한 확장된 보안 기능을 제공한다.

</details>

### 문제 35.
이미지 스캐닝 도구(Trivy 등)가 탐지하는 대상이 아닌 것은?

A) OS 패키지의 알려진 취약점(CVE)
B) 애플리케이션 라이브러리의 취약점
C) 잘못된 설정(Misconfiguration)
D) 런타임 시 발생하는 이상 행위

<details><summary>정답 확인</summary>

**정답: D) 런타임 시 발생하는 이상 행위 ✅**

이미지 스캐너는 정적 분석 도구로, 이미지 내 OS 패키지, 라이브러리 취약점, IaC 설정 오류 등을 탐지한다. 런타임 이상 행위 탐지는 Falco, Sysdig 등의 런타임 보안 도구가 담당한다.

</details>

### 문제 36.
Kubernetes Ingress/Gateway에서 TLS를 종료(terminate)할 때 반드시 확인해야 하는 보안 사항은?

A) Ingress Controller의 CPU 사용량
B) TLS 인증서의 유효 기간과 최소 TLS 버전 설정
C) Ingress Controller의 레플리카 수
D) Ingress 리소스의 네임스페이스

<details><summary>정답 확인</summary>

**정답: B) TLS 인증서의 유효 기간과 최소 TLS 버전 설정 ✅**

TLS 종료 시 인증서 만료, TLS 1.0/1.1 같은 취약한 프로토콜 버전 사용, 약한 암호화 스위트 사용 등을 점검해야 한다. cert-manager를 통한 자동 인증서 갱신과 최소 TLS 1.2(권장 TLS 1.3) 설정이 중요하다.

</details>

---

## Compliance and Security Frameworks (4문항)

### 문제 37.
CIS Kubernetes Benchmark의 주요 목적은?

A) Kubernetes 클러스터의 성능을 최적화한다
B) Kubernetes 클러스터의 보안 설정을 점검하는 표준 가이드라인을 제공한다
C) Kubernetes 클러스터의 네트워크 대역폭을 측정한다
D) Kubernetes 클러스터의 스토리지 용량을 관리한다

<details><summary>정답 확인</summary>

**정답: B) Kubernetes 클러스터의 보안 설정을 점검하는 표준 가이드라인을 제공한다 ✅**

CIS(Center for Internet Security) Kubernetes Benchmark는 API Server, etcd, kubelet, 스케줄러 등의 보안 설정을 점검하는 표준 가이드라인이다. kube-bench 도구를 사용하여 자동으로 점검할 수 있다. tart-infra 클러스터에서 kube-bench를 실행하여 CIS 벤치마크 준수 여부를 확인할 수 있다.

</details>

### 문제 38.
Kubernetes 환경에서 GDPR(General Data Protection Regulation) 준수를 위해 고려해야 하는 사항이 아닌 것은?

A) Secret에 저장된 개인정보의 암호화
B) Audit 로그를 통한 개인정보 접근 기록
C) Pod의 CPU 리소스 요청량 설정
D) 데이터 보존 기간 정책 수립

<details><summary>정답 확인</summary>

**정답: C) Pod의 CPU 리소스 요청량 설정 ✅**

CPU 리소스 설정은 성능 및 안정성 관련 설정이며 GDPR 준수와 무관하다. GDPR은 개인정보 보호에 관한 규정으로, 데이터 암호화, 접근 감사, 데이터 보존 정책, 삭제 권리(Right to Erasure) 등이 핵심 요구사항이다.

</details>

### 문제 39.
kube-bench가 점검하는 항목이 아닌 것은?

A) API Server의 보안 플래그 설정
B) etcd의 TLS 설정
C) kubelet의 인증/인가 설정
D) 애플리케이션 코드의 취약점

<details><summary>정답 확인</summary>

**정답: D) 애플리케이션 코드의 취약점 ✅**

kube-bench는 CIS Kubernetes Benchmark에 따라 클러스터 컴포넌트(API Server, etcd, kubelet, 스케줄러, 컨트롤러 매니저)의 보안 설정을 점검한다. 애플리케이션 코드 취약점은 SAST(Static Application Security Testing) 도구나 SCA(Software Composition Analysis) 도구가 담당한다.

</details>

### 문제 40.
SOC 2 Type II 인증과 관련하여 Kubernetes 환경에서 가장 중요한 것은?

A) Pod 수를 최대한 많이 배포한다
B) 지속적인 보안 통제의 운영 효과성을 입증한다
C) 최신 버전의 Kubernetes를 항상 사용한다
D) 모든 워크로드를 단일 네임스페이스에 배포한다

<details><summary>정답 확인</summary>

**정답: B) 지속적인 보안 통제의 운영 효과성을 입증한다 ✅**

SOC 2 Type II는 일정 기간(보통 6-12개월) 동안 보안 통제가 실제로 효과적으로 운영되었는지를 평가한다. Kubernetes 환경에서는 RBAC 설정, Audit 로그, 네트워크 정책, 취약점 관리, 변경 관리 등의 통제가 지속적으로 운영되고 있음을 문서화하고 입증해야 한다. Prometheus + Grafana 같은 모니터링 시스템의 로그가 증거 자료로 활용된다.

</details>

---

## 채점 및 학습 가이드

### 합격 기준
- KCSA 시험 합격 기준: **75%** (40문항 기준 30문항 이상 정답)

### 도메인별 자가 진단

| 도메인 | 문항 번호 | 맞은 수 / 전체 |
|--------|-----------|----------------|
| Cloud Native Security Overview | 1-6 | /6 |
| Cluster Component Security | 7-15 | /9 |
| Security Fundamentals | 16-24 | /9 |
| Threat Model | 25-30 | /6 |
| Platform Security | 31-36 | /6 |
| Compliance | 37-40 | /4 |
| **합계** | **1-40** | **/40** |

### 약점 보완 전략

- **Cloud Native Security**: 4C 모델, SBOM, Sigstore, DevSecOps 개념을 복습한다
- **Cluster Component Security**: API Server, etcd, kubelet의 보안 플래그를 암기한다
- **Security Fundamentals**: RBAC, NetworkPolicy, PSA YAML을 직접 작성해 본다
- **Threat Model**: STRIDE 모델을 Kubernetes 컴포넌트에 매핑하여 연습한다
- **Platform Security**: Istio mTLS, Cilium, 런타임 보안 도구를 이해한다
- **Compliance**: CIS Benchmark, SOC 2, GDPR의 핵심 개념을 정리한다
