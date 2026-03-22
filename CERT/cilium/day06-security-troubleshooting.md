# Day 6: 보안 심화 및 트러블슈팅

> Cilium의 고급 보안 기능(SPIFFE, mTLS, Transparent Encryption)과 트러블슈팅 기법(cilium status, monitor, connectivity test 등)을 학습한다.

---

## 제14장: 보안 심화

### Zero-Trust 네트워킹 구현

제로 트러스트 네트워크는 "절대 신뢰하지 않고, 항상 검증한다"는 원칙에 기반한다. Cilium으로 구현하는 단계는 다음과 같다:

```
┌──────────────────────────────────────────────────────────────┐
│  Zero-Trust 구현 4단계                                        │
│                                                              │
│  1단계: 가시성 확보                                          │
│  ├── Hubble로 모든 네트워크 플로우를 관찰한다                │
│  ├── 서비스 맵을 생성하여 의존 관계를 파악한다               │
│  └── 정책 적용 전 현재 통신 패턴을 이해한다                  │
│                                                              │
│  2단계: 감사 모드 적용                                       │
│  ├── default-deny 정책을 audit 모드로 적용한다               │
│  ├── Hubble에서 AUDIT 이벤트를 확인한다                      │
│  └── 차단될 트래픽을 사전에 파악한다                         │
│                                                              │
│  3단계: 점진적 정책 적용                                     │
│  ├── 필수 통신 경로에 대한 Allow 정책을 먼저 만든다          │
│  ├── DNS 허용 정책을 반드시 포함한다                         │
│  ├── kube-apiserver, health check 등 인프라 통신을 허용한다  │
│  └── 서비스 간 통신을 하나씩 명시적으로 허용한다             │
│                                                              │
│  4단계: 강제 적용                                            │
│  ├── 감사 모드를 해제하고 실제 정책을 적용한다               │
│  ├── Hubble에서 DROPPED 이벤트를 모니터링한다                │
│  └── 예상치 못한 차단은 정책을 추가하여 해결한다             │
└──────────────────────────────────────────────────────────────┘
```

본 프로젝트의 `manifests/network-policies/` 디렉토리는 이미 제로 트러스트 패턴을 구현하고 있다:

```
┌──────────────────────────────────────────────────────────────┐
│  tart-infra 프로젝트 네트워크 정책 구조                       │
│  (manifests/network-policies/)                                │
│                                                              │
│  default-deny-all.yaml (1단계: 기본 차단)                    │
│  ├── 모든 ingress 차단                                       │
│  ├── DNS egress만 허용 (kube-dns:53)                         │
│  └── 나머지 egress 차단                                      │
│                                                              │
│  allow-external-to-nginx.yaml (진입점 허용)                  │
│  ├── world + cluster → nginx-web:80/TCP                      │
│  └── 외부 사용자의 웹 접근 허용                              │
│                                                              │
│  allow-external-to-keycloak.yaml (인증 서비스 진입점)        │
│  ├── world + cluster → keycloak:8080/TCP                     │
│  └── 외부 인증 요청 허용                                     │
│                                                              │
│  allow-nginx-to-httpbin.yaml (서비스 간 통신)                │
│  ├── nginx-web → httpbin:80/TCP                              │
│  └── L7 제한: GET 메서드만 허용                              │
│                                                              │
│  allow-nginx-to-redis.yaml (캐시 접근)                       │
│  ├── nginx-web → redis:6379/TCP                              │
│  └── L4 제한: Redis 포트만 허용                              │
│                                                              │
│  allow-nginx-egress.yaml (nginx 발신 트래픽 제어)            │
│  ├── → httpbin:80 (GET만), → redis:6379, → kube-dns:53     │
│  └── 그 외 egress 차단                                       │
│                                                              │
│  allow-httpbin-to-postgres.yaml (DB 접근)                    │
│  ├── httpbin → postgres:5432/TCP                             │
│  └── 애플리케이션만 DB 접근 가능                             │
│                                                              │
│  allow-httpbin-to-rabbitmq.yaml (메시지 큐 접근)             │
│  ├── httpbin → rabbitmq:5672/TCP                             │
│  └── 메시지 프로듀서만 접근 가능                             │
│                                                              │
│  allow-httpbin-to-keycloak.yaml (인증 통합)                  │
│  ├── httpbin → keycloak:8080/TCP                             │
│  └── 토큰 검증용 통신 허용                                   │
│                                                              │
│  allow-keycloak-to-postgres.yaml (인증 DB 접근)              │
│  ├── keycloak → postgres:5432/TCP                            │
│  └── Keycloak의 사용자 DB 접근 허용                          │
│                                                              │
│  allow-istio-control-plane.yaml (서비스 메시 통합)           │
│  ├── istio-system ↔ demo (포트 15010, 15012, 15017)         │
│  ├── localhost:15001, 15006 (sidecar proxy)                  │
│  └── Istio control plane과 sidecar 간 통신 허용              │
│                                                              │
│  통신 흐름 요약:                                              │
│  world → nginx-web → httpbin → postgres                     │
│                    ↘         → rabbitmq                      │
│                     redis    → keycloak → postgres           │
│  world → keycloak                                            │
│  istio-system ↔ demo (control plane)                         │
└──────────────────────────────────────────────────────────────┘
```

### Mutual Authentication (SPIFFE)

Cilium은 SPIFFE(Secure Production Identity Framework For Everyone)를 사용하여 워크로드 간 상호 인증을 수행한다.

```
┌──────────────────────────────────────────────────────────────┐
│  Mutual Authentication 동작                                   │
│                                                              │
│  1. 각 Pod에 SPIFFE ID가 할당된다                            │
│     예: spiffe://cluster.local/ns/demo/sa/frontend           │
│                                                              │
│  2. cilium-agent가 SPIRE server에서 SVID 인증서를 발급받는다│
│     (X.509 SVID 또는 JWT SVID)                               │
│                                                              │
│  3. Pod A → Pod B 연결 시:                                   │
│     ├── eBPF가 연결을 감지한다                               │
│     ├── cilium-agent 간 mTLS 핸드셰이크를 수행한다          │
│     ├── 양쪽의 SPIFFE ID를 검증한다                          │
│     └── 인증 성공 시에만 트래픽을 허용한다                   │
│                                                              │
│  4. 정책에서 인증 요구:                                      │
│     authentication:                                           │
│       mode: required    # 인증 필수                           │
│                                                              │
│  활성화:                                                      │
│  Helm:                                                        │
│    authentication:                                            │
│      mutual:                                                  │
│        spire:                                                 │
│          enabled: true                                        │
│          install:                                             │
│            enabled: true                                      │
└──────────────────────────────────────────────────────────────┘
```

```yaml
# 인증 필수 정책
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: require-auth
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: backend
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend
      authentication:
        mode: required      # mTLS 인증 필수
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
```

---

## 제15장: 트러블슈팅

### 체계적 디버깅 절차

```
┌──────────────────────────────────────────────────────────────┐
│  Cilium 트러블슈팅 플로우차트                                 │
│                                                              │
│  문제 발생                                                    │
│  │                                                           │
│  ├── 1. cilium status → 전체 상태 확인                      │
│  │   ├── KVStore: Ok?                                       │
│  │   ├── Kubernetes: Ok?                                    │
│  │   ├── KubeProxyReplacement: True?                        │
│  │   └── Controller Status: all OK?                         │
│  │                                                           │
│  ├── 2. cilium endpoint list → Endpoint 상태 확인           │
│  │   ├── State: ready? (not-ready면 regeneration 실패)      │
│  │   ├── Policy: enabled? (ingress/egress)                  │
│  │   └── Identity: 올바른 ID 할당?                          │
│  │                                                           │
│  ├── 3. hubble observe → 트래픽 흐름 확인                   │
│  │   ├── --verdict DROPPED → 정책 차단 확인                 │
│  │   ├── --verdict FORWARDED → 정상 트래픽 확인             │
│  │   └── drop reason 분석                                   │
│  │                                                           │
│  ├── 4. cilium monitor --type drop → 실시간 드롭 확인       │
│  │   ├── POLICY_DENIED: 정책 누락/오류                      │
│  │   ├── CT_NO_MAP_FOUND: CT 테이블 가득 참                 │
│  │   ├── INVALID_SOURCE_MAC: MAC 주소 불일치                │
│  │   └── NO_TUNNEL_ENDPOINT: 터널 설정 오류                 │
│  │                                                           │
│  ├── 5. cilium bpf 명령어 → eBPF Map 상태 확인             │
│  │   ├── bpf lb list → Service LB 테이블                    │
│  │   ├── bpf ct list → Connection Tracking                  │
│  │   ├── bpf nat list → NAT 테이블                          │
│  │   ├── bpf policy get --all → Policy Map                  │
│  │   └── bpf map list → 전체 Map 사용량                     │
│  │                                                           │
│  └── 6. cilium connectivity test → 전체 기능 테스트         │
│      └── 약 5~10분 소요, 모든 네트워킹 시나리오 검증        │
└──────────────────────────────────────────────────────────────┘
```

### 시나리오 1: Pod 간 통신이 안 되는 경우

```bash
# 1. Cilium agent 상태 확인
cilium status

# 2. 양쪽 Pod의 Endpoint 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium endpoint list
# → "ready" 상태인지 확인한다. "not-ready"이면 eBPF 프로그램 로드 실패 가능성이 있다

# 3. 정책으로 인한 Drop 확인
hubble observe --pod <source-pod> --verdict DROPPED
# → DROPPED 이벤트가 있으면 어떤 정책이 차단했는지 확인한다

# 4. cilium monitor로 실시간 패킷 추적
kubectl -n kube-system exec -it ds/cilium -- cilium monitor --type drop
# → drop reason이 표시된다 (예: POLICY_DENIED, CT_NO_MAP_FOUND 등)

# 5. 특정 Endpoint의 정책 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium endpoint get <id> -o json | jq '.status.policy'
```

### 시나리오 2: Service 접근이 안 되는 경우

```bash
# 1. Service가 eBPF LB 테이블에 등록되었는지 확인
kubectl -n kube-system exec -it ds/cilium -- cilium bpf lb list | grep <service-clusterip>

# 2. Backend Pod가 등록되었는지 확인
kubectl -n kube-system exec -it ds/cilium -- cilium service list

# 3. Conntrack 테이블에서 연결 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium bpf ct list global | grep <service-ip>

# 4. kube-proxy 대체 모드가 정상인지 확인
kubectl -n kube-system exec -it ds/cilium -- cilium status | grep KubeProxyReplacement
# → "True" 또는 "Strict"여야 한다

# 5. Service 동기화 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium service list | wc -l
kubectl get svc --all-namespaces | wc -l
# → 두 수치가 대략 일치해야 한다 (headless service 등 제외)
```

### 시나리오 3: DNS 기반 정책이 동작하지 않는 경우

```bash
# 1. DNS proxy 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium status | grep DNS

# 2. FQDN 캐시 확인
kubectl -n kube-system exec -it ds/cilium -- cilium fqdn cache list

# 3. DNS 조회 허용 정책이 있는지 확인 (port 53 egress)
kubectl get cnp -A -o yaml | grep -A 10 "port.*53"

# 4. DNS proxy 로그 확인
kubectl -n kube-system exec -it ds/cilium -- cilium monitor --type l7 --related-to <endpoint-id>
```

### 시나리오 4: cilium-agent가 NotReady인 경우

```bash
# 1. Pod 로그 확인
kubectl -n kube-system logs ds/cilium --tail=100

# 2. cilium-agent 내부 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium status --verbose

# 3. eBPF 프로그램 로드 상태 확인
kubectl -n kube-system exec -it ds/cilium -- cilium bpf prog list

# 4. 커널 버전 호환성 확인 (최소 4.19.57, 권장 5.10+)
kubectl -n kube-system exec -it ds/cilium -- uname -r

# 5. BPF filesystem 마운트 확인
kubectl -n kube-system exec -it ds/cilium -- mount | grep bpf
```

### 시나리오 5: 성능 문제 진단

```bash
# 1. eBPF Map 사용량 확인 (CT 테이블 가득 찬 경우 성능 저하)
kubectl -n kube-system exec -it ds/cilium -- cilium bpf ct list global | wc -l
kubectl -n kube-system exec -it ds/cilium -- cilium status | grep "CT"

# 2. cilium-agent 리소스 사용량 확인
kubectl -n kube-system top pod -l k8s-app=cilium

# 3. Datapath 모드 확인 (VXLAN vs Direct Routing)
kubectl -n kube-system exec -it ds/cilium -- cilium status | grep "Datapath"

# 4. eBPF 프로그램 실행 통계 확인
kubectl -n kube-system exec -it ds/cilium -- cilium bpf prog list

# 5. Metrics 확인 (Prometheus 형식)
kubectl -n kube-system exec -it ds/cilium -- cilium metrics list | grep -E "drop|forward|policy"
```

### 시나리오 6: CT 테이블 가득 참 (CT Table Full)

```bash
# 증상: 새 연결이 실패하고 drop reason이 CT_MAP_INSERTION_FAILED

# 1. 현재 CT 사용량 확인
kubectl -n kube-system exec -it ds/cilium -- \
  cilium bpf ct list global | wc -l

# 2. CT 테이블 최대 크기 확인
kubectl -n kube-system exec -it ds/cilium -- \
  cilium status --verbose | grep -i "ct\|conntrack"

# 3. 해결: CT 테이블 크기 증가 (Helm values 수정)
# bpf:
#   ctTcpMax: 1048576    # 기본 524288에서 2배로
#   ctAnyMax: 524288     # 기본 262144에서 2배로

# 4. 긴급: CT 테이블 수동 정리 (오래된 엔트리 삭제)
kubectl -n kube-system exec -it ds/cilium -- \
  cilium bpf ct flush global
```

### 공통 Drop Reason 참조표

| Drop Reason | 코드 | 원인 | 해결 방법 |
|-------------|------|------|-----------|
| POLICY_DENIED | 133 | 네트워크 정책에 의해 차단 | 정책 추가 또는 수정 |
| INVALID_SOURCE_MAC | 131 | MAC 주소 불일치 | Endpoint regeneration |
| CT_MAP_INSERTION_FAILED | 162 | CT 테이블 가득 참 | CT 테이블 크기 증가 |
| NO_TUNNEL_ENDPOINT | 137 | 터널 엔드포인트 미등록 | cilium-agent 재시작 |
| STALE_CT_ENTRY | 155 | 만료된 CT 엔트리 | CT flush 또는 대기 |
| UNSUPPORTED_L3_PROTO | 148 | 지원하지 않는 L3 프로토콜 | 트래픽 패턴 확인 |
| MISSED_TAIL_CALL | 152 | Tail call 실패 | cilium-agent 재시작 |
| SNAT_NO_MAP_FOUND | 164 | SNAT 매핑 없음 | NAT 테이블 크기 증가 |

---

