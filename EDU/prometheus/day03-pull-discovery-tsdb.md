# Day 3: Pull 모델, Service Discovery, TSDB 내부 구조

> Prometheus의 Pull 기반 수집 모델, Kubernetes Service Discovery 메커니즘, TSDB의 WAL/블록/컴팩션/인덱스 내부 구조를 학습한다.

## Pull 모델 심화

### Pull vs Push
| 항목 | Pull (Prometheus) | Push (예: StatsD, InfluxDB) |
|------|-------------------|----------------------------|
| 방향 | Prometheus가 타겟에서 메트릭을 가져온다 | 애플리케이션이 메트릭을 전송한다 |
| 헬스체크 | 스크래핑 실패 = 타겟 다운 (자동 헬스체크) | 메트릭이 안 오는 이유를 알기 어렵다 |
| 디버깅 | 타겟의 `/metrics`를 curl로 직접 확인할 수 있다 | 전송 경로를 추적해야 한다 |
| 스케일링 | Prometheus가 부하를 제어한다 | 타겟이 많아지면 수신 측에 부하가 몰릴 수 있다 |
| 단기 작업 | Pushgateway를 통해 지원한다 | 자연스럽게 지원한다 |

### Scrape 설정 상세
```yaml
scrape_configs:
  - job_name: 'my-app'
    scrape_interval: 15s      # 스크래핑 주기 (기본: global.scrape_interval)
    scrape_timeout: 10s       # 스크래핑 타임아웃 (scrape_interval보다 작아야 한다)
    metrics_path: '/metrics'  # 메트릭 경로 (기본: /metrics)
    scheme: 'https'           # HTTP 또는 HTTPS
    honor_labels: false       # true이면 타겟의 라벨이 Prometheus 라벨보다 우선한다
    honor_timestamps: true    # true이면 타겟이 보낸 타임스탬프를 사용한다
```

#### honor_labels 동작
- `honor_labels: false` (기본값): 타겟의 라벨과 Prometheus가 부여하는 라벨(`job`, `instance`)이 충돌하면, Prometheus 라벨이 우선되고 타겟 라벨은 `exported_` 접두사가 붙는다
- `honor_labels: true`: 타겟의 라벨이 그대로 유지된다. Federation이나 Pushgateway에서 사용한다

### Relabeling
Relabeling은 스크래핑 전후에 라벨을 조작하는 메커니즘이다. 두 가지 단계가 있다.

#### relabel_configs (스크래핑 전)
- Service Discovery에서 발견한 타겟의 메타데이터 라벨(`__meta_*`)을 사용하여 타겟을 필터링하거나 라벨을 변환한다
- 스크래핑 대상 자체를 결정하는 단계이다

```yaml
relabel_configs:
  # 특정 어노테이션이 있는 Pod만 스크래핑한다
  - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
    action: keep
    regex: true

  # 어노테이션에서 메트릭 경로를 가져온다
  - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
    action: replace
    target_label: __metrics_path__
    regex: (.+)

  # 포트 정보를 가져온다
  - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
    action: replace
    regex: ([^:]+)(?::\d+)?;(\d+)
    replacement: $1:$2
    target_label: __address__
```

#### metric_relabel_configs (스크래핑 후)
- 수집된 메트릭의 라벨을 변환하거나, 불필요한 메트릭을 드롭하는 단계이다
- 저장 전에 적용된다

```yaml
metric_relabel_configs:
  # 특정 메트릭을 드롭하여 저장 공간을 절약한다
  - source_labels: [__name__]
    regex: 'go_.*'
    action: drop

  # 라벨 이름을 변경한다
  - source_labels: [pod_name]
    target_label: pod
    action: replace
```

#### Relabeling Action 전체 목록

| Action | 설명 | 사용 예시 |
|--------|------|----------|
| `replace` | source_labels를 regex로 매칭하여 target_label에 replacement를 적용한다 (기본값) | 라벨 값 변환 |
| `keep` | regex에 매칭되는 타겟만 유지한다 | 특정 어노테이션이 있는 Pod만 스크래핑 |
| `drop` | regex에 매칭되는 타겟을 제거한다 | 특정 네임스페이스 제외 |
| `hashmod` | source_labels의 해시값을 modulus로 나눈 나머지를 target_label에 저장한다 | Prometheus 샤딩 |
| `labelmap` | regex에 매칭되는 모든 라벨 이름을 replacement로 변환한다 | `__meta_kubernetes_node_label_(.+)` -> `$1` |
| `labeldrop` | regex에 매칭되는 라벨을 제거한다 | 불필요한 라벨 정리 |
| `labelkeep` | regex에 매칭되는 라벨만 유지한다 | 필요한 라벨만 보존 |
| `lowercase` | source_labels 값을 소문자로 변환한다 (Prometheus 2.36+) | 라벨 정규화 |
| `uppercase` | source_labels 값을 대문자로 변환한다 (Prometheus 2.36+) | 라벨 정규화 |

#### Relabeling 심화 예제

```yaml
# 예제 1: Prometheus 샤딩 (hashmod를 사용한 타겟 분배)
# 3대의 Prometheus가 타겟을 나누어 스크래핑한다
relabel_configs:
  - source_labels: [__address__]
    modulus: 3
    target_label: __tmp_hash
    action: hashmod
  - source_labels: [__tmp_hash]
    regex: 0           # Prometheus #0은 hash=0인 타겟만
    action: keep

# 예제 2: Kubernetes Node 라벨을 Prometheus 라벨로 복사
relabel_configs:
  - action: labelmap
    regex: __meta_kubernetes_node_label_(.+)

# 예제 3: Pod 어노테이션 기반 동적 스크래핑 설정
relabel_configs:
  # prometheus.io/scrape: "true" 어노테이션이 있는 Pod만
  - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
    action: keep
    regex: true
  # prometheus.io/scheme 어노테이션으로 HTTP/HTTPS 결정
  - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scheme]
    action: replace
    target_label: __scheme__
    regex: (https?)
  # prometheus.io/path 어노테이션으로 메트릭 경로 결정
  - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
    action: replace
    target_label: __metrics_path__
    regex: (.+)
  # Pod IP + prometheus.io/port 어노테이션으로 주소 결정
  - source_labels: [__meta_kubernetes_pod_ip, __meta_kubernetes_pod_annotation_prometheus_io_port]
    action: replace
    regex: (.+);(\d+)
    replacement: $1:$2
    target_label: __address__
```

---

## Service Discovery

Prometheus는 다양한 Service Discovery 메커니즘을 지원하여 모니터링 타겟을 자동으로 발견한다.

### kubernetes_sd_config
Kubernetes 환경에서 가장 핵심적인 Service Discovery이다. Kubernetes API를 통해 타겟을 자동으로 발견한다.

| Role | 대상 | 주요 메타 라벨 | 용도 |
|------|------|---------------|------|
| `node` | 클러스터 노드 | `__meta_kubernetes_node_name`, `__meta_kubernetes_node_label_*` | kubelet 메트릭, node-exporter |
| `pod` | 개별 Pod | `__meta_kubernetes_pod_name`, `__meta_kubernetes_pod_namespace`, `__meta_kubernetes_pod_container_port_number` | 애플리케이션 메트릭 직접 수집 |
| `service` | Service 객체 | `__meta_kubernetes_service_name`, `__meta_kubernetes_service_port_name` | 블랙박스 모니터링 |
| `endpoints` | Endpoints 객체 (Service 뒤의 Pod) | `__meta_kubernetes_endpoint_port_name`, Pod/Service 메타 라벨 포함 | 가장 일반적인 서비스 메트릭 수집 |
| `endpointslice` | EndpointSlice 객체 | endpoints와 유사, 대규모 클러스터에 적합 | endpoints의 확장판 |
| `ingress` | Ingress 객체 | `__meta_kubernetes_ingress_name`, `__meta_kubernetes_ingress_path` | 블랙박스 Probe 모니터링 |

### kubernetes_sd_config Role 심화

#### node role

```yaml
scrape_configs:
  - job_name: 'kubernetes-nodes'
    kubernetes_sd_configs:
      - role: node
    # node role은 각 노드의 kubelet 주소를 __address__로 설정한다
    # 기본 포트는 10250 (kubelet HTTPS)이다

    # 사용 가능한 메타 라벨들:
    # __meta_kubernetes_node_name: 노드 이름
    # __meta_kubernetes_node_provider_id: 클라우드 프로바이더 ID
    # __meta_kubernetes_node_label_<name>: 노드 라벨 (. -> _)
    # __meta_kubernetes_node_labelpresent_<name>: 노드 라벨 존재 여부
    # __meta_kubernetes_node_annotation_<name>: 노드 어노테이션
    # __meta_kubernetes_node_address_<type>: 노드 주소 (InternalIP, ExternalIP 등)

    relabel_configs:
      # kubelet 대신 node-exporter를 스크래핑하도록 포트 변경
      - source_labels: [__meta_kubernetes_node_address_InternalIP]
        target_label: __address__
        replacement: $1:9100
```

#### pod role

```yaml
scrape_configs:
  - job_name: 'kubernetes-pods'
    kubernetes_sd_configs:
      - role: pod
    # pod role은 각 Pod의 모든 컨테이너 포트를 타겟으로 생성한다
    # 포트가 없는 Pod는 포트 없이 Pod IP만 __address__로 설정된다

    # 사용 가능한 메타 라벨들:
    # __meta_kubernetes_pod_name: Pod 이름
    # __meta_kubernetes_pod_namespace: 네임스페이스
    # __meta_kubernetes_pod_ip: Pod IP
    # __meta_kubernetes_pod_label_<name>: Pod 라벨
    # __meta_kubernetes_pod_annotation_<name>: Pod 어노테이션
    # __meta_kubernetes_pod_container_name: 컨테이너 이름
    # __meta_kubernetes_pod_container_port_name: 포트 이름
    # __meta_kubernetes_pod_container_port_number: 포트 번호
    # __meta_kubernetes_pod_container_port_protocol: 프로토콜
    # __meta_kubernetes_pod_ready: Ready 상태
    # __meta_kubernetes_pod_phase: Phase (Running, Pending 등)
    # __meta_kubernetes_pod_node_name: 노드 이름
    # __meta_kubernetes_pod_host_ip: 호스트 IP
    # __meta_kubernetes_pod_controller_kind: 컨트롤러 종류 (ReplicaSet, DaemonSet 등)
    # __meta_kubernetes_pod_controller_name: 컨트롤러 이름
```

#### endpoints role

```yaml
scrape_configs:
  - job_name: 'kubernetes-endpoints'
    kubernetes_sd_configs:
      - role: endpoints
    # endpoints role은 Service의 Endpoints 객체에 등록된 Pod를 타겟으로 생성한다
    # Service와 연결된 Pod의 메타 라벨을 모두 사용할 수 있어 가장 풍부한 정보를 제공한다

    # endpoints 전용 메타 라벨:
    # __meta_kubernetes_endpoint_port_name: 엔드포인트 포트 이름
    # __meta_kubernetes_endpoint_port_protocol: 프로토콜
    # __meta_kubernetes_endpoint_ready: 엔드포인트 Ready 상태
    # __meta_kubernetes_endpoint_address_target_kind: 타겟 종류 (Pod 등)
    # __meta_kubernetes_endpoint_address_target_name: 타겟 이름

    # + Service 메타 라벨 (__meta_kubernetes_service_*)
    # + Pod 메타 라벨 (__meta_kubernetes_pod_*)
```

#### ingress role

```yaml
scrape_configs:
  - job_name: 'kubernetes-ingresses'
    kubernetes_sd_configs:
      - role: ingress
    # ingress role은 각 Ingress의 path를 타겟으로 생성한다
    # 블랙박스 Probe 모니터링에 주로 사용한다

    # __meta_kubernetes_ingress_name: Ingress 이름
    # __meta_kubernetes_ingress_namespace: 네임스페이스
    # __meta_kubernetes_ingress_label_<name>: Ingress 라벨
    # __meta_kubernetes_ingress_scheme: 스키마 (http/https)
    # __meta_kubernetes_ingress_host: 호스트
    # __meta_kubernetes_ingress_path: 경로

    # blackbox_exporter와 함께 사용하는 예시
    metrics_path: /probe
    params:
      module: [http_2xx]
    relabel_configs:
      - source_labels: [__meta_kubernetes_ingress_scheme, __meta_kubernetes_ingress_host, __meta_kubernetes_ingress_path]
        regex: (.+);(.+);(.+)
        replacement: ${1}://${2}${3}
        target_label: __param_target
      - target_label: __address__
        replacement: blackbox-exporter:9115
```

### 기타 Service Discovery
| 방식 | 설명 | 사용 사례 |
|------|------|----------|
| `static_configs` | 정적으로 타겟을 지정한다 | 고정 IP/포트의 외부 서비스 |
| `file_sd_configs` | JSON/YAML 파일에서 타겟 목록을 읽는다. 파일 변경 시 자동 리로드된다 | 외부 시스템에서 타겟 목록을 생성하는 경우 |
| `consul_sd_configs` | HashiCorp Consul에서 서비스를 발견한다 | Consul 기반 인프라 |
| `dns_sd_configs` | DNS SRV 레코드로 타겟을 발견한다 | DNS 기반 서비스 디스커버리 |
| `ec2_sd_configs` | AWS EC2 인스턴스를 자동 발견한다 | AWS 환경 |
| `gce_sd_configs` | GCP Compute Engine 인스턴스를 자동 발견한다 | GCP 환경 |

---

## TSDB 내부 구조

Prometheus TSDB는 시계열 데이터에 최적화된 로컬 스토리지 엔진이다.

### 전체 구조
```
data/
├── wal/                    # Write-Ahead Log (최신 데이터)
│   ├── 00000001
│   ├── 00000002
│   └── checkpoint.00000001
├── chunks_head/            # Head block의 메모리 매핑된 청크
├── 01BKGV7JBM69T2G1BGBGM6KB12/  # Persistent block
│   ├── meta.json           # 블록 메타데이터 (시간 범위, 시계열 수 등)
│   ├── index               # 라벨 인덱스 (inverted index)
│   ├── chunks/             # 압축된 시계열 데이터
│   │   └── 000001
│   └── tombstones          # 삭제 표시
├── 01BKGTZQ1SYQJTR4PB43C8PD98/  # 또 다른 persistent block
│   ├── ...
└── lock                    # 프로세스 잠금 파일
```

### WAL (Write-Ahead Log)
- 모든 수집된 샘플은 먼저 WAL에 기록된다. 장애 복구(crash recovery)를 위한 것이다
- WAL은 128MB 세그먼트 파일로 구성된다
- Prometheus 재시작 시 WAL을 재생(replay)하여 Head block을 복구한다
- WAL checkpoint는 이미 블록으로 전환된 데이터를 WAL에서 제거하여 디스크 사용량을 줄인다
- WAL 쓰기는 순차적(sequential)이므로 HDD에서도 빠르다

#### WAL 내부 동작 심화

WAL은 다음 세 종류의 레코드를 저장한다.

```
WAL 레코드 종류:
1. Series Record: 새로운 시계열이 처음 관찰될 때 기록된다
   - 시계열 ID (ref)
   - 라벨 셋 (labels)

2. Samples Record: 새로운 샘플이 도착할 때 기록된다
   - 시계열 ID (ref)
   - 타임스탬프 (t)
   - 값 (v)

3. Tombstones Record: 시계열 삭제가 요청될 때 기록된다
   - 시계열 ID (ref)
   - 삭제할 시간 범위 (mint, maxt)
```

#### WAL Checkpoint 메커니즘

```
WAL 세그먼트:
[seg-001] [seg-002] [seg-003] [seg-004] [seg-005]
                              ^
                              |
                       Head block이 seg-003까지의
                       데이터를 persistent block으로 flush

Checkpoint 과정:
1. seg-001 ~ seg-003의 Series Record 중 현재 Head에 존재하는 것만 추출
2. checkpoint.00003 파일에 기록
3. seg-001, seg-002, seg-003 삭제

결과:
[checkpoint.00003] [seg-004] [seg-005]
```

#### WAL 관련 메트릭

```promql
# WAL 재생 시간 (Prometheus 재시작 성능 지표)
prometheus_tsdb_wal_replay_duration_seconds

# WAL 세그먼트 수
prometheus_tsdb_wal_segment_current

# WAL 손상 횟수 (데이터 유실 위험)
prometheus_tsdb_wal_corruptions_total

# WAL 쓰기 실패 횟수
prometheus_tsdb_wal_writes_failed_total

# WAL Checkpoint 소요 시간
prometheus_tsdb_checkpoint_duration_seconds

# WAL 크기 (바이트)
prometheus_tsdb_wal_storage_size_bytes
```

### Head Block vs Persistent Block
| 구분 | Head Block | Persistent Block |
|------|-----------|-----------------|
| 위치 | 메모리 + `chunks_head/` | 디스크 (`ULID/` 디렉터리) |
| 데이터 범위 | 최근 2시간 (기본값) | Head block에서 컴팩션된 과거 데이터 |
| 쓰기 | 실시간으로 샘플을 추가한다 | 불변(immutable)이다 |
| 압축 | 미압축 또는 부분 압축 | Gorilla 압축이 적용된다 |
| 인덱스 | 인메모리 inverted index | 디스크 기반 인덱스 파일 |

### Head Block 심화

#### 메모리 매핑 청크 (Memory-Mapped Chunks)

Prometheus 2.19+부터 Head Block의 오래된 청크를 디스크에 메모리 매핑(mmap)하여 RAM 사용을 줄인다.

```
Head Block 구조:
┌──────────────────────────────────────────────┐
│                Head Block                     │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │ In-Memory Chunks (활성 청크)             │  │
│  │ - 최근 120개 샘플 또는 2시간 이내         │  │
│  │ - RAM에 저장되어 빠른 append 가능         │  │
│  └─────────────────────────────────────────┘  │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │ Memory-Mapped Chunks (오래된 청크)       │  │
│  │ - chunks_head/ 디렉터리에 저장           │  │
│  │ - mmap으로 접근하여 RAM 절약             │  │
│  │ - OS 페이지 캐시로 관리됨                │  │
│  └─────────────────────────────────────────┘  │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │ In-Memory Index                         │  │
│  │ - Inverted Index (라벨 -> 시계열 ID)    │  │
│  │ - Postings List                         │  │
│  │ - 시계열 수에 비례하여 메모리 사용       │  │
│  └─────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

#### Head Block 메모리 사용량 추정

```
# 시계열당 메모리 사용량 (대략적 추정):
# - 라벨 인덱스: ~1KB/시계열
# - 활성 청크: ~200B/시계열
# - 기타 오버헤드: ~300B/시계열
# 합계: ~1.5KB/시계열

# 예시: 100만 시계열 = 약 1.5GB RAM
# 이 프로젝트의 memory limit 2Gi는 약 100만 시계열까지 적합하다

# 메모리 사용량 확인 메트릭
prometheus_tsdb_head_chunks          # Head의 현재 청크 수
prometheus_tsdb_head_series          # Head의 현재 시계열 수
process_resident_memory_bytes        # 프로세스 RSS 메모리
go_memstats_heap_inuse_bytes         # Go 힙 메모리
```

### Block Compaction
- Head block은 약 2시간마다 디스크의 persistent block으로 플러시된다
- 작은 블록들은 더 큰 블록으로 병합(compaction)된다. 기본적으로 최대 시간 범위의 10%까지 병합한다
- Compaction은 중복 시계열 제거, 인덱스 최적화, tombstone 적용을 수행한다
- Compaction 과정에서 CPU와 디스크 I/O가 증가하므로, 운영 시 이 시점을 모니터링해야 한다

#### Compaction 단계 상세

```
시간 →
┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐
│ 2h  ││ 2h  ││ 2h  ││ 2h  ││ 2h  ││ 2h  │  Level 0 (Head flush)
└──┬──┘└──┬──┘└──┬──┘└──┬──┘└──┬──┘└──┬──┘
   └──┬───┘     └──┬───┘     └──┬───┘
┌─────┴─────┐┌─────┴─────┐┌─────┴─────┐
│    4h     ││    4h     ││    4h     │      Level 1
└─────┬─────┘└─────┬─────┘└───────────┘
      └──────┬─────┘
┌────────────┴───────────┐
│           8h           │                    Level 2
└────────────────────────┘

# Compaction 트리거 조건:
# 1. 같은 level의 블록이 3개 이상이 되면 compaction 수행
# 2. 최대 블록 크기 = retention 기간의 10% (기본)
#    예: retention=7d이면 최대 블록 = 약 16.8h
```

#### Compaction 관련 메트릭

```promql
# Compaction 소요 시간
prometheus_tsdb_compaction_duration_seconds

# Compaction이 트리거된 횟수
prometheus_tsdb_compactions_total

# Compaction 실패 횟수
prometheus_tsdb_compactions_failed_total

# 현재 블록 수
prometheus_tsdb_blocks_loaded

# 블록 로딩 시간
prometheus_tsdb_block_reload_duration_seconds
```

### Index 구조 심화

각 persistent block의 `index` 파일은 효율적인 시계열 검색을 위한 inverted index를 포함한다.

```
Index 파일 구조:
┌─────────────────────────────┐
│ Symbol Table                │  모든 라벨 이름/값 문자열의 딕셔너리
├─────────────────────────────┤
│ Series                      │  시계열별 라벨 셋 + 청크 참조
├─────────────────────────────┤
│ Label Index                 │  라벨 이름 -> 가능한 값 목록
├─────────────────────────────┤
│ Postings                    │  라벨 이름/값 쌍 -> 시계열 ID 목록
├─────────────────────────────┤
│ Postings Offset Table       │  Postings 섹션의 오프셋 테이블
├─────────────────────────────┤
│ TOC (Table of Contents)     │  각 섹션의 위치 정보
└─────────────────────────────┘
```

#### Inverted Index 동작 원리

```
# 쿼리: http_requests_total{method="GET", status="200"}

# 1단계: Postings 조회
# __name__="http_requests_total" -> {시계열 1, 2, 3, 4, 5}
# method="GET"                   -> {시계열 1, 3, 5, 7, 9}
# status="200"                   -> {시계열 1, 5, 8, 10}

# 2단계: Intersection (교집합)
# {1, 2, 3, 4, 5} ∩ {1, 3, 5, 7, 9} ∩ {1, 5, 8, 10} = {1, 5}

# 3단계: Series 정보 조회
# 시계열 1, 5의 청크 참조를 얻고, 청크에서 실제 데이터를 읽는다
```

### Chunk Encoding (Gorilla 압축)
- Facebook의 Gorilla 논문(2015)에서 제안된 시계열 압축 알고리즘을 사용한다
- 타임스탬프: Delta-of-Delta 인코딩을 사용한다. 일정 간격으로 수집된 데이터는 거의 0비트로 저장된다
- 값(float64): XOR 인코딩을 사용한다. 연속된 값이 비슷할수록 적은 비트로 저장된다
- 샘플당 평균 1.37바이트로 압축된다 (비압축 float64+int64 = 16바이트 대비 약 12배 효율)

#### Delta-of-Delta 타임스탬프 인코딩 상세

```
# 원본 타임스탬프 (15초 간격 스크래핑):
t0 = 1609459200000  (ms)
t1 = 1609459215000
t2 = 1609459230000
t3 = 1609459245000

# Delta (차이):
d1 = t1 - t0 = 15000
d2 = t2 - t1 = 15000
d3 = t3 - t2 = 15000

# Delta-of-Delta:
dd2 = d2 - d1 = 0     # 1비트로 저장 (0 = "변화 없음")
dd3 = d3 - d2 = 0     # 1비트로 저장

# 간격이 일정하면 타임스탬프당 1비트만 사용한다!
# 간격이 불규칙하면 더 많은 비트를 사용한다 (최대 68비트)
```

#### XOR 값 인코딩 상세

```
# 원본 값 (float64, 64비트):
v0 = 3.14159 (IEEE 754: 0x400921FB54442D18)
v1 = 3.14160 (IEEE 754: 0x400921FB82CC9B50)

# XOR:
xor = v0 XOR v1 = 0x00000000D688B648

# XOR 결과의 선행 0과 후행 0을 계산:
# leading zeros = 32
# trailing zeros = 3
# 의미 있는 비트 = 64 - 32 - 3 = 29비트

# 저장: leading zeros(5비트) + 비트 수(6비트) + 의미 있는 비트(29비트) = 40비트
# 비압축 64비트 대비 40비트 = 62.5% 압축

# 연속된 값이 동일하면 XOR = 0이므로 1비트만 저장한다
```

### Retention 정책
```yaml
# 시간 기반 보관 (기본: 15일)
--storage.tsdb.retention.time=15d

# 크기 기반 보관 (시간 기반과 함께 사용 가능)
--storage.tsdb.retention.size=50GB

# 크기 제한에 도달하면 가장 오래된 블록부터 삭제한다
# 두 조건 중 하나라도 충족되면 삭제가 발생한다
```

#### 이 프로젝트의 Retention 설정

```yaml
# manifests/monitoring-values.yaml에서:
prometheus:
  prometheusSpec:
    retention: 7d  # 7일간 보존
    storageSpec:
      volumeClaimTemplate:
        spec:
          resources:
            requests:
              storage: 10Gi  # 10GB PVC
```

- 7일 보존 + 10GB 제한이 동시에 적용된다
- scrape_interval=30s, 50만 시계열 기준으로 7일간 약 5GB를 사용한다
- 시계열 수가 증가하면 10GB에 먼저 도달하여 오래된 블록이 삭제될 수 있다

### Staleness 처리
- Prometheus는 5분 staleness 마커를 사용한다
- 타겟이 사라지거나 시계열이 더 이상 노출되지 않으면, 마지막 샘플로부터 5분이 지난 시점에 해당 시계열을 "stale"로 표시한다
- Stale 시계열은 쿼리 결과에서 자동으로 제외된다
- `up` 메트릭이 0이 되면(스크래핑 실패), 해당 타겟의 모든 시계열에 즉시 staleness marker가 삽입된다
- Staleness marker는 NaN 값으로 저장되며, 이는 시계열이 끝났음을 의미한다

#### Staleness가 중요한 이유

```
# 문제 시나리오: Staleness가 없다면
# Pod A가 삭제되고 Pod B가 생성되면:
# - Pod A의 마지막 메트릭이 5분간 "유령처럼" 쿼리 결과에 남는다
# - rate() 계산 시 Pod A의 오래된 값이 현재 값으로 사용될 수 있다
# - up 메트릭이 1인 타겟이 실제로는 다운된 상태일 수 있다

# Staleness marker 덕분에:
# - Pod A의 시계열은 즉시 쿼리 결과에서 사라진다
# - rate() 계산이 정확해진다
# - 모니터링 대시보드에 "유령" 시계열이 나타나지 않는다
```

---

