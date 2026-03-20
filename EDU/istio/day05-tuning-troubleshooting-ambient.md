# Day 5: 성능 튜닝, 트러블슈팅, Ambient Mesh, 실전 시나리오

> 이 문서에서는 성능 튜닝(Sidecar 리소스 최적화, Control Plane 튜닝, Envoy 필터 최적화), 트러블슈팅(istioctl 진단, 일반적인 문제와 해결), Ambient Mesh(ztunnel, waypoint proxy), 그리고 실전 시나리오(Zero-downtime 배포, gRPC 로드밸런싱, 외부 서비스 통합)를 다룬다.

---

## 9. 성능 튜닝

### 9.1 Sidecar 리소스 제한

tart-infra 프로젝트에서는 `manifests/istio/istio-values.yaml`에서 사이드카 리소스를 제한한다.

```yaml
# manifests/istio/istio-values.yaml (실제 프로젝트 설정)
pilot:
  resources:
    requests:
      cpu: 200m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi
  autoscaleEnabled: false

meshConfig:
  accessLogFile: /dev/stdout
  enableTracing: false                     # 트레이싱 비활성화 (리소스 절약)

global:
  proxy:
    resources:
      requests:
        cpu: 50m
        memory: 64Mi
      limits:
        cpu: 200m
        memory: 128Mi
  proxy_init:
    resources:
      requests:
        cpu: 10m
        memory: 16Mi
      limits:
        cpu: 100m
        memory: 64Mi
```

**리소스 설정 가이드라인:**

| 워크로드 유형 | CPU Request | CPU Limit | Memory Request | Memory Limit |
|-------------|-------------|-----------|----------------|--------------|
| 저트래픽 서비스 | 10m | 100m | 40Mi | 128Mi |
| 일반 서비스 | 50m | 200m | 64Mi | 256Mi |
| 고트래픽 서비스 | 100m | 500m | 128Mi | 512Mi |
| API Gateway | 200m | 1000m | 256Mi | 1Gi |

### 9.2 Proxy Concurrency

Envoy의 worker thread 수를 조절하여 성능을 최적화할 수 있다.

```yaml
# meshConfig에서 전체 설정
meshConfig:
  defaultConfig:
    concurrency: 2                         # worker thread 수
                                           # 0 = 자동 (CPU 코어 수)
                                           # 기본값: 2

# Pod 어노테이션으로 개별 설정
metadata:
  annotations:
    proxy.istio.io/config: |
      concurrency: 4
```

**Concurrency 설정 가이드:**

| 값 | 설명 | 적합한 경우 |
|----|------|-----------|
| 0 | CPU 코어 수만큼 자동 설정 | CPU limit이 충분할 때 |
| 1 | 단일 스레드 | 저트래픽, 리소스 절약이 중요할 때 |
| 2 | 기본값 | 대부분의 경우 |
| 4+ | 고성능 | 고트래픽, CPU 코어가 충분할 때 |

### 9.3 프로토콜 감지 (Protocol Detection)

Istio는 트래픽의 프로토콜을 자동으로 감지한다. 그러나 일부 경우 감지에 시간이 걸리거나 잘못 감지할 수 있다.

**명시적 프로토콜 지정:**

```yaml
# Service에서 포트 이름으로 프로토콜 지정
apiVersion: v1
kind: Service
metadata:
  name: httpbin
  namespace: demo
spec:
  ports:
    - name: http            # "http-*" 또는 "http"로 시작하면 HTTP
      port: 80
    - name: grpc-api        # "grpc-*"로 시작하면 gRPC
      port: 9090
    - name: tcp-redis       # "tcp-*"로 시작하면 TCP
      port: 6379
    - name: mongo-db        # "mongo-*"로 시작하면 MongoDB
      port: 27017
    - name: mysql-db        # "mysql-*"로 시작하면 MySQL
      port: 3306
```

**지원하는 프로토콜 접두사:**

| 접두사 | 프로토콜 | 비고 |
|--------|---------|------|
| `http`, `http2` | HTTP | L7 라우팅, 메트릭, 트레이싱 지원 |
| `grpc`, `grpc-web` | gRPC | L7 라우팅, 메트릭 지원 |
| `tcp` | TCP | L4 메트릭만 지원 |
| `tls` | TLS | SNI 기반 라우팅 |
| `mongo` | MongoDB | MongoDB 프로토콜 인식 |
| `mysql` | MySQL | MySQL 프로토콜 인식 |
| `redis` | Redis | Redis 프로토콜 인식 |
| `udp` | UDP | UDP 트래픽 (제한적 지원) |

### 9.4 Sidecar 스코프 최적화

대규모 메시에서는 Sidecar 리소스로 각 사이드카가 수신하는 설정의 범위를 제한해야 한다.

```yaml
# 네임스페이스 전체에 적용하는 기본 Sidecar 리소스
apiVersion: networking.istio.io/v1beta1
kind: Sidecar
metadata:
  name: default
  namespace: demo
spec:
  egress:
    - hosts:
        - "./*"                            # 같은 네임스페이스
        - "istio-system/*"                 # istio-system
        # 필요한 외부 네임스페이스만 추가
```

**최적화 전후 비교 (서비스 1000개 메시 기준):**

| 항목 | 최적화 전 | 최적화 후 |
|------|----------|----------|
| 사이드카 메모리 | ~150MB | ~30MB |
| xDS 설정 크기 | ~5MB | ~500KB |
| xDS 업데이트 시간 | ~500ms | ~50ms |
| istiod CPU 사용량 | 높음 | 낮음 |

### 9.5 Wasm 플러그인

Istio 1.12+에서는 WebAssembly(Wasm) 플러그인을 사용하여 Envoy의 기능을 확장할 수 있다.

```yaml
apiVersion: extensions.istio.io/v1alpha1
kind: WasmPlugin
metadata:
  name: custom-auth
  namespace: demo
spec:
  # 적용 대상
  selector:
    matchLabels:
      app: httpbin

  # Wasm 모듈 위치
  url: oci://registry.example.com/wasm/custom-auth:v1.0
  # 또는 HTTP URL:
  # url: https://example.com/wasm/custom-auth.wasm

  # 필터 체인에서의 위치
  phase: AUTHN                             # AUTHN, AUTHZ, STATS, UNSPECIFIED

  # 플러그인 설정 (JSON)
  pluginConfig:
    auth_endpoint: "https://auth.example.com/verify"
    cache_ttl: 300

  # 이미지 풀 정책
  imagePullPolicy: IfNotPresent

  # 실패 시 동작
  failStrategy: FAIL_CLOSE                # FAIL_CLOSE, FAIL_OPEN
```

**Wasm vs EnvoyFilter 비교:**

| 특성 | WasmPlugin | EnvoyFilter |
|------|-----------|-------------|
| 안전성 | 샌드박스 격리, Envoy 크래시 위험 없음 | 잘못된 설정 시 Envoy 크래시 가능 |
| 이식성 | OCI 이미지로 배포, 버전 관리 용이 | YAML 설정, Envoy API에 강하게 결합 |
| 성능 | 약간의 오버헤드 (Wasm VM) | 네이티브 성능 |
| 사용 난이도 | 프로그래밍 필요 (Go, Rust, C++) | Envoy 설정 지식 필요 |
| 권장 | 새로운 확장 개발 | 간단한 설정 패치 |

### 9.6 성능 모니터링 체크리스트

```bash
# 1. istiod 리소스 사용량 확인
kubectl top pods -n istio-system

# 2. 사이드카 리소스 사용량 확인
kubectl top pods -n demo --containers | grep istio-proxy

# 3. xDS push 지연 확인 (istiod 메트릭)
# pilot_xds_push_time_bucket
# pilot_xds_pushes (push 횟수)
# pilot_proxy_convergence_time_bucket (설정 전파 시간)

# 4. Envoy 내부 통계 확인
kubectl exec <pod> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "cluster_manager"

# 5. 연결 풀 사용량 확인
kubectl exec <pod> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "upstream_cx_active"

# 6. 서킷 브레이커 동작 확인
kubectl exec <pod> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "upstream_rq_pending_overflow"
```

---

## 10. 트러블슈팅

### 10.1 istioctl analyze

설정 오류를 자동으로 탐지하고 개선 방법을 제안한다.

```bash
# 전체 클러스터 분석
istioctl analyze -A

# 특정 네임스페이스 분석
istioctl analyze -n demo

# 파일 적용 전 사전 분석
istioctl analyze -n demo my-virtualservice.yaml

# 분석 결과 예시:
# Warning [IST0101] (VirtualService demo/httpbin-routing)
#   Referenced host not found: "httpbin-v3"
# Info [IST0102] (Namespace demo)
#   The namespace is not enabled for Istio injection.
```

**자주 발생하는 분석 코드:**

| 코드 | 설명 |
|------|------|
| IST0101 | VirtualService에서 참조하는 호스트를 찾을 수 없다 |
| IST0102 | 네임스페이스에 istio-injection 레이블이 없다 |
| IST0104 | Gateway에서 참조하는 서버 포트가 중복된다 |
| IST0106 | Schema 유효성 검사 실패 |
| IST0108 | 알 수 없는 어노테이션이 사용되었다 |
| IST0116 | DestinationRule에서 참조하는 subset을 사용하는 VirtualService가 없다 |
| IST0131 | VirtualService가 Gateway와 연결되지 않았다 |

### 10.2 istioctl proxy-status

각 Envoy 사이드카의 xDS 동기화 상태를 확인한다.

```bash
# 전체 프록시 상태 확인
istioctl proxy-status

# 출력 예시:
# NAME                    CDS    LDS    EDS    RDS    ECDS   ISTIOD
# httpbin-v1-xxx.demo     SYNCED SYNCED SYNCED SYNCED -      istiod-xxx
# httpbin-v2-xxx.demo     SYNCED SYNCED SYNCED SYNCED -      istiod-xxx
# nginx-web-xxx.demo      SYNCED SYNCED SYNCED SYNCED -      istiod-xxx

# 상태 의미:
# SYNCED  - 최신 설정과 동기화되었다
# NOT SENT - istiod가 아직 설정을 보내지 않았다 (변경 없음)
# STALE   - 오래된 설정을 사용 중이다 (문제!)
```

### 10.3 istioctl proxy-config

각 Envoy 사이드카의 실제 설정을 확인한다.

```bash
# 리스너 설정 확인 (LDS)
istioctl proxy-config listeners <pod-name> -n demo

# 라우트 설정 확인 (RDS)
istioctl proxy-config routes <pod-name> -n demo

# 클러스터 설정 확인 (CDS)
istioctl proxy-config clusters <pod-name> -n demo

# 엔드포인트 설정 확인 (EDS)
istioctl proxy-config endpoints <pod-name> -n demo

# 시크릿(인증서) 확인 (SDS)
istioctl proxy-config secret <pod-name> -n demo

# JSON 형식으로 상세 출력
istioctl proxy-config routes <pod-name> -n demo -o json

# 특정 포트의 리스너만 필터링
istioctl proxy-config listeners <pod-name> -n demo --port 8080

# 특정 클러스터의 엔드포인트만 필터링
istioctl proxy-config endpoints <pod-name> -n demo \
  --cluster "outbound|80|v1|httpbin.demo.svc.cluster.local"

# 두 프록시 간 설정 차이 비교
istioctl proxy-config diff <pod-a> <pod-b> -n demo
```

### 10.4 Envoy Admin Interface

Envoy의 관리 인터페이스를 통해 더 상세한 디버깅이 가능하다.

```bash
# Envoy admin 대시보드 열기
istioctl dashboard envoy <pod-name> -n demo

# 또는 직접 port-forward
kubectl port-forward <pod-name> -n demo 15000:15000

# 주요 엔드포인트:
# /config_dump    - 전체 Envoy 설정 덤프
# /stats          - 모든 통계 메트릭
# /stats?format=prometheus  - Prometheus 형식 메트릭
# /clusters       - 클러스터 및 엔드포인트 상태
# /listeners      - 리스너 목록
# /server_info    - Envoy 버전, 빌드 정보
# /ready          - 준비 상태
# /logging        - 로그 레벨 확인/변경
# /certs          - 인증서 정보
```

```bash
# 특정 클러스터의 상세 상태 확인
kubectl exec <pod> -n demo -c istio-proxy -- \
  curl -s localhost:15000/clusters | grep httpbin

# 인증서 정보 확인
kubectl exec <pod> -n demo -c istio-proxy -- \
  curl -s localhost:15000/certs

# 동적 로그 레벨 변경
kubectl exec <pod> -n demo -c istio-proxy -- \
  curl -X POST localhost:15000/logging?level=debug

# 다시 info로 복원
kubectl exec <pod> -n demo -c istio-proxy -- \
  curl -X POST localhost:15000/logging?level=info
```

### 10.5 자주 발생하는 문제와 해결법

| 증상 | 원인 | 해결 방법 |
|------|------|----------|
| Pod가 1/1로 실행된다 (사이드카 미주입) | 네임스페이스에 `istio-injection` 레이블이 없다 | `kubectl label ns <ns> istio-injection=enabled` 후 Pod 재시작 |
| `proxy-status`에서 STALE 표시 | Envoy가 istiod와의 xDS 연결이 끊겼다 | istiod Pod 상태 확인, 네트워크 정책 확인 |
| 503 에러 발생 | upstream 서비스를 찾을 수 없거나, 서킷 브레이커가 동작 중이다 | `istioctl proxy-config clusters` 확인, outlierDetection 설정 검토 |
| mTLS 연결 실패 | STRICT 모드에서 비메시 서비스가 접근을 시도한다 | PeerAuthentication을 PERMISSIVE로 변경하거나, 클라이언트에 사이드카 주입 |
| VirtualService가 동작하지 않는다 | hosts 필드가 실제 서비스 이름과 불일치한다 | `istioctl analyze`로 확인, hosts와 Kubernetes Service 이름 대조 |
| 트래픽이 의도한 subset으로 가지 않는다 | DestinationRule의 subset 레이블과 Pod 레이블이 불일치한다 | `kubectl get pods --show-labels`로 Pod 레이블 확인 |
| 높은 지연 시간 | 사이드카 리소스 부족 또는 연결 풀 설정 문제이다 | Envoy 리소스 limit 확인, connectionPool 튜닝 |
| 504 Gateway Timeout | VirtualService timeout이 너무 짧거나, 업스트림이 느리다 | timeout 값 증가, 업스트림 성능 확인 |
| Pod 시작 시 CrashLoopBackOff | istio-init가 iptables 설정에 실패했다 | `NET_ADMIN` 권한 확인, istio-cni 사용 고려 |
| JWT 인증 실패 (401) | jwksUri에 접근할 수 없거나, 토큰이 만료되었다 | jwksUri 접근성 확인, 토큰 유효기간 확인 |
| AuthorizationPolicy가 동작하지 않는다 | selector가 올바른 Pod를 선택하지 못한다 | `kubectl get pods --show-labels`로 레이블 확인 |

### 10.6 디버깅 명령어 모음

```bash
# Envoy 로그 레벨 조정 (디버깅 시 유용)
istioctl proxy-config log <pod-name> -n demo --level debug

# 특정 로거만 debug 레벨로
istioctl proxy-config log <pod-name> -n demo --level rbac:debug,jwt:debug

# 기본 로그 레벨로 복원
istioctl proxy-config log <pod-name> -n demo --level info

# istiod 로그 확인
kubectl logs -n istio-system -l app=istiod -f

# Envoy 사이드카 로그 확인
kubectl logs <pod-name> -n demo -c istio-proxy -f

# istio-init 컨테이너 로그 확인 (iptables 설정 문제)
kubectl logs <pod-name> -n demo -c istio-init

# istiod의 xDS push 로그 확인
kubectl logs -n istio-system -l app=istiod | grep "Push"

# Envoy 설정 전체 덤프 (파일로 저장)
istioctl proxy-config all <pod-name> -n demo -o json > envoy-config.json

# 특정 서비스의 엔드포인트 확인
istioctl proxy-config endpoints <pod-name> -n demo \
  --cluster "outbound|80||httpbin.demo.svc.cluster.local"

# mTLS 인증서 만료 시간 확인
istioctl proxy-config secret <pod-name> -n demo -o json | \
  python3 -c "import sys,json; data=json.load(sys.stdin); \
  print(data['dynamicActiveSecrets'][0]['secret']['tlsCertificate'])"

# Envoy 통계에서 에러 관련 메트릭 확인
kubectl exec <pod> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep -E "(upstream_rq_5xx|upstream_rq_4xx|upstream_cx_connect_fail)"
```

### 10.7 트러블슈팅 체크리스트

```bash
# 1단계: 기본 상태 확인
istioctl version                           # 버전 확인
kubectl get pods -n istio-system           # Control Plane 상태
istioctl proxy-status                      # 모든 프록시 동기화 상태

# 2단계: 설정 검증
istioctl analyze -n demo                   # 설정 오류 분석
kubectl get vs,dr,gw,pa,ra,ap -n demo     # Istio 리소스 확인

# 3단계: 프록시 설정 확인
istioctl proxy-config listeners <pod> -n demo
istioctl proxy-config routes <pod> -n demo
istioctl proxy-config clusters <pod> -n demo
istioctl proxy-config endpoints <pod> -n demo

# 4단계: 로그 확인
kubectl logs <pod> -n demo -c istio-proxy --tail=100
kubectl logs -n istio-system -l app=istiod --tail=100

# 5단계: 통신 테스트
kubectl exec <pod> -n demo -c istio-proxy -- \
  curl -v http://httpbin.demo.svc.cluster.local/get
```

---

## 11. Ambient Mesh

### 11.1 Ambient Mesh 개요

Istio 1.18+에서 도입된 Ambient Mesh는 사이드카 없이 서비스 메시 기능을 제공하는 새로운 데이터 플레인 모드이다.

**기존 Sidecar 모드의 한계:**
- 각 Pod마다 Envoy 사이드카가 추가되어 메모리/CPU 오버헤드가 발생한다
- 사이드카 주입을 위해 Pod 재시작이 필요하다
- Envoy 업그레이드 시 모든 Pod를 재시작해야 한다

### 11.2 아키텍처

```
┌─────────────────────────────────────────────────────┐
│                  Ambient Mesh                        │
│                                                      │
│  L4 처리 (보안)              L7 처리 (트래픽 관리)     │
│  ┌──────────────┐          ┌───────────────────┐     │
│  │   ztunnel    │          │ Waypoint Proxy    │     │
│  │ (per-node)   │────────►│ (per-namespace/    │     │
│  │ - mTLS 터널링 │          │  service account) │     │
│  │ - L4 인가     │          │ - L7 라우팅        │     │
│  │ - 텔레메트리  │          │ - L7 인가          │     │
│  └──────────────┘          │ - Fault injection  │     │
│                            └───────────────────┘     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Pod A    │  │ Pod B    │  │ Pod C    │           │
│  │ (앱만)    │  │ (앱만)    │  │ (앱만)    │           │
│  │ 사이드카  │  │ 사이드카  │  │ 사이드카  │           │
│  │ 없음     │  │ 없음     │  │ 없음     │           │
│  └──────────┘  └──────────┘  └──────────┘           │
└─────────────────────────────────────────────────────┘
```

### 11.3 ztunnel (Zero Trust Tunnel)

ztunnel은 Ambient Mesh의 핵심 구성 요소이다. 각 노드에 DaemonSet으로 배포된다.

**ztunnel의 특성:**

| 특성 | 설명 |
|------|------|
| 구현 언어 | Rust (경량, 고성능) |
| 배포 방식 | DaemonSet (노드당 1개) |
| 기능 수준 | L4 (TCP 레벨) |
| mTLS | HBONE (HTTP-Based Overlay Network Encapsulation) 프로토콜 사용 |
| 인가 | L4 AuthorizationPolicy (소스 ID, 대상 포트 기반) |
| 텔레메트리 | TCP 메트릭 (바이트, 연결 수) |
| 메모리 | ~20MB (Envoy 대비 매우 적음) |

**HBONE 프로토콜:**

```
일반 mTLS (Sidecar 모드):
  App → Envoy → [mTLS over TCP] → Envoy → App

HBONE (Ambient 모드):
  App → ztunnel → [mTLS over HTTP/2 CONNECT] → ztunnel → App

HBONE의 장점:
  - HTTP/2 멀티플렉싱으로 연결 수 감소
  - 기존 HTTP 인프라(로드밸런서 등)와 호환
  - 메타데이터를 HTTP 헤더로 전달 가능
```

**ztunnel 동작 흐름:**

```
┌──────┐    ┌──────────┐    ┌──────────┐    ┌──────┐
│App A │───►│ztunnel   │───►│ztunnel   │───►│App B │
│      │    │(노드 1)   │    │(노드 2)   │    │      │
└──────┘    └──────────┘    └──────────┘    └──────┘
              │                │
              │  HBONE 터널    │
              │  (mTLS +       │
              │   HTTP/2       │
              │   CONNECT)     │
              │                │
              └───────────────┘

1. App A가 App B로 TCP 연결을 시도한다
2. ztunnel(노드 1)이 패킷을 가로챈다
3. App A의 SPIFFE ID를 확인한다
4. L4 AuthorizationPolicy를 평가한다
5. HBONE 터널을 통해 ztunnel(노드 2)로 전달한다
6. ztunnel(노드 2)가 App B로 전달한다
```

### 11.4 Waypoint Proxy

Waypoint Proxy는 L7 기능이 필요한 경우에만 배포하는 선택적 컴포넌트이다.

**Waypoint Proxy가 필요한 경우:**

| L4 기능 (ztunnel만으로 충분) | L7 기능 (Waypoint 필요) |
|---------------------------|----------------------|
| mTLS 암호화 | HTTP 라우팅 (VirtualService) |
| L4 인가 (소스 IP, 포트) | L7 인가 (경로, 헤더, JWT) |
| TCP 메트릭 | HTTP 메트릭 |
| 연결 기반 텔레메트리 | 분산 트레이싱 |
| | Fault injection |
| | Rate limiting |
| | Traffic mirroring |

**Waypoint Proxy 배포:**

```bash
# 네임스페이스에 Waypoint Proxy 배포
istioctl waypoint apply -n demo --enroll-namespace

# 특정 서비스 어카운트에만 Waypoint 배포
istioctl waypoint apply -n demo --service-account httpbin

# Waypoint 상태 확인
istioctl waypoint list -n demo

# Waypoint 제거
istioctl waypoint delete -n demo
```

```yaml
# Waypoint Proxy를 Kubernetes Gateway API로 직접 생성
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: waypoint
  namespace: demo
  labels:
    istio.io/waypoint-for: service       # service, workload, all
spec:
  gatewayClassName: istio-waypoint
  listeners:
    - name: mesh
      protocol: HBONE
      port: 15008
```

### 11.5 Ambient Mesh 활성화

```bash
# 1. Istio를 ambient 프로파일로 설치
istioctl install --set profile=ambient

# 2. 네임스페이스를 ambient 모드로 전환
kubectl label namespace demo istio.io/dataplane-mode=ambient

# 3. (선택) Waypoint Proxy 배포 (L7 기능이 필요한 경우)
istioctl waypoint apply -n demo --enroll-namespace

# 4. 확인
kubectl get pods -n demo                   # 사이드카 없이 1/1 확인
kubectl get pods -n istio-system           # ztunnel DaemonSet 확인
```

**Sidecar 모드에서 Ambient 모드로 마이그레이션:**

```bash
# 1. 네임스페이스 레이블 변경
kubectl label namespace demo istio-injection-       # 사이드카 주입 제거
kubectl label namespace demo istio.io/dataplane-mode=ambient

# 2. Pod 재시작 (사이드카 제거)
kubectl rollout restart deployment -n demo

# 3. 확인 (1/1로 실행, 사이드카 없음)
kubectl get pods -n demo

# 4. L7 기능이 필요하면 Waypoint 배포
istioctl waypoint apply -n demo --enroll-namespace
```

### 11.6 Sidecar vs Ambient 선택 가이드

```
시작
  │
  ├── 리소스 효율성이 최우선인가?
  │     │
  │     └── 예 ──► Ambient 모드 고려
  │
  ├── 모든 서비스에 L7 기능이 필요한가?
  │     │
  │     └── 예 ──► Sidecar 모드 (또는 Ambient + Waypoint)
  │
  ├── Pod 라이프사이클에 영향을 주면 안 되는가?
  │     │
  │     └── 예 ──► Ambient 모드
  │
  ├── 프로덕션 환경에서 검증된 솔루션이 필요한가?
  │     │
  │     └── 예 ──► Sidecar 모드 (더 오래 검증됨)
  │
  └── L4 보안(mTLS)만 필요하고 L7은 일부만?
        │
        └── 예 ──► Ambient 모드 (ztunnel + 선택적 Waypoint)
```

---

## 12. 실전 시나리오

### 12.1 시나리오 1: 카나리 배포 Walkthrough

tart-infra 프로젝트의 httpbin 서비스를 사용한 카나리 배포 실습이다.

```bash
# 전제 조건: dev 클러스터에 Istio가 설치되어 있다
export KUBECONFIG=kubeconfig/dev.yaml

# Step 1: 현재 상태 확인
kubectl get pods -n demo -l app=httpbin --show-labels
# httpbin-xxx (version=v1) - 기존 버전
# httpbin-v2-xxx (version=v2) - 카나리 버전

# Step 2: DestinationRule 적용 (subset 정의)
kubectl apply -f manifests/istio/destination-rule.yaml
# httpbin-destination: v1(version=v1), v2(version=v2)

# Step 3: VirtualService 적용 (트래픽 분할)
kubectl apply -f manifests/istio/virtual-service.yaml
# 80% → v1, 20% → v2
# x-canary: true 헤더 → 100% v2

# Step 4: 트래픽 분할 확인
for i in $(seq 1 20); do
  kubectl -n demo exec deploy/nginx-web -c nginx -- \
    curl -s http://httpbin/headers 2>/dev/null | grep -o '"Host": "[^"]*"'
done
# 약 80%가 v1, 20%가 v2로 라우팅되는 것을 확인

# Step 5: 헤더 기반 라우팅 확인
kubectl -n demo exec deploy/nginx-web -c nginx -- \
  curl -s -H "x-canary: true" http://httpbin/headers
# 항상 v2로 라우팅

# Step 6: 카나리 비율 조정 (검증 완료 후)
# virtual-service.yaml에서 weight를 v1=50, v2=50으로 변경
# 최종적으로 v1=0, v2=100으로 변경하여 전환 완료

# Step 7: 메트릭으로 검증
# Kiali 또는 Grafana에서 v2의 에러율, 지연시간 확인
istioctl dashboard kiali
```

### 12.2 시나리오 2: Zero-Trust Network 구축

모든 서비스 간 통신을 인증/인가하는 Zero-Trust 네트워크를 구축한다.

```bash
# Step 1: STRICT mTLS 적용 (이미 프로젝트에 포함)
kubectl apply -f manifests/istio/peer-authentication.yaml
# demo-strict-mtls: mode: STRICT

# Step 2: 기본 거부 정책 (모든 트래픽 차단)
kubectl apply -f - <<EOF
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: deny-all
  namespace: demo
spec:
  {}
EOF

# Step 3: 필요한 통신만 허용
# nginx-web → httpbin 허용
kubectl apply -f - <<EOF
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: allow-nginx-to-httpbin
  namespace: demo
spec:
  selector:
    matchLabels:
      app: httpbin
  action: ALLOW
  rules:
    - from:
        - source:
            principals:
              - "cluster.local/ns/demo/sa/default"
      to:
        - operation:
            methods: ["GET", "POST"]
            paths: ["/get", "/post", "/headers", "/status/*"]
EOF

# nginx-web → redis 허용
kubectl apply -f - <<EOF
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: allow-nginx-to-redis
  namespace: demo
spec:
  selector:
    matchLabels:
      app: redis
  action: ALLOW
  rules:
    - from:
        - source:
            principals:
              - "cluster.local/ns/demo/sa/default"
      to:
        - operation:
            ports: ["6379"]
EOF

# Step 4: 검증
# 허용된 통신 확인
kubectl -n demo exec deploy/nginx-web -c nginx -- \
  curl -s http://httpbin/get
# 200 OK

# 차단된 통신 확인 (다른 서비스에서 redis 접근 시도)
kubectl -n demo exec deploy/httpbin -c httpbin -- \
  curl -s http://redis:6379
# 403 RBAC: access denied
```

### 12.3 시나리오 3: Rate Limiting with httpbin

httpbin 서비스에 Rate Limiting을 적용하여 과도한 요청을 제한한다.

```yaml
# httpbin에 Local Rate Limiting 적용
# 분당 100개 요청으로 제한
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: httpbin-rate-limit
  namespace: demo
spec:
  workloadSelector:
    labels:
      app: httpbin
  configPatches:
    - applyTo: HTTP_FILTER
      match:
        context: SIDECAR_INBOUND
        listener:
          filterChain:
            filter:
              name: envoy.filters.network.http_connection_manager
              subFilter:
                name: envoy.filters.http.router
      patch:
        operation: INSERT_BEFORE
        value:
          name: envoy.filters.http.local_ratelimit
          typed_config:
            "@type": type.googleapis.com/udpa.type.v1.TypedStruct
            type_url: type.googleapis.com/envoy.extensions.filters.http.local_ratelimit.v3.LocalRateLimit
            value:
              stat_prefix: http_local_rate_limiter
              token_bucket:
                max_tokens: 100
                tokens_per_fill: 100
                fill_interval: 60s
              filter_enabled:
                runtime_key: local_rate_limit_enabled
                default_value:
                  numerator: 100
                  denominator: HUNDRED
              filter_enforced:
                runtime_key: local_rate_limit_enforced
                default_value:
                  numerator: 100
                  denominator: HUNDRED
              response_headers_to_add:
                - append_action: OVERWRITE_IF_EXISTS_OR_ADD
                  header:
                    key: x-rate-limited
                    value: "true"
              status:
                code: TooManyRequests
```

```bash
# Rate Limiting 테스트
for i in $(seq 1 150); do
  STATUS=$(kubectl -n demo exec deploy/nginx-web -c nginx -- \
    curl -s -o /dev/null -w "%{http_code}" http://httpbin/get)
  echo "Request $i: $STATUS"
done
# 100번째 이후 요청은 429 Too Many Requests 반환
```

### 12.4 시나리오 4: 서킷 브레이커 테스트

tart-infra 프로젝트의 서킷 브레이커 설정을 테스트한다.

```bash
# 프로젝트의 서킷 브레이커 설정 확인
# consecutive5xxErrors: 3, interval: 30s, baseEjectionTime: 30s
kubectl get dr httpbin-destination -n demo -o yaml

# Step 1: httpbin에 fault injection으로 5xx 에러를 주입한다
kubectl apply -f - <<EOF
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: httpbin-fault-test
  namespace: demo
spec:
  hosts:
    - httpbin
  http:
    - fault:
        abort:
          percentage:
            value: 100.0
          httpStatus: 503
      route:
        - destination:
            host: httpbin
            subset: v2
    - route:
        - destination:
            host: httpbin
            subset: v1
EOF

# Step 2: v2로의 트래픽이 모두 503을 반환하면
# 서킷 브레이커가 v2 엔드포인트를 제외한다

# Step 3: 서킷 브레이커 동작 확인
kubectl exec <pod> -n demo -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "outlier_detection"
# outlier_detection.ejections_active: 1  ← v2가 제외되었다

# Step 4: fault injection 제거 후 복구 확인
kubectl delete vs httpbin-fault-test -n demo
# 30초(baseEjectionTime) 후 v2가 다시 포함된다
```

### 12.5 시나리오 5: Keycloak JWT 연동

tart-infra의 keycloak 서비스와 Istio RequestAuthentication을 연동한다.

```yaml
# Keycloak JWT 검증
apiVersion: security.istio.io/v1beta1
kind: RequestAuthentication
metadata:
  name: keycloak-jwt
  namespace: demo
spec:
  selector:
    matchLabels:
      app: httpbin
  jwtRules:
    - issuer: "http://keycloak.demo.svc.cluster.local:8080/realms/demo"
      jwksUri: "http://keycloak.demo.svc.cluster.local:8080/realms/demo/protocol/openid-connect/certs"
      forwardOriginalToken: true
---
# JWT 필수화
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: require-jwt
  namespace: demo
spec:
  selector:
    matchLabels:
      app: httpbin
  action: DENY
  rules:
    - from:
        - source:
            notRequestPrincipals: ["*"]
      to:
        - operation:
            paths: ["/admin/*"]
```

```bash
# Step 1: Keycloak에서 JWT 토큰 발급
TOKEN=$(kubectl -n demo exec deploy/nginx-web -c nginx -- \
  curl -s -X POST \
  http://keycloak:8080/realms/demo/protocol/openid-connect/token \
  -d "grant_type=client_credentials" \
  -d "client_id=demo-app" \
  -d "client_secret=secret" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Step 2: JWT 없이 요청 → /admin/* 경로는 거부
kubectl -n demo exec deploy/nginx-web -c nginx -- \
  curl -s http://httpbin/admin/config
# 403 RBAC: access denied

# Step 3: JWT 포함하여 요청 → 허용
kubectl -n demo exec deploy/nginx-web -c nginx -- \
  curl -s -H "Authorization: Bearer $TOKEN" http://httpbin/admin/config
# 200 OK
```

### 12.6 시나리오 6: 트래픽 미러링을 활용한 신규 버전 검증

```bash
# Step 1: v1으로 모든 트래픽을 보내면서 v2로 미러링
kubectl apply -f - <<EOF
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: httpbin-mirror-test
  namespace: demo
spec:
  hosts:
    - httpbin
  http:
    - route:
        - destination:
            host: httpbin
            subset: v1
      mirror:
        host: httpbin
        subset: v2
      mirrorPercentage:
        value: 100.0
EOF

# Step 2: 요청을 보내면 v1에서 응답을 받고, v2에도 동일 요청이 전달된다
kubectl -n demo exec deploy/nginx-web -c nginx -- \
  curl -s http://httpbin/get

# Step 3: v2의 로그에서 미러링된 요청 확인
kubectl logs deploy/httpbin-v2 -n demo -c httpbin --tail=10
# Host 헤더에 "-shadow" 접미사가 붙어있다

# Step 4: v2의 에러율과 지연시간을 Kiali/Grafana에서 확인
# 문제가 없으면 카나리 배포로 전환
```

---

