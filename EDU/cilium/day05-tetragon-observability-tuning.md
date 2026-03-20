# Day 5: Tetragon, 관찰성, 성능 튜닝

> Tetragon을 활용한 Runtime Security, Hubble 기반 관찰성 플랫폼, 그리고 Cilium 성능 튜닝 기법을 학습한다.

---

## 제11장: Tetragon (Runtime Security)

### Tetragon 개요

Tetragon은 Cilium 프로젝트에서 분리된 eBPF 기반 런타임 보안 도구이다. 커널 레벨에서 프로세스, 파일, 네트워크 활동을 모니터링하고 정책을 적용한다.

```
┌──────────────────────────────────────────────────────────────┐
│  Tetragon 아키텍처                                            │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  Userspace                                             │   │
│  │  ┌──────────────┐  ┌──────────────┐                   │   │
│  │  │ tetragon     │  │ tetra CLI    │                   │   │
│  │  │ (agent)      │  │ (관찰 도구)  │                   │   │
│  │  │              │  │              │                   │   │
│  │  │ gRPC API     │◄─│ 이벤트 구독  │                   │   │
│  │  │ JSON export  │  │              │                   │   │
│  │  └──────┬───────┘  └──────────────┘                   │   │
│  └─────────┼─────────────────────────────────────────────┘   │
│            │ eBPF Map (Ring Buffer)                           │
│  ┌─────────▼─────────────────────────────────────────────┐   │
│  │  Kernel Space                                          │   │
│  │  ┌──────────────────────────────────────────────────┐ │   │
│  │  │ eBPF Programs                                     │ │   │
│  │  │ ├── kprobe: 커널 함수 추적                        │ │   │
│  │  │ ├── tracepoint: 커널 이벤트 추적                  │ │   │
│  │  │ ├── LSM: Linux Security Module hook               │ │   │
│  │  │ └── uprobe: 유저스페이스 함수 추적                │ │   │
│  │  └──────────────────────────────────────────────────┘ │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### TracingPolicy 예시

```yaml
# 프로세스 실행 모니터링
apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: monitor-process-exec
spec:
  kprobes:
    - call: "security_bprm_check"
      syscall: false
      args:
        - index: 0
          type: "linux_binprm"
      selectors:
        - matchNamespaces:
            - namespace: Pid
              operator: NotIn
              values:
                - "host_ns"    # 호스트 PID 네임스페이스 제외
```

```yaml
# 민감 파일 접근 감지
apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: sensitive-file-access
spec:
  kprobes:
    - call: "fd_install"
      syscall: false
      args:
        - index: 0
          type: "int"
        - index: 1
          type: "file"
      selectors:
        - matchArgs:
            - index: 1
              operator: "Prefix"
              values:
                - "/etc/shadow"
                - "/etc/passwd"
                - "/etc/kubernetes/"
                - "/var/run/secrets/"
          matchActions:
            - action: Sigkill    # 즉시 프로세스 종료
```

```yaml
# 네트워크 연결 모니터링
apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: monitor-network-connect
spec:
  kprobes:
    - call: "tcp_connect"
      syscall: false
      args:
        - index: 0
          type: "sock"
```

```bash
# Tetragon 이벤트 관찰
kubectl exec -n kube-system -it ds/tetragon -- \
  tetra getevents --namespaces demo

# 프로세스 실행 이벤트만 필터링
kubectl exec -n kube-system -it ds/tetragon -- \
  tetra getevents --event-types PROCESS_EXEC

# JSON 형식 출력
kubectl exec -n kube-system -it ds/tetragon -- \
  tetra getevents --output json
```

---

## 제12장: 관찰성 (Observability)

### Hubble 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│  Hubble 아키텍처                                              │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Hubble UI (브라우저)                                  │    │
│  │  ├── 서비스 맵 시각화                                  │    │
│  │  ├── 네트워크 플로우 타임라인                          │    │
│  │  └── HTTP/DNS/TCP 상세 정보                            │    │
│  └────────────────────┬─────────────────────────────────┘    │
│                       │ gRPC                                  │
│  ┌────────────────────▼─────────────────────────────────┐    │
│  │  Hubble Relay (Deployment)                             │    │
│  │  ├── 모든 노드의 cilium-agent에서 이벤트를 수집한다   │    │
│  │  ├── 클러스터 전역 gRPC API를 제공한다                │    │
│  │  └── Hubble CLI와 UI의 백엔드 역할                    │    │
│  └────────────────────┬─────────────────────────────────┘    │
│              ┌────────┼────────┐                              │
│              │        │        │    gRPC (per-node)           │
│  ┌───────────▼──┐ ┌───▼────┐ ┌─▼──────────┐                 │
│  │ cilium-agent │ │  agent │ │   agent    │                 │
│  │ (Node A)     │ │(Node B)│ │ (Node C)   │                 │
│  │              │ │        │ │            │                 │
│  │ eBPF events  │ │ eBPF   │ │ eBPF      │                 │
│  │ Ring Buffer  │ │ events │ │ events    │                 │
│  └──────────────┘ └────────┘ └────────────┘                 │
│                                                              │
│  본 프로젝트 설정 (hubble-values.yaml):                      │
│  hubble:                                                      │
│    enabled: true                                              │
│    relay:                                                     │
│      enabled: true                                            │
│    ui:                                                        │
│      enabled: true                                            │
│      service:                                                 │
│        type: NodePort                                         │
│        nodePort: 31235                                        │
│    metrics:                                                   │
│      enabled:                                                 │
│        - dns                                                  │
│        - drop                                                 │
│        - tcp                                                  │
│        - flow                                                 │
│        - icmp                                                 │
│        - http                                                 │
└──────────────────────────────────────────────────────────────┘
```

### Hubble 메트릭

본 프로젝트에서 활성화된 Hubble 메트릭:

| 메트릭 카테고리 | 주요 메트릭 이름 | 설명 |
|-----------------|------------------|------|
| dns | `hubble_dns_queries_total` | DNS 질의 수 |
| dns | `hubble_dns_responses_total` | DNS 응답 수 (rcode별) |
| drop | `hubble_drop_total` | 드롭된 패킷 수 (reason별) |
| tcp | `hubble_tcp_flags_total` | TCP 플래그별 패킷 수 |
| flow | `hubble_flows_processed_total` | 처리된 플로우 수 |
| icmp | `hubble_icmp_total` | ICMP 메시지 수 |
| http | `hubble_http_requests_total` | HTTP 요청 수 (method, status별) |
| http | `hubble_http_request_duration_seconds` | HTTP 요청 지연 히스토그램 |

### Hubble CLI 활용

```bash
# Hubble CLI 설치
brew install hubble

# Hubble 상태 확인
hubble status

# 실시간 네트워크 플로우 관찰
hubble observe

# 특정 네임스페이스의 플로우 필터링
hubble observe --namespace demo

# 특정 Pod의 트래픽 모니터링
hubble observe --pod demo/nginx-web-xxxx

# Drop된 패킷만 확인 (정책 위반 트래픽)
hubble observe --verdict DROPPED

# L7 HTTP 플로우 확인
hubble observe --protocol http

# DNS 질의/응답 관찰
hubble observe --protocol dns

# 특정 서비스로의 트래픽만 필터링
hubble observe --to-service demo/httpbin

# JSON 형식으로 출력 (스크립트 연동 시)
hubble observe --output json

# 포트 포워딩으로 Hubble UI 접근
kubectl port-forward -n kube-system svc/hubble-ui 12000:80
# 브라우저에서 http://localhost:12000 접속
# 또는 NodePort 31235로 직접 접근 (본 프로젝트 설정)
```

### Grafana 대시보드 통합

```
┌──────────────────────────────────────────────────────────────┐
│  Hubble → Prometheus → Grafana 파이프라인                     │
│                                                              │
│  cilium-agent                                                │
│  ├── /metrics (Prometheus 형식, 포트 9962)                   │
│  │   ├── cilium_forward_count_total                          │
│  │   ├── cilium_drop_count_total                             │
│  │   ├── cilium_policy_verdict                               │
│  │   └── cilium_endpoint_count                               │
│  │                                                           │
│  ├── Hubble metrics (포트 9965)                              │
│  │   ├── hubble_flows_processed_total                        │
│  │   ├── hubble_dns_queries_total                            │
│  │   ├── hubble_http_requests_total                          │
│  │   └── hubble_drop_total                                   │
│  │                                                           │
│  └── Prometheus가 scrape → Grafana 대시보드에 표시           │
│                                                              │
│  유용한 Grafana 대시보드:                                     │
│  - Cilium Agent Overview (ID: 16611)                         │
│  - Cilium Operator (ID: 16612)                               │
│  - Hubble (ID: 16613)                                        │
│  - Cilium Policy Verdicts (ID: 16614)                        │
└──────────────────────────────────────────────────────────────┘
```

### L7 Visibility Annotation

L7 정책이 없어도 L7 수준의 관찰성을 활성화할 수 있다:

```bash
# Pod에 L7 visibility annotation 추가
kubectl annotate pod -n demo httpbin-xxxx \
  policy.cilium.io/proxy-visibility="<Ingress/80/TCP/HTTP>"

# 네임스페이스 전체에 적용
kubectl annotate ns demo \
  policy.cilium.io/proxy-visibility="<Ingress/80/TCP/HTTP>,<Egress/53/UDP/DNS>"
```

---

## 제13장: 성능 튜닝

### BPF Map 크기 조정

```
┌──────────────────────────────────────────────────────────────┐
│  Map 크기 튜닝 가이드                                         │
│                                                              │
│  CT(Connection Tracking) 테이블:                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ 파라미터                      │ 기본값   │ 권장 범위 │    │
│  ├───────────────────────────────┼──────────┼───────────┤    │
│  │ --bpf-ct-global-tcp-max       │ 524288   │ 128K~2M   │    │
│  │ --bpf-ct-global-any-max       │ 262144   │ 64K~1M    │    │
│  │ --bpf-nat-global-max          │ 524288   │ CT와 동일 │    │
│  │ --bpf-policy-map-max          │ 16384    │ 16K~64K   │    │
│  │ --bpf-lb-map-max              │ 65536    │ 64K~256K  │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  크기 산정 기준:                                              │
│  - CT TCP: 동시 TCP 연결 수의 2~4배                          │
│  - CT ANY: 동시 UDP/ICMP 연결 수의 2배                       │
│  - NAT: CT와 동일하게 설정                                   │
│  - Policy: Endpoint당 Identity 수 × Endpoint 수             │
│  - LB: Service 수 × Backend 수                               │
│                                                              │
│  메모리 영향:                                                 │
│  CT entry 1개 ≈ 128 바이트                                   │
│  512K entries ≈ 64 MB per map                                │
│  CT4 + CT6 + NAT4 + NAT6 ≈ 256 MB (기본 설정)              │
│                                                              │
│  모니터링:                                                    │
│  cilium bpf ct list global | wc -l    # 현재 CT 사용량      │
│  cilium metrics list | grep bpf_map   # Map 사용률 메트릭   │
└──────────────────────────────────────────────────────────────┘
```

### MTU 최적화

```
┌──────────────────────────────────────────────────────────────┐
│  MTU 설정 가이드                                              │
│                                                              │
│  Datapath 모드별 MTU 계산:                                   │
│  ┌────────────────┬────────────────┬────────────────────┐    │
│  │ 모드           │ 오버헤드       │ 권장 MTU           │    │
│  ├────────────────┼────────────────┼────────────────────┤    │
│  │ Direct Routing │ 0 bytes        │ 1500 (또는 9000)   │    │
│  │ VXLAN          │ 50 bytes       │ 1450 (또는 8950)   │    │
│  │ Geneve         │ 58 bytes       │ 1442 (또는 8942)   │    │
│  │ WireGuard      │ 60 bytes       │ 1440 (또는 8940)   │    │
│  │ VXLAN+WireGuard│ 110 bytes      │ 1390 (또는 8890)   │    │
│  │ IPsec ESP      │ ~56 bytes      │ 1444 (또는 8944)   │    │
│  └────────────────┴────────────────┴────────────────────┘    │
│                                                              │
│  Jumbo Frame 활용:                                            │
│  - 물리 네트워크가 9000 MTU를 지원하면 활용한다              │
│  - 대용량 데이터 전송 시 CPU 오버헤드를 크게 줄인다          │
│  - Cilium Helm: mtu=8950 (VXLAN 사용 시)                    │
└──────────────────────────────────────────────────────────────┘
```

### XDP 가속

```
┌──────────────────────────────────────────────────────────────┐
│  XDP 가속 설정                                                │
│                                                              │
│  활성화 조건:                                                 │
│  - NIC 드라이버가 native XDP를 지원해야 한다                 │
│  - 지원 드라이버: i40e, ixgbe, mlx5, virtio_net, veth 등    │
│  - Cilium Helm: loadBalancer.acceleration=native             │
│                                                              │
│  XDP 가속 대상:                                               │
│  - NodePort 서비스 트래픽 (외부 → NodePort)                  │
│  - LoadBalancer 서비스 트래픽                                │
│  - DSR 모드 패킷 포워딩                                      │
│                                                              │
│  성능 효과:                                                   │
│  - 일반 TC 대비 2~5배 throughput 향상                        │
│  - 지연 시간 50% 감소 (sk_buff 할당 제거)                    │
│                                                              │
│  확인:                                                        │
│  cilium status | grep "XDP"                                  │
│  ip link show | grep xdp  # xdp 프로그램 부착 확인          │
└──────────────────────────────────────────────────────────────┘
```

### Host-Routing 모드 활성화

```yaml
# Cilium Helm values (성능 최적화)
routingMode: native
autoDirectNodeRoutes: true
bpf:
  masquerade: true                     # eBPF masquerade
  hostLegacyRouting: false             # host-routing 활성화 (커널 5.10+)
  tproxy: true
loadBalancer:
  algorithm: maglev                    # consistent hashing
  acceleration: native                 # XDP 가속
  mode: dsr                            # Direct Server Return
kubeProxyReplacement: true
bandwidthManager:
  enabled: true                        # EDT 기반 대역폭 관리
  bbr: true                            # BBR 혼잡 제어
```

### 대규모 클러스터 튜닝 체크리스트

| 항목 | 소규모 (< 100 노드) | 대규모 (100~1000 노드) | 초대규모 (1000+ 노드) |
|------|---------------------|----------------------|---------------------|
| CT 테이블 크기 | 512K (기본) | 1M | 2M |
| NAT 테이블 크기 | 512K (기본) | 1M | 2M |
| 저장 백엔드 | CRD (기본) | CRD | 외부 etcd |
| IPAM | cluster-pool | cluster-pool | cluster-pool + multi-pool |
| CES 활성화 | 선택 | 권장 | 필수 |
| Identity GC 주기 | 15분 (기본) | 15분 | 5분 |
| Operator 리소스 | 100m/128Mi | 500m/512Mi | 1000m/1Gi |
| Agent 리소스 | 100m/128Mi | 500m/512Mi | 1000m/1Gi |

---

