# KCSA Day 3: API Server, etcd, kubelet 보안

> **시험 비중:** Kubernetes Cluster Component Security — 22% (가장 높은 비중)
> **목표:** API Server의 3단계 요청 처리, etcd 보안, kubelet 보안, Control Plane TLS 통신을 완벽히 이해한다.

---

## 1. API Server 보안 — 3단계 요청 처리 흐름

### 1.0 등장 배경

```
기존 방식의 한계:
초기 Kubernetes에서는 API Server 인증이 정적 토큰 파일(--token-auth-file)이나
Basic Auth에 의존했다. 이 방식의 문제:

1. 정적 토큰은 파일에 평문으로 저장되며, 변경 시 API Server 재시작이 필요하다
2. Basic Auth는 HTTP 헤더에 비밀번호가 Base64로만 인코딩되어 전송된다
3. 인가 모드가 AlwaysAllow이면 인증된 사용자가 모든 작업을 수행할 수 있다
4. Admission Control이 없으면 악성 Pod 스펙을 검증 없이 배포할 수 있다

해결:
API Server의 3단계 직렬 파이프라인(Authentication → Authorization → Admission)은
각 단계가 독립적인 보안 게이트로 작동한다. X.509/OIDC 인증, Node+RBAC 인가,
Mutating/Validating Admission으로 다층 방어를 구현한다.
```

### 1.1 API Server 3단계 요청 처리 파이프라인

```
API Server는 모든 요청을 직렬 파이프라인(Serial Pipeline)으로 처리한다.
각 단계를 통과해야만 다음 단계로 진행되며, 실패 시 즉시 거부된다.

[요청 도착 (HTTPS/TLS 1.2+)]
    │
    ▼
[1단계: 인증 (Authentication)]    ── Identity 확인
    │  X.509, OIDC, SA Token 등으로 요청자 식별
    │  인증 실패 → 401 Unauthorized (RFC 7235)
    │
    ▼
[2단계: 인가 (Authorization)]     ── 권한 검증
    │  RBAC/Node/Webhook으로 리소스별 동사(verb) 권한 확인
    │  권한 없음 → 403 Forbidden (RFC 7231)
    │
    ▼
[3단계: Admission Control]        ── 정책 적용 (Mutating → Validating)
    │  오브젝트 변환(Mutation) 및 정책 검증(Validation)
    │  정책 위반 → 403 Forbidden
    │
    ▼
[etcd 저장]                       ── Persistent State 기록
```

### 1.2 1단계: 인증(Authentication) 상세

#### 인증 방법 비교표

| 인증 방법 | 메커니즘 | 보안 수준 | 권장 여부 |
|----------|----------|---------|----------|
| **X.509 클라이언트 인증서** | PKI 기반 상호 TLS | 높음 | 권장 (컴포넌트 간) |
| **OIDC** | OAuth 2.0 + ID Token | 높음 | 권장 (사용자) |
| **ServiceAccount Token** | Bound JWT (TokenRequest API) | 보통 | 권장 (Pod) |
| **Webhook Token** | HTTP Callback 검증 | 보통 | 상황에 따라 |
| **Bearer Token (정적)** | 파일 기반 정적 토큰 | 낮음 | 비권장 |
| **Basic Auth** | HTTP Basic Authentication | 매우 낮음 | 사용 금지 |

#### X.509 인증서 인증 흐름

```
[kubectl]                              [API Server]
    │                                      │
    │  1. TLS 핸드셰이크 시작                │
    │─────────────────────────────────────>│
    │                                      │
    │  2. 서버 인증서 전송                   │
    │<─────────────────────────────────────│
    │                                      │
    │  3. 클라이언트 인증서 전송              │
    │  (kubeconfig에 설정된 client-cert)     │
    │─────────────────────────────────────>│
    │                                      │
    │  4. 인증서의 CN(Common Name) →        │
    │     사용자 이름으로 사용               │
    │     O(Organization) → 그룹으로 사용    │
    │                                      │
    │  5. 인증서가 --client-ca-file의        │
    │     CA로 서명되었는지 검증              │

예시: CN=admin, O=system:masters
→ 사용자: admin, 그룹: system:masters
→ system:masters 그룹은 모든 RBAC를 우회! (매우 위험)
```

#### ServiceAccount Token 인증 흐름

```
[Pod 생성 시]
    │
    ▼
kubelet이 TokenRequest API를 통해
Bound Service Account Token(JWT) 요청
    │
    ▼
API Server가 JWT 발급:
- iss: kubernetes/serviceaccount
- sub: system:serviceaccount:namespace:sa-name
- aud: ["https://kubernetes.default.svc"]
- exp: 3600 (1시간 기본, 최대 48시간)
    │
    ▼
Projected Volume으로 Pod에 마운트:
/var/run/secrets/kubernetes.io/serviceaccount/
├── token      ← JWT 토큰
├── ca.crt     ← API Server CA 인증서
└── namespace  ← Pod의 네임스페이스
```

#### API Server 인증 관련 핵심 플래그

```yaml
# kube-apiserver 매니페스트 (/etc/kubernetes/manifests/kube-apiserver.yaml)
apiVersion: v1
kind: Pod
metadata:
  name: kube-apiserver
  namespace: kube-system
spec:
  containers:
    - name: kube-apiserver
      image: registry.k8s.io/kube-apiserver:v1.31.0
      command:
        - kube-apiserver

        # === 인증 관련 플래그 ===

        - --anonymous-auth=false
          # 익명 인증 비활성화
          # 기본값: true (위험!)
          # false로 설정하면 인증 없는 요청은 401 반환

        - --client-ca-file=/etc/kubernetes/pki/ca.crt
          # X.509 클라이언트 인증서 인증에 사용할 CA 파일

        - --service-account-issuer=https://kubernetes.default.svc
          # SA 토큰의 issuer (iss 클레임)

        - --service-account-key-file=/etc/kubernetes/pki/sa.pub
          # SA 토큰 서명 검증에 사용할 공개 키

        # - --token-auth-file=/path/to/tokens  ← 사용 금지!
        #   # 정적 토큰 파일: 평문 저장, 갱신 시 재시작 필요
```

### 1.3 2단계: 인가(Authorization) 상세

#### 인가 모드 비교표

| 인가 모드 | 설명 | 권장 여부 |
|----------|------|----------|
| **RBAC** | Role/ClusterRole + Binding으로 역할 기반 접근 제어 | **권장** |
| **Node** | kubelet이 자신의 노드에 스케줄된 Pod만 접근 가능 | **권장 (RBAC와 함께)** |
| **ABAC** | JSON 정책 파일 기반, 변경 시 재시작 필요 | 비권장 |
| **Webhook** | 외부 서비스에 인가 결정 위임 | 특수 상황 |
| **AlwaysAllow** | 모든 요청 허용 | **절대 비권장** |

#### 인가 처리 흐름

```
[인증된 요청]
    │
    ▼
--authorization-mode=Node,RBAC  ← 쉼표로 구분된 순서대로 처리
    │
    ├─ [Node 인가 모듈]
    │   "이 요청이 kubelet에서 온 것인가?"
    │   ├─ Yes: 자신의 노드/Pod에 대한 요청? → 허용/거부
    │   └─ No: 다음 모듈로 전달
    │
    ├─ [RBAC 인가 모듈]
    │   "이 사용자/SA에 해당 리소스에 대한 권한이 있는가?"
    │   ├─ 권한 있음 → 허용
    │   └─ 권한 없음 → 거부
    │
    ▼
모든 모듈에서 거부 → 403 Forbidden

중요: 하나의 모듈이라도 허용하면 → 요청 허용
     모든 모듈이 거부하면 → 요청 거부
```

### 1.4 3단계: Admission Control 상세

#### Admission Control 처리 순서

```
[인증 + 인가 통과]
    │
    ▼
[Mutating Admission Webhooks]     ── 요청을 "수정"하는 단계
    │  - Istio 사이드카 자동 주입
    │  - 기본 리소스 제한 추가 (LimitRanger)
    │  - 기본 ServiceAccount 할당
    │
    ▼
[Object Schema Validation]        ── YAML 스키마 검증
    │
    ▼
[Validating Admission Webhooks]   ── 요청을 "검증"하는 단계
    │  - Pod Security 정책 검증 (PodSecurity)
    │  - OPA/Kyverno 정책 검증
    │  - NodeRestriction (kubelet 제한)
    │
    ▼
[etcd에 저장]

중요: Mutating이 먼저 실행되고 Validating이 나중에 실행된다!
     이유: Mutating에서 추가/수정된 필드를 Validating에서 검증해야 하므로
```

#### 주요 내장 Admission Controller

| Admission Controller | 유형 | 역할 | 보안 중요도 |
|---------------------|------|------|-----------|
| **PodSecurity** | Validating | PSS 정책 적용 (PSP 후속) | 최고 |
| **NodeRestriction** | Validating | kubelet이 자신의 노드/Pod만 수정 가능 | 최고 |
| **ServiceAccount** | Mutating | Pod에 SA 자동 할당, 토큰 마운트 | 높음 |
| **LimitRanger** | Mutating | 리소스 기본값/제한 자동 적용 | 높음 |
| **ResourceQuota** | Validating | 네임스페이스 리소스 총량 제한 | 높음 |
| **NamespaceLifecycle** | Validating | 삭제 중인 NS에 새 리소스 생성 방지 | 보통 |

#### Admission Webhook 예제

```yaml
# Validating Webhook 설정
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: pod-policy-webhook
webhooks:
  - name: pod-policy.example.com
    admissionReviewVersions: ["v1"]
    sideEffects: None

    clientConfig:
      service:
        name: pod-policy-service
        namespace: security
        path: /validate
      caBundle: <base64-encoded-ca-cert>

    rules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
        scope: Namespaced

    failurePolicy: Fail    # Webhook 실패 시: Fail(거부) 또는 Ignore(허용)
                           # 보안 목적: Fail 권장
    timeoutSeconds: 10
```

---

## 2. etcd 보안 심화

### 2.1 etcd의 중요성

```
etcd는 Kubernetes의 유일한 Persistent State Store이다.

etcd 침해 = 전체 클러스터 상태의 기밀성(Confidentiality) 및 무결성(Integrity) 상실이다.

etcd에 저장되는 민감 데이터:
/registry/secrets/...        ← 모든 Secret (DB 비밀번호, API 키, TLS 인증서)
/registry/pods/...           ← 모든 Pod 스펙 (환경변수 포함)
/registry/services/...       ← 모든 Service 엔드포인트
/registry/configmaps/...     ← 모든 ConfigMap (설정 데이터)
/registry/clusterroles/...   ← RBAC 정책 (권한 구조 전체)
```

### 2.2 etcd 보안 설정 상세

```yaml
# /etc/kubernetes/manifests/etcd.yaml (static pod)
apiVersion: v1
kind: Pod
metadata:
  name: etcd
  namespace: kube-system
spec:
  containers:
    - name: etcd
      image: registry.k8s.io/etcd:3.5.15-0
      command:
        - etcd

        # === 서버 TLS 설정 ===
        - --cert-file=/etc/kubernetes/pki/etcd/server.crt
        - --key-file=/etc/kubernetes/pki/etcd/server.key
        - --trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt

        - --client-cert-auth=true
          # 클라이언트 인증서 요구
          # false이면 인증서 없이도 etcd에 접근 가능! (매우 위험)

        # === 피어(peer) TLS 설정 ===
        - --peer-cert-file=/etc/kubernetes/pki/etcd/peer.crt
        - --peer-key-file=/etc/kubernetes/pki/etcd/peer.key
        - --peer-trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt
        - --peer-client-cert-auth=true

        # === 리스닝 주소 ===
        - --listen-client-urls=https://127.0.0.1:2379,https://10.0.0.5:2379
          # 2379: 클라이언트 통신 포트
        - --listen-peer-urls=https://10.0.0.5:2380
          # 2380: 피어 통신 포트

        # === 데이터 디렉토리 ===
        - --data-dir=/var/lib/etcd
          # chmod 700 /var/lib/etcd (소유자만 접근 가능)
```

### 2.3 Encryption at Rest 상세

```yaml
# /etc/kubernetes/enc/encryption-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
      - configmaps
    providers:
      # 프로바이더 순서가 매우 중요!
      # 첫 번째: 새로 저장되는 데이터 암호화에 사용
      # 나머지: 기존 데이터 복호화에 사용

      - secretbox:
          keys:
            - name: key1
              secret: <base64-encoded-32-byte-key>

      - identity: {}
        # 마지막에 identity를 두면 암호화되지 않은 기존 데이터를 읽을 수 있음
```

#### 프로바이더 비교표

| 프로바이더 | 알고리즘 | 프로덕션 권장 | 비고 |
|----------|---------|-------------|------|
| `identity` | 없음 (평문) | 비권장 | 기본값, 암호화 없음 |
| `secretbox` | XSalsa20+Poly1305 | 권장 (로컬) | 가장 빠르고 안전한 로컬 옵션 |
| `aescbc` | AES-CBC | 보통 | 패딩 오라클 공격 가능성 |
| `aesgcm` | AES-GCM | 보통 | nonce 재사용 주의 |
| `kms` v2 | KMS 위임 | **가장 권장** | DEK 캐싱으로 성능 향상 |

#### 기존 데이터 재암호화

```bash
# EncryptionConfiguration 적용 후 반드시 실행
kubectl get secrets --all-namespaces -o json | kubectl replace -f -

# 암호화 확인 (etcd에서 직접 조회)
ETCDCTL_API=3 etcdctl \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/default/my-secret

# 암호화 전: 평문 데이터가 보임
# 암호화 후: k8s:enc:secretbox:v1:key1:... 형태
```

---

## 3. kubelet 보안 심화

### 3.1 kubelet이 위험한 이유

```
kubelet은 각 Worker Node에서 컨테이너 런타임(containerd)을 제어하는 에이전트이다.

kubelet 침해 시 위협:
- 해당 노드의 모든 컨테이너에 대한 임의 명령 실행
- Pod 삭제/변조를 통한 가용성 공격
- 악성 컨테이너 배포를 통한 Lateral Movement

따라서 kubelet API의 인증/인가 설정은 노드 보안의 핵심이다.
```

### 3.2 kubelet 설정 파일 상세

```yaml
# /var/lib/kubelet/config.yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration

# === 인증 설정 ===
authentication:
  anonymous:
    enabled: false              # 익명 접근 차단

  webhook:
    enabled: true               # API Server를 통한 인증
    cacheTTL: 2m

  x509:
    clientCAFile: /etc/kubernetes/pki/ca.crt

# === 인가 설정 ===
authorization:
  mode: Webhook                 # API Server에 인가 위임
                                # AlwaysAllow: 절대 사용 금지!

# === 보안 포트 설정 ===
readOnlyPort: 0                 # 읽기 전용 포트 비활성화
                                # 기본값: 10255 (위험!)
                                # 반드시 0으로 설정!

port: 10250                     # kubelet HTTPS 포트

# === TLS 설정 ===
tlsCertFile: /var/lib/kubelet/pki/kubelet.crt
tlsPrivateKeyFile: /var/lib/kubelet/pki/kubelet.key

# === 인증서 로테이션 ===
rotateCertificates: true
serverTLSBootstrap: true

# === 커널 보안 ===
protectKernelDefaults: true
```

### 3.3 kubelet 포트 비교

```
kubelet의 두 포트:

┌─────────────────────────────────────────────┐
│  Port 10250 (HTTPS - 보안 포트)              │
│  - TLS 암호화 통신                            │
│  - 인증 필요 (X.509 또는 Bearer Token)        │
│  - 인가 필요 (Webhook)                        │
│  - API: Pod 실행, 로그 조회, exec, 메트릭      │
│  - 반드시 활성화해야 함                        │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Port 10255 (HTTP - 읽기 전용 포트)           │
│  - 평문 통신 (암호화 없음!)                    │
│  - 인증 없음! (누구나 접근 가능)               │
│  - Pod 환경 변수, 노드 정보 노출               │
│                                              │
│  ★★★ 반드시 --read-only-port=0 으로 비활성화! │
└─────────────────────────────────────────────┘
```

---

## 4. 기타 컴포넌트 보안

### 4.1 kube-controller-manager 보안

```yaml
# /etc/kubernetes/manifests/kube-controller-manager.yaml
spec:
  containers:
    - command:
        - kube-controller-manager
        - --use-service-account-credentials=true
          # 각 컨트롤러가 별도의 SA 자격 증명 사용
        - --bind-address=127.0.0.1
          # 메트릭 서버를 localhost에만 바인딩
        - --profiling=false
          # 프로파일링 비활성화
```

### 4.2 Control Plane TLS 통신 전체 지도

```
Control Plane 컴포넌트 간 TLS 통신

                    ┌──────────────────────┐
                    │      API Server      │
                    │ (/etc/kubernetes/pki/)│
                    └───┬──┬──┬──┬──┬──────┘
                        │  │  │  │  │
   mTLS ────────────────┘  │  │  │  └── TLS ──── kubectl
   (클라이언트 인증서)      │  │  │
                           │  │  │
   ┌───────────────────────┘  │  └───────────────────────┐
   │                          │                          │
   ▼                          ▼                          ▼
┌──────────┐          ┌──────────────┐          ┌──────────────┐
│  etcd    │          │  controller  │          │  scheduler   │
│  (2379)  │          │  -manager    │          │              │
│  mTLS!   │          │  TLS         │          │  TLS         │
└──────────┘          └──────────────┘          └──────────────┘

                    ┌──────────────────────┐
                    │      API Server      │
                    └───────────┬──────────┘
                                │ TLS
                    ┌───────────▼──────────┐
                    │     kubelet (10250)   │
                    └──────────────────────┘

인증서 파일 정리 (/etc/kubernetes/pki/):
├── ca.crt / ca.key                 ← 클러스터 CA
├── apiserver.crt / apiserver.key   ← API Server 서버 인증서
├── apiserver-kubelet-client.crt    ← API Server → kubelet 클라이언트 인증서
├── apiserver-etcd-client.crt       ← API Server → etcd 클라이언트 인증서
├── sa.pub / sa.key                 ← SA 토큰 서명 키
└── etcd/
    ├── ca.crt / ca.key             ← etcd CA
    ├── server.crt / server.key     ← etcd 서버 인증서
    └── peer.crt / peer.key         ← etcd 피어 인증서
```

### 4.3 인증서 유효 기간

```
kubeadm 기본 인증서 유효 기간:

┌─────────────────────────────────────────┐
│  CA 인증서         : 10년                │
│  컴포넌트 인증서    : 1년                 │
│  SA 키              : 만료 없음           │
└─────────────────────────────────────────┘

갱신 방법:
$ kubeadm certs check-expiration    ← 만료일 확인
$ kubeadm certs renew all           ← 모든 인증서 갱신
$ systemctl restart kubelet         ← 갱신 후 재시작 필요
```

---

## 5. 핵심 암기 항목

```
API Server 3단계: 인증 → 인가 → Admission
인가 권장: --authorization-mode=Node,RBAC
Admission 순서: Mutating → Validating
익명 접근 차단: --anonymous-auth=false

etcd 포트: 2379(클라이언트), 2380(피어)
etcd 보안: TLS + client-cert-auth + Encryption at Rest
Encryption 권장: kms v2 (프로덕션), secretbox (로컬)
EncryptionConfig 순서: 첫 번째 = 암호화용, 나머지 = 복호화용

kubelet 포트: 10250(보안, HTTPS), 10255(위험, HTTP)
kubelet 보안: anonymous-auth=false, authorization-mode=Webhook, read-only-port=0

인증서 위치: /etc/kubernetes/pki/
인증서 유효기간: 컴포넌트 1년, CA 10년
```

---

## 6. 복습 체크리스트

- [ ] API Server의 3단계 처리 흐름(인증→인가→Admission)을 설명할 수 있다
- [ ] 6가지 인증 방법을 나열하고 권장 여부를 알고 있다
- [ ] 인가 모드 중 권장 설정(Node,RBAC)과 각 모드의 역할을 설명할 수 있다
- [ ] Mutating과 Validating Admission의 순서와 차이를 설명할 수 있다
- [ ] 주요 내장 Admission Controller를 나열할 수 있다
- [ ] etcd 보안 설정(TLS, client-cert-auth, Encryption at Rest)을 설명할 수 있다
- [ ] EncryptionConfiguration의 프로바이더 순서의 의미를 알고 있다
- [ ] kubelet 보안 설정의 권장 값을 기억한다
- [ ] 10250(보안)과 10255(읽기전용) 포트의 차이를 설명할 수 있다
- [ ] 인증서 저장 위치와 유효 기간을 알고 있다

---

## 내일 예고: Day 4 - CIS Benchmark, Static Pod, 컴포넌트 보안 YAML, 연습 문제

- CIS Benchmark와 kube-bench
- Static Pod 보안 특성
- 보안 관련 YAML 예제 모음
- Pod 생성 전체 보안 흐름
- 연습 문제 18문제 + 상세 해설
- tart-infra 실습

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속 (API Server, etcd, kubelet 보안 확인)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: API Server 인증/인가/Admission 3단계 확인

```bash
# API Server의 보안 플래그 확인
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml | grep -E "(--anonymous|--authorization|--enable-admission|--client-ca|--tls-cert)"
```

**검증 — 기대 출력:**
```text
    - --authorization-mode=Node,RBAC
    - --client-ca-file=/etc/kubernetes/pki/ca.crt
    - --enable-admission-plugins=NodeRestriction
    - --tls-cert-file=/etc/kubernetes/pki/apiserver.crt
```
`--anonymous-auth`가 출력에 없으면 기본값 true로 동작하므로 명시적으로 false 설정이 필요하다.

**동작 원리:** API 요청 처리 3단계:
1. **인증(Authentication)**: 요청자의 신원을 확인한다 (X.509, Bearer Token, OIDC)
2. **인가(Authorization)**: RBAC으로 리소스/동작에 대한 권한을 확인한다
3. **Admission Control**: Mutating(수정) → Validating(검증) 순으로 처리한다
4. 모든 단계를 통과해야 etcd에 저장된다

### 실습 2: etcd 보안 설정 확인

```bash
# etcd Pod의 보안 플래그 확인
kubectl get pod etcd-dev-master -n kube-system -o yaml | grep -E "(--cert-file|--key-file|--trusted-ca|--client-cert-auth|--peer)"
```

**동작 원리:** etcd 보안 설정:
1. `--cert-file/--key-file`: etcd 서버 TLS 인증서
2. `--client-cert-auth=true`: 클라이언트 인증서를 요구 (API Server만 접근 가능)
3. `--peer-cert/key-file`: etcd 피어 간 통신 암호화
4. `--trusted-ca-file`: 이 CA가 서명한 인증서만 허용

### 실습 3: kubelet 보안 확인

```bash
# kubelet 포트 확인
# 보안 포트(10250): HTTPS, 인증 필요
# 읽기전용 포트(10255): HTTP, 인증 없음 — 비활성화 권장

# kubelet 설정 확인 (SSH 접속 필요)
# tart ssh dev-master
# sudo cat /var/lib/kubelet/config.yaml | grep -E "(authentication|authorization|readOnlyPort)"
```

**동작 원리:** kubelet 보안 권장 설정:
1. `authentication.anonymous.enabled: false` — 익명 접근 차단
2. `authentication.webhook.enabled: true` — API Server를 통한 인증
3. `authorization.mode: Webhook` — API Server RBAC으로 인가
4. `readOnlyPort: 0` — 10255 포트 비활성화

### 실습 4: 인증서 체계(PKI) 확인

```bash
# API Server가 사용하는 인증서 확인
kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml | grep -E "(/etc/kubernetes/pki)" | sort -u
```

**검증 — 기대 출력:**
```text
    - --client-ca-file=/etc/kubernetes/pki/ca.crt
    - --etcd-cafile=/etc/kubernetes/pki/etcd/ca.crt
    - --etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt
    - --etcd-keyfile=/etc/kubernetes/pki/apiserver-etcd-client.key
    - --kubelet-client-certificate=/etc/kubernetes/pki/apiserver-kubelet-client.crt
    - --tls-cert-file=/etc/kubernetes/pki/apiserver.crt
    - --tls-private-key-file=/etc/kubernetes/pki/apiserver.key
```

**동작 원리:** K8s PKI 구조:
1. `/etc/kubernetes/pki/ca.crt`: 클러스터 루트 CA
2. `apiserver.crt`: API Server TLS 인증서
3. `apiserver-kubelet-client.crt`: API Server → kubelet 통신용
4. `apiserver-etcd-client.crt`: API Server → etcd 통신용
5. 인증서 유효 기간: CA는 10년, 나머지는 1년

### 트러블슈팅: Control Plane 보안 문제

```
장애 시나리오 1: API Server 인증서 만료
  증상: kubectl 명령어 실행 시 "x509: certificate has expired" 에러
  디버깅:
    kubeadm certs check-expiration
    openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -dates
  해결:
    kubeadm certs renew all
    systemctl restart kubelet

장애 시나리오 2: etcd 클라이언트 인증서 불일치
  증상: API Server가 시작되지 않음, "connection refused" 로그
  디버깅:
    kubectl logs kube-apiserver-dev-master -n kube-system --previous
    # 또는 직접 로그 확인: crictl logs <container-id>
  해결: --etcd-certfile과 --etcd-keyfile이 etcd의 --trusted-ca-file CA로
        서명된 인증서인지 확인한다

장애 시나리오 3: kubelet 10255 포트가 열려 있음
  증상: curl http://<node-ip>:10255/pods 로 Pod 정보가 노출됨
  공격-방어 매핑: Information Disclosure(STRIDE) → 정보 노출
  해결: kubelet config.yaml에서 readOnlyPort: 0으로 설정 후 kubelet 재시작
```
