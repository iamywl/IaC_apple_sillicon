# 04. 네트워킹 - Cilium, Hubble, Istio, 네트워크 정책

## Cilium eBPF CNI

### Cilium이란?

Kubernetes의 네트워킹 플러그인(CNI)으로, 기존의 iptables 대신 eBPF(extended Berkeley Packet Filter)를 사용합니다.
커널 레벨에서 동작하므로 더 빠르고, L7(HTTP) 레벨까지 필터링할 수 있습니다.

### 설정 파일: manifests/cilium-values.yaml

```yaml
kubeProxyReplacement: true    # kube-proxy 완전 대체 (iptables 규칙 없음)
ipam:
  mode: cluster-pool           # 클러스터별 Pod IP 풀 관리
operator:
  replicas: 1                  # 단일 오퍼레이터 (Mac 리소스 절약)
```

### kube-proxy를 대체하는 이유

기존 kube-proxy는 iptables 규칙으로 Service → Pod 라우팅을 합니다.
Pod 수가 많아지면 iptables 규칙이 수천 개로 늘어나 성능이 저하됩니다.
Cilium은 eBPF 맵으로 이를 대체하여 O(1) 조회가 가능합니다.

### 코드에서 Cilium 설치 위치

```
scripts/install/06-install-cilium.sh  ← Helm으로 설치
scripts/lib/k8s.sh                    ← install_cilium(), install_hubble() 함수
manifests/cilium-values.yaml          ← 설정값
manifests/hubble-values.yaml          ← Hubble 관측성 설정
```

## Hubble 네트워크 관측성

### Hubble이란?

Cilium에 내장된 네트워크 관측 도구입니다.
모든 Pod 간 통신을 eBPF로 캡처하여 실시간으로 볼 수 있습니다.

### 캡처하는 정보

| 필드 | 설명 | 예시 |
|------|------|------|
| source | 출발지 Pod/Service | `demo/nginx-web-xxx` |
| destination | 목적지 Pod/Service | `demo/httpbin-xxx` |
| protocol | L4/L7 프로토콜 | `TCP`, `HTTP`, `DNS` |
| verdict | 허용/차단 | `FORWARDED`, `DROPPED` |
| port | 대상 포트 | `80`, `53` |

### 대시보드 연동

대시보드의 Traffic 페이지가 Hubble 데이터를 시각화합니다.

```
dashboard/server/collectors/hubble.ts
  │
  ├── hubble observe --output json --last 200  (kubectl exec으로 cilium 에이전트 안에서 실행)
  │
  └── 파싱 → 엣지 집계 (source→dest 쌍별 카운트)
       │
       └── /api/traffic 엔드포인트로 프론트엔드에 제공
            │
            └── TrafficPage.tsx에서 SVG 토폴로지로 렌더링
                (초록선 = FORWARDED, 빨간선 = DROPPED)
```

## Zero-Trust 네트워크 정책

### 개념

"기본적으로 모든 트래픽을 차단하고, 필요한 것만 명시적으로 허용한다."

### 정책 파일들 (manifests/network-policies/)

#### 1. default-deny.yaml - 모든 트래픽 차단

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: default-deny
spec:
  endpointSelector: {}    # 모든 Pod에 적용
  ingress: []              # 인바운드 전부 차단
  egress:
    - toEndpoints:
        - matchLabels:
            k8s-app: kube-dns   # DNS만 허용 (없으면 아무것도 못 함)
      toPorts:
        - ports:
            - port: "53"
```

#### 2. allow-external-to-nginx.yaml - 외부 → nginx 허용

```yaml
spec:
  endpointSelector:
    matchLabels:
      app: nginx-web        # nginx Pod만 대상
  ingress:
    - {}                     # 모든 소스에서 인바운드 허용
```

#### 3. allow-nginx-to-httpbin.yaml - L7 필터링 (GET만 허용)

```yaml
spec:
  endpointSelector:
    matchLabels:
      app: httpbin           # httpbin Pod 대상
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: nginx-web   # nginx에서 온 트래픽만
      toPorts:
        - ports:
            - port: "80"
          rules:
            http:
              - method: "GET"  # ← GET 요청만 허용, POST/DELETE는 차단
```

#### 4. allow-nginx-to-redis.yaml - nginx → redis 캐시 허용

```yaml
spec:
  endpointSelector:
    matchLabels:
      app: redis
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: nginx-web
      toPorts:
        - ports:
            - port: "6379"
```

#### 5. allow-nginx-egress.yaml - nginx 아웃바운드 트래픽 제한

```yaml
# nginx Pod에서 나가는 트래픽을 명시적으로 제한
spec:
  endpointSelector:
    matchLabels:
      app: nginx-web          # nginx Pod의 egress 제어
  egress:
    - toEndpoints:
        - matchLabels:
            app: httpbin       # httpbin으로만 GET 허용
      toPorts:
        - ports:
            - port: "80"
          rules:
            http:
              - method: "GET"
    - toEndpoints:
        - matchLabels:
            app: redis         # redis:6379만 허용
      toPorts:
        - ports:
            - port: "6379"
    - toEndpoints:
        - matchLabels:
            k8s-app: kube-dns  # DNS 조회만 허용
      toPorts:
        - ports:
            - port: "53"
```

> default-deny가 ingress만 차단한다면, 이 정책은 **egress(아웃바운드)**까지 제어합니다.
> nginx가 접근할 수 있는 대상을 httpbin, redis, DNS로 명시적으로 제한합니다.

#### 6. allow-istio-sidecars.yaml - Istio 사이드카 포트 허용

```yaml
# Envoy 프록시가 사용하는 포트들을 허용
toPorts:
  - ports:
      - port: "15000"   # Envoy admin
      - port: "15006"   # Envoy inbound
```

### 전체 정책 요약 (6개)

| 번호 | 파일 | 유형 | 핵심 |
|------|------|------|------|
| 1 | `default-deny.yaml` | Ingress 차단 | 모든 인바운드 기본 차단 |
| 2 | `allow-external-to-nginx.yaml` | Ingress 허용 | 외부 → nginx |
| 3 | `allow-nginx-to-httpbin.yaml` | Ingress + L7 | nginx → httpbin (GET만) |
| 4 | `allow-nginx-to-redis.yaml` | Ingress | nginx → redis:6379 |
| 5 | `allow-nginx-egress.yaml` | Egress | nginx 아웃바운드 제한 |
| 6 | `allow-istio-sidecars.yaml` | Ingress | Envoy 포트 허용 |

### 트래픽 흐름 요약

```
외부 → nginx (30080 NodePort)           ← allow-external-to-nginx
         │
         ├─ GET /api → httpbin (허용)    ← allow-nginx-to-httpbin (L7)
         ├─ POST /api → httpbin (차단!)  ← L7 정책: GET만 허용
         ├─ → redis:6379 (허용)          ← allow-nginx-to-redis
         ├─ → DNS:53 (허용)              ← allow-nginx-egress
         └─ → 기타 (차단!)              ← default-deny + egress 제한
```

## Istio 서비스 메시 (dev 클러스터만)

### Istio란?

Pod 옆에 Envoy 프록시 사이드카를 자동 주입하여,
모든 Pod 간 통신을 프록시가 중계하게 만드는 서비스 메시입니다.

### 설치 위치

```
scripts/install/12-install-istio.sh   ← 설치 스크립트
manifests/istio/                      ← Istio 리소스 정의
  ├── istio-values.yaml               ← Helm values
  ├── peer-authentication.yaml        ← mTLS 설정
  ├── virtual-service.yaml            ← 트래픽 라우팅
  ├── destination-rule.yaml           ← 서킷 브레이커
  ├── httpbin-v2.yaml                 ← v2 배포
  └── istio-gateway.yaml              ← 인그레스 게이트웨이
```

### mTLS (상호 TLS)

```yaml
# manifests/istio/peer-authentication.yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
spec:
  mtls:
    mode: STRICT   # 메시 내 모든 통신을 TLS로 암호화
```

Pod 간 통신이 자동으로 암호화됩니다.
인증서 발급/갱신도 Istio가 자동으로 처리합니다.

### 카나리 배포 (80/20 트래픽 분할)

```yaml
# manifests/istio/virtual-service.yaml
spec:
  hosts:
    - httpbin
  http:
    - route:
        - destination:
            host: httpbin
            subset: v1
          weight: 80        # 80% → v1 (기존 버전)
        - destination:
            host: httpbin
            subset: v2
          weight: 20        # 20% → v2 (새 버전)
```

```yaml
# manifests/istio/destination-rule.yaml
spec:
  host: httpbin
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
```

**활용 방법**: weight 값을 조절하여 새 버전의 트래픽 비율을 점진적으로 늘릴 수 있습니다.

### 서킷 브레이커

```yaml
# manifests/istio/destination-rule.yaml 내
trafficPolicy:
  outlierDetection:
    consecutive5xxErrors: 3     # 5xx 에러 3번 연속 시
    interval: 30s               # 30초마다 검사
    baseEjectionTime: 30s       # 장애 Pod를 30초간 격리
    maxEjectionPercent: 50      # 최대 50%까지 격리 가능
```

특정 Pod가 계속 에러를 반환하면 자동으로 트래픽에서 제외합니다.

## 네트워킹 수정 가이드

| 하고 싶은 것 | 수정할 파일 |
|-------------|-----------|
| Pod CIDR 변경 | `config/clusters.json`의 pod_cidr |
| 새 네트워크 정책 추가 | `manifests/network-policies/`에 YAML 추가 |
| L7 필터링 규칙 변경 | 해당 네트워크 정책의 `rules.http` 섹션 |
| 카나리 배포 비율 변경 | `manifests/istio/virtual-service.yaml`의 weight |
| 서킷 브레이커 설정 변경 | `manifests/istio/destination-rule.yaml`의 outlierDetection |
| Hubble 수집량 변경 | `dashboard/server/collectors/hubble.ts`의 `--last 200` |
