# CKS Day 1: Cluster Setup (1/2) - NetworkPolicy, CIS Benchmark, TLS, 바이너리 검증

> 학습 목표 | CKS 도메인: Cluster Setup (10%) | 예상 소요 시간: 2시간

---

## 오늘의 학습 목표

- NetworkPolicy의 동작 원리를 내부 메커니즘까지 이해한다
- CIS Benchmark와 kube-bench를 사용하여 클러스터 보안 상태를 점검하고 수정한다
- Ingress에 TLS를 설정하여 외부 트래픽을 암호화한다
- 바이너리 무결성 검증으로 변조를 탐지하고 교체한다
- 클라우드 메타데이터 API를 차단하여 정보 유출을 방지한다

---

## 1. NetworkPolicy 완전 정복

### 1.1 NetworkPolicy 개요 및 동작 메커니즘

```
NetworkPolicy 핵심 메커니즘
─────────────────────────────
NetworkPolicy는 CNI 플러그인이 해석하는 선언적 L3/L4 ACL(Access Control List) 규칙이다.
Kubernetes API Server에 NetworkPolicy 리소스가 생성되면, CNI 플러그인(Calico, Cilium 등)의
컨트롤러가 이를 watch하여 데이터플레인 규칙으로 변환한다.

- NetworkPolicy가 없는 상태: 기본적으로 모든 Pod 간 통신이 허용된다(default allow).
  CNI 플러그인은 어떤 패킷 필터링 규칙도 적용하지 않는다.

- Default Deny NetworkPolicy: podSelector: {}와 빈 ingress/egress를 선언하면,
  해당 네임스페이스의 모든 Pod에 대해 화이트리스트 모드가 활성화된다.
  명시적으로 허용하지 않은 트래픽은 CNI 데이터플레인에서 DROP된다.

- Explicit Allow NetworkPolicy: 특정 podSelector, namespaceSelector, ipBlock 조합으로
  src/dst IP, port, protocol을 기반으로 FORWARD 판정을 수행하는 규칙을 정의한다.

- DNS(UDP/TCP 53) 허용: CoreDNS가 Service FQDN을 ClusterIP로 해석하므로,
  Egress Default Deny 적용 시 kube-dns 포트를 명시적으로 허용하지 않으면
  DNS resolution이 실패하여 서비스 디스커버리가 작동하지 않는다.
```

### 1.2 NetworkPolicy 동작 원리 - 내부 메커니즘

```
NetworkPolicy 처리 흐름도
═════════════════════════

1. 사용자가 NetworkPolicy 오브젝트 생성
   │
   ▼
2. API Server가 etcd에 저장
   │
   ▼
3. CNI 플러그인(Cilium/Calico)의 Controller가 감지
   │
   ├─ Cilium: CiliumEndpoint → eBPF 프로그램으로 변환
   │   └─ 커널 레벨에서 패킷 필터링 (iptables 불필요)
   │
   └─ Calico: iptables/ipvs 규칙으로 변환
       └─ 각 노드의 kube-proxy와 협력
   │
   ▼
4. 각 노드의 커널에서 패킷 단위로 허용/차단 판단
   │
   ├─ 허용: 패킷이 목적지 Pod로 전달
   └─ 차단: 패킷 드롭 (타임아웃)

중요: NetworkPolicy는 "방화벽 규칙"이다.
      CNI 플러그인이 NetworkPolicy를 지원하지 않으면 아무 효과가 없다!
      (예: Flannel은 NetworkPolicy를 지원하지 않는다)
```

### 1.3 NetworkPolicy 핵심 원칙

```
NetworkPolicy 규칙 매칭 원리
════════════════════════════

규칙 1: NetworkPolicy가 없으면 → 모든 트래픽 허용 (기본값)
규칙 2: NetworkPolicy가 하나라도 적용되면 → 해당 방향의 미명시 트래픽 차단
규칙 3: 여러 NetworkPolicy가 같은 Pod에 적용되면 → UNION (합집합) 적용
규칙 4: podSelector: {} → 네임스페이스의 모든 Pod 선택
규칙 5: ingress/egress 섹션이 비어있으면 → 해당 방향 모든 트래픽 차단

AND vs OR 조건 (시험 출제 빈도 매우 높음):
────────────────────────────────────────

# OR 조건: 별도의 from 항목 (둘 중 하나만 충족하면 허용)
ingress:
- from:
  - podSelector:        # 조건 A
      matchLabels:
        app: frontend
- from:
  - namespaceSelector:  # 조건 B
      matchLabels:
        env: staging

# AND 조건: 같은 from 항목 안에 (둘 다 충족해야 허용)
ingress:
- from:
  - podSelector:        # 조건 A AND 조건 B
      matchLabels:
        app: frontend
    namespaceSelector:
      matchLabels:
        env: staging
```

### 1.4 Default Deny All - 모든 보안의 시작

```yaml
# Default Deny All NetworkPolicy
# ─────────────────────────────
# 이것은 CKS에서 가장 기본이 되는 정책이다.
# "모든 트래픽을 차단하고, 필요한 것만 명시적으로 허용한다"는 원칙의 구현이다.
apiVersion: networking.k8s.io/v1   # NetworkPolicy API 버전
kind: NetworkPolicy                 # 리소스 종류
metadata:
  name: default-deny-all           # 정책 이름 (시험에서 지정해줌)
  namespace: secure-ns             # 적용할 네임스페이스 (반드시 지정)
spec:
  podSelector: {}                  # {} = 이 네임스페이스의 "모든" Pod에 적용
                                   # 특정 Pod만 선택하려면 matchLabels 사용
  policyTypes:                     # 어떤 방향의 트래픽을 제어할지
  - Ingress                        # 들어오는 트래픽 (이 Pod로 향하는)
  - Egress                         # 나가는 트래픽 (이 Pod에서 나가는)
  # ingress: 와 egress: 섹션이 없으므로 모든 트래픽이 차단된다
  # ingress: [] 와 egress: [] 를 명시해도 같은 효과
```

### 1.5 DNS 허용 패턴 - 반드시 알아야 하는 패턴

```yaml
# DNS 허용 NetworkPolicy
# ─────────────────────
# Egress를 차단하면 DNS(포트 53)도 차단되어 서비스 디스커버리가 안 된다.
# 이 정책을 반드시 함께 적용해야 한다.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns                  # DNS 허용 정책
  namespace: secure-ns
spec:
  podSelector: {}                  # 모든 Pod에 적용
  policyTypes:
  - Egress                         # Egress 방향만 제어
  egress:
  - to: []                         # 모든 대상으로 (kube-dns Pod가 어디에 있든)
    ports:
    - protocol: UDP                # DNS는 주로 UDP 사용
      port: 53
    - protocol: TCP                # DNS over TCP도 허용 (큰 응답, zone transfer)
      port: 53
```

```
왜 DNS를 반드시 허용해야 하는가?
═══════════════════════════════

Pod A에서 "http://backend-svc:8080"에 접속하려면:

1. Pod A → kube-dns(CoreDNS) Pod에 "backend-svc의 IP가 뭐야?" 질의 (UDP 53)
2. kube-dns → "10.96.15.200이야" 응답
3. Pod A → 10.96.15.200:8080으로 TCP 연결

DNS가 차단되면 1단계에서 실패한다.
서비스 이름으로 통신할 수 없고, IP 주소로만 통신해야 한다.
이것은 쿠버네티스의 서비스 디스커버리를 완전히 무력화시킨다.
```

### 1.6 특정 Pod 간 통신 허용 패턴

```yaml
# Frontend → Backend Egress 허용
# ──────────────────────────────
# frontend Pod가 backend Pod의 8080 포트로만 나갈 수 있도록 허용
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend-to-backend-egress
  namespace: secure-ns
spec:
  podSelector:
    matchLabels:
      app: frontend                # 이 정책은 frontend Pod에만 적용
  policyTypes:
  - Egress
  egress:
  # 규칙 1: DNS 허용
  - to: []
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  # 규칙 2: backend Pod의 8080 포트만 허용
  - to:
    - podSelector:
        matchLabels:
          app: backend             # 같은 네임스페이스의 app=backend Pod로만
    ports:
    - protocol: TCP
      port: 8080                   # 8080 포트만 허용
---
# Backend Ingress 허용 (Egress만으로는 안 됨! 양쪽 모두 허용해야 함)
# ─────────────────────────────────────────────────────────────────
# 중요: Default Deny가 적용된 상태에서는 Egress 허용 + Ingress 허용 둘 다 필요하다!
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-from-frontend-ingress
  namespace: secure-ns
spec:
  podSelector:
    matchLabels:
      app: backend                 # backend Pod에 적용
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: frontend            # frontend Pod에서 오는 트래픽만 허용
    ports:
    - protocol: TCP
      port: 8080
```

### 1.7 네임스페이스 간 통신 허용

```yaml
# 다른 네임스페이스(monitoring)에서 현재 네임스페이스(production) Pod로 접근 허용
# ──────────────────────────────────────────────────────────────────────────────
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-monitoring-ingress
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: web-app                 # production 네임스페이스의 web-app Pod
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:           # 다른 네임스페이스에서 오는 트래픽
        matchLabels:
          name: monitoring         # monitoring 네임스페이스 (라벨 필요!)
      podSelector:                 # AND 조건: 해당 네임스페이스의 특정 Pod
        matchLabels:
          app: prometheus          # prometheus Pod만 허용
    ports:
    - protocol: TCP
      port: 9090                   # 메트릭 수집 포트만
```

```
주의: namespaceSelector를 사용하려면 대상 네임스페이스에 라벨이 있어야 한다!
═════════════════════════════════════════════════════════════════════════════

# 네임스페이스에 라벨 추가
kubectl label namespace monitoring name=monitoring

# 확인
kubectl get namespace monitoring --show-labels
```

### 1.8 CIDR 기반 IP 블록 제어

```yaml
# 특정 IP 대역 허용/차단
# ────────────────────────
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-external-api
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: payment                 # payment Pod에 적용
  policyTypes:
  - Egress
  egress:
  # DNS 허용
  - to: []
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  # 특정 외부 API 서버만 허용
  - to:
    - ipBlock:
        cidr: 203.0.113.0/24       # 외부 결제 API 서버 대역
    ports:
    - protocol: TCP
      port: 443                    # HTTPS만 허용
  # 내부 서비스 접근 허용
  - to:
    - ipBlock:
        cidr: 10.0.0.0/8           # 내부 클러스터 네트워크
        except:
        - 10.0.0.1/32              # 특정 IP 제외
```

### 1.9 메타데이터 API 차단 - 클라우드 보안

```yaml
# 클라우드 인스턴스 메타데이터 API 차단
# ───────────────────────────────────
# AWS/GCP/Azure 인스턴스 메타데이터 API(169.254.169.254)를 차단하여
# Pod에서 IAM 자격 증명 등 민감 정보 유출을 방지한다.
#
# IMDS(Instance Metadata Service)에 대한 네트워크 수준 접근 차단
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-metadata-access
  namespace: secure-ns
spec:
  podSelector: {}                  # 모든 Pod에 적용
  policyTypes:
  - Egress
  egress:
  # DNS 허용
  - to: []
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  # 메타데이터 API를 제외한 모든 외부 통신 허용
  - to:
    - ipBlock:
        cidr: 0.0.0.0/0           # 모든 IP 대역
        except:
        - 169.254.169.254/32      # 메타데이터 API IP 차단!
```

```
메타데이터 API가 위험한 이유
══════════════════════════

Pod가 169.254.169.254에 접근하면:
  - AWS: IAM Role 임시 자격 증명 획득 → AWS 리소스 무단 접근
  - GCP: Service Account 토큰 획득 → GCP 리소스 무단 접근
  - Azure: Managed Identity 토큰 획득 → Azure 리소스 무단 접근

공격 시나리오:
1. 공격자가 취약한 웹 앱을 통해 Pod에 RCE(원격 코드 실행) 획득
2. curl http://169.254.169.254/latest/meta-data/iam/security-credentials/
3. IAM Role의 AccessKey, SecretKey 탈취
4. 클라우드 리소스 전체 접근 가능 → 대형 보안 사고

→ NetworkPolicy로 차단하면 2단계에서 실패한다
```

---

## 2. CIS Benchmark와 kube-bench

### 2.1 CIS Benchmark란 무엇인가

```
CIS Benchmark 기술 정의
═══════════════════════

CIS(Center for Internet Security) Benchmark는 쿠버네티스 클러스터의
보안 설정을 체계적으로 평가하는 표준화된 보안 규격(security specification)이다.

각 항목은 컴포넌트별(kube-apiserver, kubelet, etcd 등) 설정 파라미터를
검사하며, 파일 퍼미션, 프로세스 인자(argument), 인증/인가 설정 등을 포함한다.
총 수백 개의 체크 항목이 레벨 1(필수)/레벨 2(심화)로 분류된다.

kube-bench는 CIS Benchmark 규격을 자동으로 평가하는 Go 기반 도구이다.
각 노드에서 실행되어 설정 파일과 프로세스 인자를 파싱하고,
규격 대비 PASS/FAIL/WARN 판정을 출력한다.
```

### 2.2 kube-bench 명령어 상세

```bash
# 마스터 노드 전체 점검
kube-bench run --targets master

# 워커 노드 점검
kube-bench run --targets node

# 특정 체크 항목만 점검 (시험에서 주로 사용)
kube-bench run --targets master --check 1.2.1,1.2.2

# 실패한 항목만 필터링
kube-bench run --targets master 2>&1 | grep "\[FAIL\]"

# JSON 형식 출력 (자동화용)
kube-bench run --targets master --json

# etcd 점검
kube-bench run --targets etcd

# 전체 점검
kube-bench run --targets master,node,etcd
```

### 2.3 시험 빈출 CIS 체크 항목

```
CKS에서 자주 나오는 kube-bench 수정 항목
══════════════════════════════════════

체크 ID   | 내용                      | 수정 방법
─────────┼───────────────────────────┼──────────────────────────────
1.2.1    | anonymous-auth 비활성화    | --anonymous-auth=false 추가
1.2.2    | basic-auth 비활성화        | --basic-auth-file 라인 삭제
1.2.6    | NodeRestriction 활성화     | --enable-admission-plugins=NodeRestriction
1.2.16   | profiling 비활성화         | --profiling=false
1.2.18   | insecure-bind-address 제거 | --insecure-bind-address 라인 삭제
1.2.19   | insecure-port 비활성화     | --insecure-port=0
1.2.20   | audit-log 활성화           | --audit-log-path=<경로>
1.2.21   | audit-log-maxage          | --audit-log-maxage=30
1.2.22   | audit-log-maxbackup       | --audit-log-maxbackup=10
1.2.23   | audit-log-maxsize         | --audit-log-maxsize=100
4.2.1    | kubelet anonymous auth     | authentication.anonymous.enabled: false
4.2.2    | kubelet authorization      | authorization.mode: Webhook
```

### 2.4 kube-bench FAIL 항목 수정 절차

```
kube-bench FAIL 수정 흐름
═════════════════════════

1. kube-bench 실행하여 FAIL 항목 확인
   │
   ▼
2. FAIL 항목의 Remediation(수정 방법) 확인
   │
   ├─ API Server 관련 → /etc/kubernetes/manifests/kube-apiserver.yaml
   ├─ Controller Manager → /etc/kubernetes/manifests/kube-controller-manager.yaml
   ├─ Scheduler → /etc/kubernetes/manifests/kube-scheduler.yaml
   ├─ etcd → /etc/kubernetes/manifests/kube-etcd.yaml
   └─ kubelet → /var/lib/kubelet/config.yaml
   │
   ▼
3. 매니페스트 백업
   cp <원본> /tmp/<원본>.bak
   │
   ▼
4. 매니페스트 수정
   vi <매니페스트 파일>
   │
   ▼
5. 재시작 대기
   ├─ Static Pod (API Server 등): kubelet이 자동 감지 → 자동 재시작
   │   watch crictl ps | grep kube-apiserver
   └─ kubelet: systemctl restart kubelet
   │
   ▼
6. 재점검
   kube-bench run --targets master --check <항목>
   → [PASS] 확인
```

### 2.5 API Server 매니페스트 수정 예제

```yaml
# /etc/kubernetes/manifests/kube-apiserver.yaml
# ─────────────────────────────────────────────
# static pod 매니페스트이다. 수정하면 kubelet이 자동 감지하여 재시작한다.
apiVersion: v1
kind: Pod
metadata:
  name: kube-apiserver
  namespace: kube-system
  labels:
    component: kube-apiserver
    tier: control-plane
spec:
  containers:
  - command:
    - kube-apiserver
    # === 보안 설정 (CIS Benchmark) ===
    - --anonymous-auth=false              # 1.2.1: 익명 인증 비활성화
                                          # true이면 인증 없이 API 접근 가능 → 위험!
    - --authorization-mode=Node,RBAC      # 1.2.8: Node + RBAC 인가
                                          # AlwaysAllow이면 모든 요청 허용 → 위험!
    - --enable-admission-plugins=NodeRestriction,PodSecurity
                                          # 1.2.6: Admission Controller 활성화
                                          # NodeRestriction: kubelet의 권한 제한
                                          # PodSecurity: Pod 보안 표준 적용
    - --profiling=false                   # 1.2.16: 프로파일링 비활성화
                                          # 디버깅 정보 노출 방지
    # --insecure-bind-address 라인 삭제!   # 1.2.18: 비암호화 바인딩 제거
    # --insecure-port=0 또는 라인 삭제      # 1.2.19: 비암호화 포트 비활성화

    # === Audit 로그 설정 ===
    - --audit-policy-file=/etc/kubernetes/audit-policy.yaml
    - --audit-log-path=/var/log/kubernetes/audit/audit.log
    - --audit-log-maxage=30               # 30일간 보관
    - --audit-log-maxbackup=10            # 최대 10개 백업
    - --audit-log-maxsize=100             # 최대 100MB per 파일

    # === kubelet 인증서 검증 ===
    - --kubelet-certificate-authority=/etc/kubernetes/pki/ca.crt
                                          # kubelet과 통신 시 인증서 검증

    # === 기존 필수 설정 (삭제하면 안 됨) ===
    - --advertise-address=192.168.64.10
    - --client-ca-file=/etc/kubernetes/pki/ca.crt
    - --etcd-cafile=/etc/kubernetes/pki/etcd/ca.crt
    - --etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt
    - --etcd-keyfile=/etc/kubernetes/pki/apiserver-etcd-client.key
    - --etcd-servers=https://127.0.0.1:2379
    - --kubelet-client-certificate=/etc/kubernetes/pki/apiserver-kubelet-client.crt
    - --kubelet-client-key=/etc/kubernetes/pki/apiserver-kubelet-client.key
    - --service-cluster-ip-range=10.96.0.0/12
    - --tls-cert-file=/etc/kubernetes/pki/apiserver.crt
    - --tls-private-key-file=/etc/kubernetes/pki/apiserver.key

    image: registry.k8s.io/kube-apiserver:v1.31.0

    # === 볼륨 마운트 (Audit 관련) ===
    volumeMounts:
    - name: audit-policy              # Audit 정책 파일 마운트
      mountPath: /etc/kubernetes/audit-policy.yaml
      readOnly: true                  # 읽기 전용 (보안)
    - name: audit-log                 # Audit 로그 디렉토리 마운트
      mountPath: /var/log/kubernetes/audit/
    # ... 기존 볼륨 마운트들

  volumes:
  - name: audit-policy
    hostPath:
      path: /etc/kubernetes/audit-policy.yaml
      type: File                      # 파일이 존재해야 함
  - name: audit-log
    hostPath:
      path: /var/log/kubernetes/audit/
      type: DirectoryOrCreate         # 디렉토리 없으면 자동 생성
  # ... 기존 볼륨들
```

### 2.6 kubelet 보안 설정

```yaml
# /var/lib/kubelet/config.yaml
# ─────────────────────────────
# kubelet의 설정 파일이다. 수정 후 systemctl restart kubelet으로 반영한다.
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
authentication:
  anonymous:
    enabled: false                    # 4.2.1: kubelet 익명 인증 비활성화
                                      # true이면 kubelet API에 인증 없이 접근 가능
  webhook:
    enabled: true                     # API Server를 통한 인증 활성화
    cacheTTL: 2m0s
  x509:
    clientCAFile: /etc/kubernetes/pki/ca.crt
authorization:
  mode: Webhook                       # 4.2.2: Webhook 인가 모드
                                      # AlwaysAllow이면 모든 요청 허용 → 위험!
readOnlyPort: 0                       # 4.2.4: 읽기 전용 포트 비활성화
                                      # 10255 포트는 인증 없이 접근 가능 → 위험!
protectKernelDefaults: true           # 커널 파라미터 보호
eventRecordQPS: 5
rotateCertificates: true              # 인증서 자동 갱신
```

---

## 3. Ingress TLS 설정

### 3.1 TLS의 필요성

```
TLS 종단(Termination) 메커니즘
══════════════════════════════

HTTP 프로토콜은 평문(plaintext)으로 데이터를 전송하므로,
네트워크 경로상의 중간자(MITM)가 패킷을 캡처하면 요청/응답 본문이 노출된다.

TLS(Transport Layer Security)는 X.509 인증서 기반의 비대칭 키 교환(handshake)으로
세션 키를 합의한 뒤, 대칭 암호화(AES-GCM 등)로 페이로드를 암호화하여 기밀성과
무결성을 보장한다.

Ingress TLS Termination 구조:
  외부 클라이언트 ──(TLS 1.2/1.3)──→ Ingress Controller ──(HTTP/HTTPS)──→ Pod
                 TLS handshake 후                     내부 통신
                 암호화된 채널                  (필요 시 re-encrypt 가능)
```

### 3.2 인증서 생성 및 TLS Secret

```bash
# 자체 서명 인증서 생성 절차
# ────────────────────────
# 1. 개인 키 + 인증서 동시 생성
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout tls.key \                    # 개인 키 파일
  -out tls.crt \                       # 인증서 파일
  -subj "/CN=myapp.example.com"        # Common Name (도메인 이름)

# 옵션 설명:
#   -x509    : 자체 서명 인증서 생성 (CA 불필요)
#   -nodes   : 개인 키 암호화 안 함 (Node가 아니라 No DES)
#   -days    : 인증서 유효 기간
#   -newkey  : 새 키 생성 (RSA 2048비트)
#   -subj    : 인증서 주체 정보

# 2. TLS Secret 생성
kubectl create secret tls myapp-tls \
  --cert=tls.crt \                     # 인증서 파일 경로
  --key=tls.key \                      # 개인 키 파일 경로
  -n production                        # Ingress와 같은 네임스페이스!

# 3. Secret 확인
kubectl get secret myapp-tls -n production -o yaml
# type: kubernetes.io/tls  ← TLS Secret 타입
# data:
#   tls.crt: <base64 인코딩된 인증서>
#   tls.key: <base64 인코딩된 개인 키>

# 4. 인증서 내용 확인
kubectl get secret myapp-tls -n production \
  -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -text -noout
```

### 3.3 Ingress TLS 적용 YAML

```yaml
# Ingress에 TLS 적용
# ──────────────────
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress
  namespace: production                # TLS Secret과 같은 네임스페이스여야 함
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
                                       # HTTP → HTTPS 자동 리다이렉트
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
                                       # 강제 SSL 리다이렉트
spec:
  ingressClassName: nginx              # Ingress Controller 종류
  tls:                                 # TLS 설정 섹션
  - hosts:
    - myapp.example.com                # TLS가 적용될 호스트명
    secretName: myapp-tls              # TLS Secret 이름
                                       # → kubernetes.io/tls 타입이어야 함
                                       # → tls.crt, tls.key 키가 있어야 함
  rules:
  - host: myapp.example.com           # 라우팅 규칙
    http:
      paths:
      - path: /
        pathType: Prefix               # 경로 매칭 방식
        backend:
          service:
            name: myapp-svc            # 백엔드 서비스 이름
            port:
              number: 80               # 서비스 포트
```

---

## 4. 바이너리 무결성 검증

### 4.1 바이너리 검증이 필요한 이유

```
바이너리 무결성 검증 원리
═════════════════════════

암호학적 해시 함수(SHA-512)의 충돌 저항성(collision resistance)을 이용하여
바이너리 파일의 변조 여부를 검증한다. 동일한 입력에 대해 항상 동일한
512비트 다이제스트를 생성하며, 입력이 1비트라도 변경되면
다이제스트가 완전히 달라지는 눈사태 효과(avalanche effect)를 갖는다.

공격 시나리오:
1. 공격자가 노드에 침투
2. /usr/bin/kubelet을 악성 바이너리로 교체(supply chain 공격)
3. 악성 kubelet이 모든 Pod 정보를 외부로 유출
4. sha512sum으로 해시값을 비교하면 변조를 탐지할 수 있다

검증 흐름:
  sha512sum으로 현재 바이너리의 다이제스트 계산
    → 쿠버네티스 공식 릴리스 체크섬과 비교
    └─ 일치: 무결성 확인 (바이너리가 공식 릴리스와 동일)
    └─ 불일치: 변조 탐지 (공식 바이너리로 교체 필요)
```

### 4.2 검증 명령어

```bash
# 1. 현재 바이너리 버전 확인
kubelet --version
# Kubernetes v1.31.0

# 2. 현재 바이너리 해시값 계산
sha512sum /usr/bin/kubelet

# 3. 공식 해시값 다운로드
curl -LO "https://dl.k8s.io/v1.31.0/bin/linux/amd64/kubelet.sha512"

# 4. 비교 검증
echo "$(cat kubelet.sha512)  /usr/bin/kubelet" | sha512sum --check
# kubelet: OK         → 무결성 확인
# kubelet: FAILED     → 변조됨!

# 5. 변조된 경우 교체 절차
curl -LO "https://dl.k8s.io/v1.31.0/bin/linux/amd64/kubelet"
chmod +x kubelet
sudo mv kubelet /usr/bin/kubelet
sudo systemctl restart kubelet

# kubectl도 같은 방식으로 검증
sha512sum /usr/bin/kubectl
curl -LO "https://dl.k8s.io/v1.31.0/bin/linux/amd64/kubectl.sha512"
echo "$(cat kubectl.sha512)  /usr/bin/kubectl" | sha512sum --check
```

---


---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터 접속 (Cilium CNI + Istio mTLS 환경)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml

# 클러스터 및 네임스페이스 확인
kubectl get nodes
kubectl get ns
```

### 과제 1: CiliumNetworkPolicy 기반 Zero Trust 정책 확인

dev 클러스터에는 11개의 CiliumNetworkPolicy가 적용되어 있다. L3/L4/L7 수준의 Zero Trust 네트워크 정책을 확인한다.

```bash
# CiliumNetworkPolicy 전체 목록 확인
kubectl get ciliumnetworkpolicy -A

# 예상 출력:
# NAMESPACE   NAME                          AGE
# demo        allow-dns-egress              3d
# demo        default-deny-all              3d
# demo        frontend-to-backend-egress    3d
# ...  (총 11개)

# 특정 정책의 L7 규칙 확인 (HTTP method/path 기반 필터링)
kubectl get ciliumnetworkpolicy -n demo -o yaml | grep -A 10 "l7"

# Default Deny 정책 상세 확인
kubectl get ciliumnetworkpolicy default-deny-all -n demo -o yaml
```

**동작 원리:** CiliumNetworkPolicy는 표준 NetworkPolicy를 확장한 CRD로, Cilium이 eBPF 프로그램으로 변환하여 커널 레벨에서 L3/L4/L7 필터링을 수행한다. iptables 없이 패킷을 처리하므로 성능 오버헤드가 낮다.

### 과제 2: Pod 간 통신 차단 검증

Default Deny 정책이 적용된 상태에서 허용되지 않은 통신이 실제로 차단되는지 검증한다.

```bash
# demo 네임스페이스의 Pod 확인
kubectl get pods -n demo -o wide

# 허용되지 않은 경로로 통신 시도 (차단되어야 함)
kubectl exec -n demo deploy/frontend -- curl -s --max-time 3 http://backend:8080/blocked-path
# 예상 출력: command terminated with exit code 28 (타임아웃) 또는 403

# 허용된 경로로 통신 시도 (성공해야 함)
kubectl exec -n demo deploy/frontend -- curl -s --max-time 3 http://backend:8080/
# 예상 출력: 정상 응답
```

**동작 원리:** Default Deny 정책으로 모든 트래픽이 차단된 후, 명시적 Allow 정책에 매칭되는 트래픽만 eBPF 데이터플레인에서 FORWARD 판정을 받는다. L7 정책이 있으면 HTTP path/method까지 검사한다.

### 과제 3: Istio mTLS(PeerAuthentication STRICT) 확인

dev 클러스터에는 Istio PeerAuthentication이 STRICT 모드로 설정되어 있어 Pod 간 mTLS가 강제된다.

```bash
# PeerAuthentication 정책 확인
kubectl get peerauthentication -A

# 예상 출력:
# NAMESPACE      NAME      MODE     AGE
# istio-system   default   STRICT   3d

# mTLS 적용 상태 확인 - sidecar가 주입된 Pod 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .spec.containers[*]}{.name}{" "}{end}{"\n"}{end}'
# 예상 출력: 각 Pod에 istio-proxy 사이데카 컨테이너가 포함되어 있음

# TLS 인증서 정보 확인
kubectl exec -n demo deploy/frontend -c istio-proxy -- \
  openssl s_client -connect backend:8080 -showcerts 2>/dev/null | head -5
```

**동작 원리:** Istio의 PeerAuthentication STRICT 모드는 Envoy 사이드카 프록시가 Pod 간 모든 통신에 mTLS를 강제한다. 평문 HTTP 요청은 Envoy에서 거부되므로, NetworkPolicy + mTLS 이중 보안 계층이 구성된다.

---

> **내일 예고:** Day 2에서는 Cluster Setup 도메인의 시험 출제 패턴, 실전 문제 12개, NetworkPolicy 검증 실습, CiliumNetworkPolicy 비교를 다룬다.
