# Day 1: 개념 및 eBPF 기초 심화

> Cilium의 기본 개념과 역사, 그리고 eBPF의 내부 동작 원리를 깊이 있게 학습한다. eBPF 가상 머신의 레지스터 구조, 명령어 집합, 프로그램 타입, 맵 자료구조 등을 다룬다.

---

## 개념

### Cilium이란?

Cilium은 eBPF(extended Berkeley Packet Filter) 기반의 Kubernetes CNI(Container Network Interface) 플러그인이다. CNCF Graduated 프로젝트로서, Linux 커널 내부에서 네트워킹, 보안, Observability를 처리한다. kube-proxy를 완전히 대체할 수 있으며, L3/L4/L7 네트워크 정책, 투명 암호화, 멀티 클러스터 연결 등 광범위한 기능을 제공한다.

핵심 설계 원칙은 다음과 같다:

- **커널 레벨 처리**: 패킷이 userspace를 거치지 않고 커널 내 eBPF 프로그램에서 직접 처리되어 높은 성능을 보장한다
- **Identity 기반 보안**: IP 주소가 아닌 Kubernetes label 기반의 Security Identity로 네트워크 정책을 적용한다
- **API-Aware**: HTTP, gRPC, Kafka 등 L7 프로토콜 수준의 가시성과 정책 제어를 지원한다

### Cilium의 역사와 발전

Cilium은 2015년 Isovalent(현 Cisco 인수)에서 시작되었다. Linux 커널 네트워킹 스택의 핵심 개발자였던 Thomas Graf와 Daniel Borkmann이 설립한 프로젝트이다. 주요 이정표는 다음과 같다:

| 시점 | 이정표 |
|------|--------|
| 2015 | Isovalent 설립, Cilium 프로젝트 시작 |
| 2017 | Cilium 1.0 릴리스, 최초의 eBPF 기반 CNI |
| 2019 | Hubble Observability 플랫폼 통합 |
| 2020 | kube-proxy 완전 대체 기능 (Socket-Level LB) |
| 2021 | Cluster Mesh GA, Service Mesh 기능 도입 |
| 2022 | CNCF Graduated 프로젝트 승격 |
| 2023 | Mutual Authentication (SPIFFE), BGP Control Plane GA |
| 2024 | Tetragon GA, Gateway API 지원 강화 |

---

## 제1장: eBPF 기초 심화

### eBPF란?

eBPF(extended Berkeley Packet Filter)는 Linux 커널 내부에서 샌드박스화된 프로그램을 실행하는 기술이다. 커널 소스 코드를 수정하거나 커널 모듈을 로드하지 않고도 커널의 동작을 확장할 수 있다. 원래 패킷 필터링 목적으로 만들어진 cBPF(classic BPF)에서 발전하여, 현재는 네트워킹, 보안, 트레이싱, 프로파일링 등 범용적인 커널 프로그래밍 프레임워크로 자리잡았다.

### BPF Instruction Set Architecture

eBPF는 자체적인 명령어 집합(ISA)을 가진 가상 머신이다. RISC 스타일의 64비트 레지스터 기반 아키텍처로 설계되었다.

#### 레지스터 구성

eBPF 가상 머신은 11개의 64비트 레지스터를 제공한다:

| 레지스터 | 용도 |
|----------|------|
| `R0` | 함수 반환값, 프로그램 종료 코드 |
| `R1` | 첫 번째 함수 인자 (프로그램 진입 시 context 포인터) |
| `R2`~`R5` | 두 번째~다섯 번째 함수 인자 |
| `R6`~`R9` | Callee-saved 레지스터 (함수 호출 시 보존) |
| `R10` | Read-only 프레임 포인터 (스택 접근용) |

#### 명령어 분류

```
┌─────────────────────────────────────────────────────────────┐
│  eBPF 명령어 인코딩 (64비트 고정 길이)                       │
│                                                              │
│  ┌────────┬───────┬───────┬──────────┬───────────────────┐  │
│  │ opcode │  dst  │  src  │  offset  │     immediate     │  │
│  │ 8 bits │4 bits │4 bits │ 16 bits  │     32 bits       │  │
│  └────────┴───────┴───────┴──────────┴───────────────────┘  │
│                                                              │
│  명령어 클래스:                                               │
│  ┌─────────────┬────────────────────────────────────────┐   │
│  │ ALU64       │ 64비트 산술/논리 연산                    │   │
│  │ ALU         │ 32비트 산술/논리 연산                    │   │
│  │ JMP         │ 64비트 조건부/무조건 분기                │   │
│  │ JMP32       │ 32비트 조건부 분기                       │   │
│  │ LD          │ 메모리 로드 (비표준)                     │   │
│  │ LDX         │ 메모리 로드 (레지스터 간접 주소)         │   │
│  │ ST          │ 메모리 스토어 (즉시값)                   │   │
│  │ STX         │ 메모리 스토어 (레지스터 간접 주소)       │   │
│  └─────────────┴────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### 간단한 eBPF 프로그램 예시

```c
// XDP 프로그램: 모든 패킷을 통과시킨다
SEC("xdp")
int xdp_pass(struct xdp_md *ctx)
{
    return XDP_PASS;  // R0 = 2 (XDP_PASS)
}

// 어셈블리 수준에서는 다음과 같이 번역된다:
// mov64 r0, 2    ; R0 = XDP_PASS
// exit           ; 프로그램 종료, R0 반환
```

### eBPF 프로그램 로딩 과정

eBPF 프로그램이 커널에 로드되는 과정은 다음과 같다:

```
┌──────────────────────────────────────────────────────────────────┐
│  1. C 코드 작성 → Clang/LLVM으로 eBPF 바이트코드 컴파일          │
│                        │                                         │
│  2. bpf() 시스템 콜 → 커널에 프로그램 로드 요청                   │
│                        │                                         │
│  3. Verifier 검증                                                │
│     - 무한 루프 없음 확인 (DAG 분석)                              │
│     - 메모리 접근 범위 검증 (out-of-bounds 방지)                  │
│     - 모든 실행 경로가 반환값을 갖는지 확인                       │
│     - 권한 없는 메모리 접근 차단                                  │
│                        │                                         │
│  4. JIT Compilation                                              │
│     - eBPF 바이트코드를 네이티브 머신코드(x86_64, ARM64 등)로     │
│       변환한다                                                    │
│     - 네이티브 코드와 동등한 실행 속도를 달성한다                 │
│                        │                                         │
│  5. Hook 지점에 프로그램 부착                                     │
│     - XDP (네트워크 드라이버 레벨, 가장 빠름)                     │
│     - TC (Traffic Control, ingress/egress)                       │
│     - Socket (connect, sendmsg 등)                               │
│     - cgroup (프로세스 그룹 단위)                                 │
└──────────────────────────────────────────────────────────────────┘
```

### eBPF Maps 심화

eBPF Map은 커널 공간과 유저 공간 사이, 또는 eBPF 프로그램 간에 데이터를 공유하는 자료구조이다. Cilium은 다양한 Map 타입을 활용한다:

| Map 타입 | 용도 | Cilium 활용 |
|----------|------|-------------|
| Hash Map | key-value 저장 | Service endpoint 매핑, conntrack 테이블 |
| Array Map | 인덱스 기반 접근 | 설정값, 통계 카운터 |
| LRU Hash | 자동 만료 | Connection tracking |
| LPM Trie | Longest Prefix Match | CIDR 기반 정책 매칭 |
| Ring Buffer | 이벤트 스트리밍 | Hubble 이벤트 전달 |
| Per-CPU Hash | CPU별 독립 해시 | 고성능 카운터, 통계 |
| Per-CPU Array | CPU별 독립 배열 | 패킷 처리 통계 |
| Stack Trace | 스택 추적 저장 | Tetragon 프로파일링 |
| Sock Hash | 소켓 해시 맵 | Socket-Level LB |
| Dev Map | 디바이스 맵 | XDP redirect |

#### Cilium이 사용하는 주요 eBPF Map 상세

Cilium은 내부적으로 수십 개의 eBPF Map을 관리한다. 핵심 Map은 다음과 같다:

```
┌─────────────────────────────────────────────────────────────┐
│  cilium_ct4_global / cilium_ct6_global                      │
│  ├── 타입: LRU Hash                                         │
│  ├── 용도: IPv4/IPv6 Connection Tracking                    │
│  ├── Key: {src_ip, dst_ip, src_port, dst_port, proto, dir} │
│  ├── Value: {lifetime, rx_packets, tx_packets, flags, ...}  │
│  └── 기본 크기: 512K entries (--bpf-ct-global-tcp-max)      │
│                                                              │
│  cilium_lb4_services_v2 / cilium_lb6_services_v2            │
│  ├── 타입: Hash                                              │
│  ├── 용도: Service ClusterIP → Backend 매핑                 │
│  ├── Key: {ip, port, proto, scope}                          │
│  ├── Value: {backend_id, count, flags}                      │
│  └── Service 개수에 비례하여 자동 조정                       │
│                                                              │
│  cilium_lb4_backends_v3                                      │
│  ├── 타입: Hash                                              │
│  ├── 용도: Backend ID → Pod IP/Port 매핑                    │
│  ├── Key: {backend_id}                                      │
│  └── Value: {ip, port, proto, flags}                        │
│                                                              │
│  cilium_policy_*                                             │
│  ├── 타입: Hash                                              │
│  ├── 용도: Endpoint별 정책 맵 (Identity → Allow/Deny)       │
│  ├── Key: {identity, dport, proto, direction}               │
│  └── Value: {proxy_port, auth_type, flags}                  │
│                                                              │
│  cilium_ipcache                                              │
│  ├── 타입: LPM Trie                                          │
│  ├── 용도: IP → Identity 매핑 (ipcache)                     │
│  ├── Key: {prefix_len, ip}                                  │
│  └── Value: {identity, tunnel_endpoint, encrypt_key}        │
│                                                              │
│  cilium_lxc                                                  │
│  ├── 타입: Hash                                              │
│  ├── 용도: Endpoint 정보 (MAC, ifindex 등)                  │
│  └── Key: endpoint_id → Value: endpoint_info                │
│                                                              │
│  cilium_events                                               │
│  ├── 타입: Perf Event Array / Ring Buffer                   │
│  ├── 용도: Hubble 이벤트 전달                                │
│  └── eBPF 프로그램 → userspace (cilium-agent) 이벤트 스트림 │
│                                                              │
│  cilium_signals                                              │
│  ├── 타입: Perf Event Array                                  │
│  ├── 용도: eBPF → cilium-agent 시그널 전달                   │
│  └── CT entry 만료, 정책 verdict 등 알림                     │
│                                                              │
│  cilium_nat_*                                                │
│  ├── 타입: LRU Hash                                          │
│  ├── 용도: SNAT/DNAT 매핑 테이블                            │
│  ├── Key: {src_ip, dst_ip, src_port, dst_port, proto}       │
│  └── Value: {translated_ip, translated_port, ...}           │
│                                                              │
│  cilium_snat_v4_external                                     │
│  ├── 타입: LRU Hash                                          │
│  ├── 용도: 외부 트래픽 SNAT (masquerade)                    │
│  └── 기본 크기: 512K entries                                 │
└─────────────────────────────────────────────────────────────┘
```

### eBPF Helper Functions

Helper Function은 eBPF 프로그램이 커널 기능에 안전하게 접근하기 위해 사용하는 API이다. Verifier가 프로그램 타입에 따라 호출 가능한 Helper를 제한한다.

Cilium이 주로 사용하는 Helper Function은 다음과 같다:

| Helper Function | 용도 | 사용 프로그램 타입 |
|-----------------|------|--------------------|
| `bpf_map_lookup_elem()` | Map에서 값을 조회한다 | 모든 타입 |
| `bpf_map_update_elem()` | Map에 값을 추가/갱신한다 | 모든 타입 |
| `bpf_map_delete_elem()` | Map에서 값을 삭제한다 | 모든 타입 |
| `bpf_skb_load_bytes()` | 패킷 데이터를 읽는다 | TC |
| `bpf_skb_store_bytes()` | 패킷 데이터를 수정한다 | TC |
| `bpf_l3_csum_replace()` | L3 체크섬을 갱신한다 | TC |
| `bpf_l4_csum_replace()` | L4 체크섬을 갱신한다 | TC |
| `bpf_redirect()` | 패킷을 다른 인터페이스로 전달한다 | TC, XDP |
| `bpf_redirect_map()` | Map 기반 패킷 리다이렉트 | XDP |
| `bpf_fib_lookup()` | FIB(라우팅 테이블) 조회 | TC, XDP |
| `bpf_sk_lookup_tcp()` | TCP 소켓을 조회한다 | TC |
| `bpf_get_current_pid_tgid()` | 현재 프로세스 PID를 반환한다 | kprobe, tracepoint |
| `bpf_perf_event_output()` | Perf 이벤트로 데이터를 전달한다 | 대부분 |
| `bpf_ringbuf_output()` | Ring Buffer에 데이터를 기록한다 | 대부분 |
| `bpf_xdp_adjust_head()` | XDP 패킷 헤더 영역을 조정한다 | XDP |
| `bpf_skb_change_head()` | sk_buff 헤더 공간을 변경한다 | TC |
| `bpf_csum_diff()` | 체크섬 차이를 계산한다 | TC |
| `bpf_sock_hash_update()` | 소켓을 sockmap에 추가한다 | sock_ops |

### Verifier 심화

Verifier는 eBPF 프로그램의 안전성을 보장하는 핵심 컴포넌트이다. 프로그램이 커널에 로드되기 전에 정적 분석을 수행하여, 커널을 crash시키거나 보안을 위협하는 프로그램의 로드를 차단한다.

#### Verifier의 검증 단계

```
┌──────────────────────────────────────────────────────────────┐
│  1단계: CFG(Control Flow Graph) 구축                         │
│  ├── 프로그램을 기본 블록(basic block)으로 분할한다           │
│  ├── 블록 간 점프 관계를 DAG(방향 비순환 그래프)로 구성한다  │
│  └── 도달 불가능한 코드(unreachable code)를 탐지한다         │
│                                                              │
│  2단계: 깊이 우선 탐색(DFS) 기반 경로 분석                   │
│  ├── 모든 가능한 실행 경로를 탐색한다                        │
│  ├── 각 경로에서 레지스터의 타입과 범위를 추적한다           │
│  ├── 분기 조건에 따라 레지스터 범위를 좁힌다                 │
│  │   예: if (r1 < 100) → 분기 내에서 R1 범위 = [0, 99]     │
│  └── 경로 수 폭발 방지를 위해 pruning 기법을 적용한다       │
│                                                              │
│  3단계: 메모리 접근 검증                                     │
│  ├── 스택 접근: R10(프레임 포인터) 기준 [-512, 0) 범위만 허용│
│  ├── Map 접근: bpf_map_lookup_elem() 반환값 NULL 체크 필수   │
│  ├── 패킷 접근: data/data_end 경계 체크 필수                 │
│  └── Context 접근: 프로그램 타입별 허용 필드만 접근 가능     │
│                                                              │
│  4단계: Helper 함수 권한 검증                                │
│  ├── 프로그램 타입별 호출 가능 Helper 목록을 확인한다        │
│  ├── 인자 타입이 올바른지 검증한다                           │
│  └── 반환값 처리가 올바른지 확인한다                         │
│                                                              │
│  5단계: 종료 조건 검증                                       │
│  ├── 모든 경로가 반드시 반환값(R0)을 설정하고 종료하는지     │
│  ├── 명령어 수 상한(100만 개)을 초과하지 않는지              │
│  └── bounded loop 조건을 만족하는지 (커널 5.3+)              │
└──────────────────────────────────────────────────────────────┘
```

#### Verifier 에러와 해결 방법

Cilium 개발 시 흔히 만나는 Verifier 에러는 다음과 같다:

| 에러 메시지 | 원인 | 해결 방법 |
|-------------|------|-----------|
| `R0 invalid mem access` | Map lookup 후 NULL 체크 누락 | `if (val == NULL) return;` 추가 |
| `invalid access to packet` | 패킷 경계 체크 누락 | `if (data + offset > data_end)` 체크 추가 |
| `back-edge from insn X` | 무한 루프 탐지 | bounded loop(`for(i=0;i<N;i++)`) 사용 |
| `program is too large` | 명령어 100만 개 초과 | tail call로 분할, 코드 최적화 |
| `unreachable insn` | 도달 불가능 코드 존재 | 불필요한 코드 제거 |

### JIT Compilation 심화

JIT(Just-In-Time) 컴파일러는 eBPF 바이트코드를 네이티브 머신코드로 변환한다.

```
┌──────────────────────────────────────────────────────────────┐
│  JIT 컴파일 과정                                             │
│                                                              │
│  eBPF 바이트코드 (플랫폼 독립)                               │
│        │                                                     │
│        ▼                                                     │
│  ┌──────────────────────┐                                    │
│  │  JIT 컴파일러         │                                    │
│  │  (아키텍처별 구현)     │                                    │
│  │                       │                                    │
│  │  x86_64: arch/x86/    │                                    │
│  │  ARM64:  arch/arm64/  │                                    │
│  │  RISC-V: arch/riscv/  │                                    │
│  └──────────────────────┘                                    │
│        │                                                     │
│        ▼                                                     │
│  네이티브 머신코드                                            │
│  - 레지스터 매핑: R0→rax, R1→rdi, R2→rsi, ...              │
│  - 직접 실행: 인터프리터 오버헤드 제거                       │
│  - Retpoline 적용: Spectre v2 방어                           │
│  - Constant blinding: JIT spray 공격 방어                    │
│                                                              │
│  성능 비교:                                                   │
│  ┌────────────────┬────────────────┬─────────────────┐       │
│  │ 모드           │ 패킷 처리 속도 │ 상대 성능       │       │
│  ├────────────────┼────────────────┼─────────────────┤       │
│  │ 인터프리터     │ ~3 Mpps        │ 1x (baseline)   │       │
│  │ JIT 컴파일     │ ~25 Mpps       │ ~8x             │       │
│  │ 네이티브 (C)   │ ~27 Mpps       │ ~9x             │       │
│  └────────────────┴────────────────┴─────────────────┘       │
│                                                              │
│  JIT 활성화 확인:                                             │
│  sysctl net.core.bpf_jit_enable                              │
│  → 1: JIT 활성화 (기본값)                                    │
│  → 2: JIT + 디버그 정보 출력                                 │
└──────────────────────────────────────────────────────────────┘
```

### eBPF Program Types 심화

#### XDP (eXpress Data Path)

XDP는 네트워크 드라이버 레벨에서 패킷을 처리하는 가장 빠른 hook 지점이다.

```
┌──────────────────────────────────────────────────────────────┐
│  XDP 패킷 처리 위치                                          │
│                                                              │
│  NIC Hardware                                                │
│       │                                                      │
│       ▼                                                      │
│  ┌──────────┐                                                │
│  │ XDP Hook │  ← 여기서 eBPF 프로그램 실행                   │
│  │          │     sk_buff 할당 전, 최소 오버헤드              │
│  └──────────┘                                                │
│       │                                                      │
│       ▼                                                      │
│  sk_buff 할당 (커널 네트워크 스택 진입)                       │
│       │                                                      │
│       ▼                                                      │
│  TC ingress hook                                             │
│       │                                                      │
│       ▼                                                      │
│  네트워크 스택 (IP, TCP/UDP, ...)                             │
│                                                              │
│  XDP 반환값:                                                  │
│  ┌──────────────┬────────────────────────────────────────┐   │
│  │ XDP_DROP     │ 패킷을 즉시 드롭 (DDoS 방어에 활용)    │   │
│  │ XDP_PASS     │ 커널 네트워크 스택으로 전달             │   │
│  │ XDP_TX       │ 동일 NIC로 패킷을 되돌려 보냄           │   │
│  │ XDP_REDIRECT │ 다른 NIC 또는 CPU로 패킷 전달           │   │
│  │ XDP_ABORTED  │ 에러 발생, 패킷 드롭 + trace 이벤트    │   │
│  └──────────────┴────────────────────────────────────────┘   │
│                                                              │
│  XDP 모드:                                                    │
│  ┌──────────────┬────────────────────────────────────────┐   │
│  │ Native XDP   │ NIC 드라이버가 직접 지원, 최고 성능     │   │
│  │ Generic XDP  │ 커널에서 에뮬레이션, 드라이버 무관      │   │
│  │ Offloaded XDP│ NIC 하드웨어(SmartNIC)에서 실행         │   │
│  └──────────────┴────────────────────────────────────────┘   │
│                                                              │
│  Cilium에서의 활용:                                           │
│  - NodePort/LoadBalancer 서비스의 외부 트래픽 DNAT            │
│  - DDoS 방어 (XDP_DROP)                                      │
│  - DSR(Direct Server Return) 모드                            │
│  - Maglev 해싱 기반 로드밸런싱                               │
└──────────────────────────────────────────────────────────────┘
```

#### TC (Traffic Control)

TC hook은 Cilium의 주력 datapath이다. ingress와 egress 양방향에서 패킷을 처리한다.

```
┌──────────────────────────────────────────────────────────────┐
│  TC Hook 위치와 Cilium 활용                                   │
│                                                              │
│  Ingress (수신):                                             │
│  sk_buff 할당 → TC ingress hook → eBPF 프로그램 실행        │
│  ├── Policy 검사 (src Identity → Allow/Deny)                │
│  ├── Conntrack lookup (기존 연결 확인)                       │
│  ├── Service DNAT (ClusterIP → Backend)                     │
│  └── L7 proxy redirect (필요 시 Envoy로 전달)               │
│                                                              │
│  Egress (송신):                                              │
│  애플리케이션 → TCP/IP 스택 → TC egress hook                │
│  ├── Policy 검사 (dst Identity → Allow/Deny)                │
│  ├── Conntrack 업데이트                                      │
│  ├── SNAT/Masquerade (외부 트래픽)                           │
│  └── Encapsulation (VXLAN/Geneve 터널링)                    │
│                                                              │
│  TC 반환값:                                                   │
│  ┌──────────────┬────────────────────────────────────────┐   │
│  │ TC_ACT_OK    │ 패킷 통과                               │   │
│  │ TC_ACT_SHOT  │ 패킷 드롭                               │   │
│  │ TC_ACT_REDIRECT│ 다른 인터페이스로 리다이렉트           │   │
│  │ TC_ACT_PIPE  │ 다음 필터로 전달                         │   │
│  └──────────────┴────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

#### Socket Programs

Socket 프로그램은 시스템콜 레벨에서 동작하여, TCP/IP 스택 진입 전에 패킷 처리를 완료한다.

```
┌──────────────────────────────────────────────────────────────┐
│  Socket 프로그램 타입                                         │
│                                                              │
│  BPF_PROG_TYPE_SOCK_OPS:                                     │
│  ├── TCP 연결 수명주기 이벤트를 가로챈다                     │
│  ├── 연결 설정/해제 시 호출된다                               │
│  └── Cilium: sockmap에 소켓을 등록한다                       │
│                                                              │
│  BPF_PROG_TYPE_SK_MSG:                                       │
│  ├── sendmsg() 시 호출된다                                   │
│  ├── 메시지를 다른 소켓으로 직접 전달할 수 있다              │
│  └── Cilium: 같은 노드 내 Pod 간 bypass (host networking)   │
│                                                              │
│  BPF_PROG_TYPE_CGROUP_SOCK_ADDR:                             │
│  ├── connect(), bind(), sendmsg() 시 주소를 변환한다        │
│  ├── NAT 없이 Service ClusterIP → Backend IP 변환           │
│  └── Cilium: Socket-Level LB의 핵심                          │
│                                                              │
│  Socket-Level 최적화 효과:                                    │
│                                                              │
│  기존 (kube-proxy):                                           │
│  App → connect(ClusterIP) → TCP SYN → iptables DNAT →      │
│  conntrack → routing → NIC → ... → Backend Pod              │
│                                                              │
│  Cilium Socket-Level LB:                                     │
│  App → connect(ClusterIP) → [eBPF: ClusterIP→BackendIP] →  │
│  TCP SYN (직접 Backend IP로) → NIC → ... → Backend Pod      │
│  (NAT 없음, conntrack 불필요)                                │
└──────────────────────────────────────────────────────────────┘
```

#### cgroup Programs

cgroup eBPF 프로그램은 프로세스 그룹(cgroup) 단위로 네트워크 정책을 적용한다.

```
주요 cgroup 프로그램 타입:
┌──────────────────────────────────────────────────────────────┐
│ BPF_CGROUP_INET_INGRESS/EGRESS                               │
│ ├── cgroup에 속한 모든 소켓의 ingress/egress 패킷 필터링    │
│ └── Cilium: Pod cgroup에 연결하여 호스트 방화벽 구현         │
│                                                              │
│ BPF_CGROUP_INET4_CONNECT / BPF_CGROUP_INET6_CONNECT         │
│ ├── connect() 시스템콜에서 목적지 주소를 변환한다            │
│ └── Cilium: Socket-Level LB (ClusterIP → Backend)           │
│                                                              │
│ BPF_CGROUP_INET4_GETPEERNAME                                 │
│ ├── getpeername()이 원래 ClusterIP를 반환하도록 한다         │
│ └── 애플리케이션 투명성 보장                                 │
│                                                              │
│ BPF_CGROUP_SYSCTL                                            │
│ ├── sysctl 파라미터 접근을 제어한다                          │
│ └── 보안 정책 적용                                           │
└──────────────────────────────────────────────────────────────┘
```

### Tail Calls와 프로그램 체이닝

Cilium은 eBPF 프로그램의 명령어 수 제한을 극복하기 위해 Tail Call을 광범위하게 활용한다.

```
┌──────────────────────────────────────────────────────────────┐
│  Tail Call 구조                                               │
│                                                              │
│  하나의 eBPF 프로그램에서 다른 프로그램을 호출한다.           │
│  호출된 프로그램은 호출자의 스택을 재사용한다.               │
│  반환은 호출자가 아닌 커널으로 직접 이루어진다.              │
│                                                              │
│  Cilium TC ingress 처리 체인:                                │
│                                                              │
│  from-container (진입점)                                     │
│       │                                                      │
│       ├──→ tail_call: policy 프로그램                        │
│       │         │                                            │
│       │         ├──→ tail_call: L7 proxy redirect            │
│       │         │                                            │
│       │         └──→ tail_call: DNAT (서비스 변환)           │
│       │                    │                                  │
│       │                    └──→ tail_call: encap/fwd         │
│       │                                                      │
│       └──→ tail_call: IPv6 처리 (듀얼 스택 시)              │
│                                                              │
│  제한사항:                                                    │
│  - 최대 33번까지 체이닝 가능 (무한 루프 방지)               │
│  - tail call은 반환하지 않으므로 호출 전 상태 저장 필요      │
│  - 프로그램 간 데이터는 Map 또는 패킷 메타데이터로 공유     │
└──────────────────────────────────────────────────────────────┘
```

---

