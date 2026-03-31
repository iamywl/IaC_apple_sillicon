# Day 2: 트래픽 관리 심화

> 이 문서에서는 VirtualService, DestinationRule, Gateway, ServiceEntry, Sidecar 리소스의 상세 스펙과 동작 원리, 로드밸런싱 알고리즘, Connection Pool, Outlier Detection, Circuit Breaker, 재시도/타임아웃 설정을 다룬다.

---

## 3. 트래픽 관리 심화

### 3.1 VirtualService 완전 해부

VirtualService는 Envoy의 라우팅 규칙을 추상화한 것이다. Istio에서 가장 자주 사용하는 리소스 중 하나이다.

**전체 필드 구조:**

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: httpbin-routing
  namespace: demo
spec:
  # 이 규칙이 적용될 호스트 목록이다
  # Kubernetes 서비스 이름, FQDN, 또는 와일드카드를 사용한다
  hosts:
    - httpbin                              # short name (같은 네임스페이스)
    - httpbin.demo.svc.cluster.local       # FQDN
    - "*.example.com"                      # 와일드카드

  # Gateway를 통해 들어오는 트래픽에만 적용할 때 지정한다
  # 생략하면 메시 내부 트래픽에만 적용된다
  gateways:
    - demo-gateway                         # Gateway 리소스 이름
    - mesh                                 # 메시 내부 트래픽 (기본값)

  # HTTP 라우팅 규칙 (순서대로 평가, 첫 번째 매치가 적용)
  http:
    - name: "canary-header-route"          # 규칙 이름 (디버깅용)

      # 매칭 조건 (여러 조건은 OR로 평가)
      match:
        - headers:                         # 헤더 매칭
            x-canary:
              exact: "true"                # exact, prefix, regex 지원
          uri:                             # URI 매칭
            prefix: "/api/v2"
          method:                          # HTTP 메서드 매칭
            exact: "GET"
          queryParams:                     # 쿼리 파라미터 매칭
            version:
              exact: "2"
          sourceLabels:                    # 소스 워크로드 레이블 매칭
            app: nginx-web
          port: 80                         # 포트 매칭
          ignoreUriCase: true              # URI 대소문자 무시

      # 라우팅 대상
      route:
        - destination:
            host: httpbin
            subset: v2                     # DestinationRule의 subset
            port:
              number: 80
          weight: 100                      # 트래픽 비율 (%)
          headers:                         # 응답 헤더 조작
            response:
              add:
                x-served-by: "v2"
              remove:
                - x-internal-header

      # 타임아웃 설정
      timeout: 10s

      # 재시도 정책
      retries:
        attempts: 3                        # 최대 재시도 횟수
        perTryTimeout: 2s                  # 각 시도당 타임아웃
        retryOn: "5xx,reset,connect-failure,retriable-4xx"
        retryRemoteLocalities: true        # 다른 지역(locality)으로 재시도

      # Fault Injection (테스트용)
      fault:
        delay:
          percentage:
            value: 5.0                     # 5%의 요청에 지연 주입
          fixedDelay: 3s
        abort:
          percentage:
            value: 1.0                     # 1%의 요청에 에러 주입
          httpStatus: 503

      # 트래픽 미러링
      mirror:
        host: httpbin
        subset: v2
      mirrorPercentage:
        value: 50.0                        # 50% 미러링

      # CORS 정책
      corsPolicy:
        allowOrigins:
          - exact: "https://app.example.com"
        allowMethods:
          - GET
          - POST
        allowHeaders:
          - Authorization
          - Content-Type
        exposeHeaders:
          - X-Custom-Header
        maxAge: "24h"
        allowCredentials: true

      # 헤더 조작
      headers:
        request:
          add:
            x-forwarded-for: "%DOWNSTREAM_REMOTE_ADDRESS%"
          set:
            x-request-start: "%START_TIME%"
          remove:
            - x-debug

    # 기본 라우팅 (매치 조건 없음 = 모든 요청)
    - route:
        - destination:
            host: httpbin
            subset: v1
          weight: 80
        - destination:
            host: httpbin
            subset: v2
          weight: 20

  # TCP 라우팅 규칙 (HTTP가 아닌 TCP 트래픽)
  tcp:
    - match:
        - port: 5432                       # PostgreSQL 포트
      route:
        - destination:
            host: postgres
            port:
              number: 5432

  # TLS 라우팅 규칙 (TLS를 종료하지 않고 SNI로 라우팅)
  tls:
    - match:
        - sniHosts:
            - "secure.example.com"
          port: 443
      route:
        - destination:
            host: httpbin
            port:
              number: 443
```

**VirtualService 적용 범위:**

| `gateways` 필드 | 적용 범위 |
|-----------------|----------|
| 생략 | 메시 내부 트래픽에만 적용된다 (기본값은 `mesh`) |
| `[demo-gateway]` | 지정한 Gateway를 통해 들어오는 트래픽에만 적용된다 |
| `[mesh, demo-gateway]` | 메시 내부와 Gateway 트래픽 모두에 적용된다 |

**매칭 조건 (match) 연산자:**

| 연산자 | 설명 | 예제 |
|--------|------|------|
| `exact` | 정확히 일치한다 | `exact: "/api/v1"` |
| `prefix` | 접두사가 일치한다 | `prefix: "/api"` |
| `regex` | 정규표현식에 일치한다 | `regex: "/api/v[0-9]+"` |

### 3.2 DestinationRule 완전 해부

DestinationRule은 VirtualService에서 라우팅된 트래픽이 도착할 때 적용되는 정책을 정의한다.

**전체 필드 구조:**

```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: httpbin-destination
  namespace: demo
spec:
  # 정책이 적용될 서비스 호스트이다
  host: httpbin  # 또는 httpbin.demo.svc.cluster.local

  # 전체 서비스에 적용되는 트래픽 정책
  trafficPolicy:

    # 로드밸런싱 설정
    loadBalancer:
      simple: LEAST_REQUEST                # ROUND_ROBIN, LEAST_REQUEST,
                                           # RANDOM, PASSTHROUGH
      # 또는 일관된 해시 기반 로드밸런싱 (sticky sessions)
      # consistentHash:
      #   httpHeaderName: x-user-id        # 헤더 기반
      #   httpCookie:                      # 쿠키 기반
      #     name: session-id
      #     ttl: 0s
      #   useSourceIp: true                # 소스 IP 기반
      #   httpQueryParameterName: user     # 쿼리 파라미터 기반
      #   minimumRingSize: 1024            # 링 해시 최소 크기

    # 연결 풀 설정
    connectionPool:
      tcp:
        maxConnections: 100                # 최대 TCP 연결 수
        connectTimeout: 30ms               # TCP 연결 타임아웃
        tcpKeepalive:                      # TCP keepalive 설정
          probes: 3
          time: 7200s
          interval: 75s
      http:
        h2UpgradePolicy: DO_NOT_UPGRADE    # HTTP/2 업그레이드 정책
                                           # DEFAULT, DO_NOT_UPGRADE, UPGRADE
        http1MaxPendingRequests: 100       # HTTP/1.1 최대 대기 요청 수
        http2MaxRequests: 1000             # HTTP/2 최대 동시 요청 수
        maxRequestsPerConnection: 10       # 연결당 최대 요청 수
        maxRetries: 3                      # 최대 재시도 횟수
        idleTimeout: 300s                  # 유휴 연결 타임아웃

    # Outlier Detection (서킷 브레이커)
    outlierDetection:
      consecutive5xxErrors: 3              # 연속 5xx 에러 N회 시 제외
      consecutiveGatewayErrors: 3          # 연속 게이트웨이 에러 N회 시 제외
      interval: 30s                        # 분석 주기
      baseEjectionTime: 30s               # 제외 기본 시간
      maxEjectionPercent: 50              # 최대 제외 비율 (%)
      minHealthPercent: 30                 # 최소 건강 비율 (%) - 이 이하면 패닉 모드
      splitExternalLocalOriginErrors: false # 로컬/외부 에러 분리 여부

    # 업스트림 TLS 설정
    tls:
      mode: ISTIO_MUTUAL                   # DISABLE, SIMPLE, MUTUAL,
                                           # ISTIO_MUTUAL
      # SIMPLE/MUTUAL 모드일 때:
      # clientCertificate: /etc/certs/cert.pem
      # privateKey: /etc/certs/key.pem
      # caCertificates: /etc/certs/ca.pem
      # sni: httpbin.example.com

    # 포트별 트래픽 정책 (전체 정책을 특정 포트에서 오버라이드)
    portLevelSettings:
      - port:
          number: 80
        loadBalancer:
          simple: ROUND_ROBIN
        connectionPool:
          http:
            http1MaxPendingRequests: 50
        outlierDetection:
          consecutive5xxErrors: 5

  # Subsets: 레이블 기반으로 서비스를 하위 집합으로 분류
  subsets:
    - name: v1
      labels:
        version: v1
      # subset별 트래픽 정책 오버라이드
      trafficPolicy:
        loadBalancer:
          simple: ROUND_ROBIN

    - name: v2
      labels:
        version: v2
      trafficPolicy:
        loadBalancer:
          simple: LEAST_REQUEST

  # 워크로드 선택기 (특정 워크로드에만 적용)
  # exportTo:
  #   - "."                                # 같은 네임스페이스에서만 보임
  #   - "*"                                # 모든 네임스페이스에서 보임
```

**로드밸런싱 알고리즘 비교:**

| 알고리즘 | 설명 | 사용 시나리오 |
|---------|------|-------------|
| ROUND_ROBIN | 순차적으로 분배한다 | 균등한 트래픽 분배가 필요할 때 (기본값) |
| LEAST_REQUEST | 가장 적은 활성 요청을 가진 엔드포인트로 보낸다 | 요청 처리 시간이 다양할 때 |
| RANDOM | 무작위로 선택한다 | 간단하고 균등한 분배가 필요할 때 |
| PASSTHROUGH | 로드밸런싱을 하지 않는다. 원래 목적지로 전달한다 | 이미 로드밸런서가 있을 때 |
| Consistent Hash | 해시 키 기반으로 같은 엔드포인트로 보낸다 | Sticky session, 캐시 최적화 |

### 3.3 Gateway 완전 해부

Gateway는 메시의 진입점(Ingress) 또는 출구(Egress)를 정의한다. Kubernetes Ingress보다 더 세밀한 제어가 가능하다.

**전체 필드 구조:**

```yaml
apiVersion: networking.istio.io/v1beta1
kind: Gateway
metadata:
  name: demo-gateway
  namespace: demo
spec:
  # Gateway가 배포될 프록시를 선택한다
  selector:
    istio: ingressgateway               # istio-ingressgateway Pod를 선택

  servers:
    # HTTPS 서버
    - port:
        number: 443
        name: https
        protocol: HTTPS                  # HTTP, HTTPS, GRPC, HTTP2,
                                         # MONGO, TCP, TLS
      tls:
        mode: SIMPLE                     # PASSTHROUGH, SIMPLE, MUTUAL,
                                         # AUTO_PASSTHROUGH, ISTIO_MUTUAL
        credentialName: my-tls-secret    # Kubernetes Secret (cert + key)
        # MUTUAL 모드 시 추가:
        # caCertificates: /etc/certs/ca.pem
        minProtocolVersion: TLSV1_2      # 최소 TLS 버전
        maxProtocolVersion: TLSV1_3      # 최대 TLS 버전
        cipherSuites:                    # 허용할 암호 스위트
          - ECDHE-RSA-AES256-GCM-SHA384
          - ECDHE-RSA-AES128-GCM-SHA256
      hosts:
        - "app.example.com"
        - "api.example.com"

    # HTTP 서버 (HTTPS 리다이렉트)
    - port:
        number: 80
        name: http
        protocol: HTTP
      hosts:
        - "app.example.com"
      tls:
        httpsRedirect: true              # HTTP → HTTPS 리다이렉트

    # TCP 서버 (PostgreSQL 등)
    - port:
        number: 5432
        name: postgres
        protocol: TCP
      hosts:
        - "*"

    # TLS Passthrough (TLS 종료 없이 SNI로 라우팅)
    - port:
        number: 443
        name: tls-passthrough
        protocol: TLS
      tls:
        mode: PASSTHROUGH
      hosts:
        - "passthrough.example.com"
```

**Gateway TLS 모드:**

| TLS 모드 | 설명 |
|---------|------|
| PASSTHROUGH | TLS를 종료하지 않고 그대로 통과시킨다. 백엔드가 TLS를 처리한다 |
| SIMPLE | Gateway에서 TLS를 종료한다. 서버 인증서만 필요하다 |
| MUTUAL | Gateway에서 TLS를 종료하고 클라이언트 인증서도 검증한다 |
| AUTO_PASSTHROUGH | SNI 기반으로 자동 라우팅한다. Multi-cluster에서 사용한다 |
| ISTIO_MUTUAL | Istio의 mTLS를 사용한다. 인증서를 자동 관리한다 |

### 3.4 ServiceEntry 완전 해부

ServiceEntry는 메시 외부의 서비스를 Istio 서비스 레지스트리에 등록한다. 이를 통해 외부 서비스에 대해서도 트래픽 정책, mTLS, 관찰성을 적용할 수 있다.

```yaml
apiVersion: networking.istio.io/v1beta1
kind: ServiceEntry
metadata:
  name: external-api
  namespace: demo
spec:
  # 외부 서비스의 호스트 이름
  hosts:
    - api.external.com

  # 서비스 위치
  location: MESH_EXTERNAL              # MESH_EXTERNAL: 메시 밖의 서비스
                                       # MESH_INTERNAL: 메시 안이지만
                                       # K8s 서비스가 아닌 것

  # 포트 정의
  ports:
    - number: 443
      name: https
      protocol: TLS                    # HTTP, HTTPS, GRPC, HTTP2,
                                       # MONGO, TCP, TLS
    - number: 80
      name: http
      protocol: HTTP

  # DNS 해석 방식
  resolution: DNS                      # NONE: 원래 IP 사용
                                       # STATIC: endpoints 필드의 IP 사용
                                       # DNS: DNS로 해석
                                       # DNS_ROUND_ROBIN: DNS 결과를 라운드로빈

  # STATIC resolution일 때 엔드포인트 지정
  # endpoints:
  #   - address: 192.168.1.100
  #     ports:
  #       https: 8443
  #   - address: 192.168.1.101
  #     ports:
  #       https: 8443

  # 워크로드 선택기 (VM 등 비-Kubernetes 워크로드)
  # workloadSelector:
  #   labels:
  #     app: external-app

  # exportTo: 이 ServiceEntry를 볼 수 있는 네임스페이스
  exportTo:
    - "."                              # 같은 네임스페이스에서만
```

**ServiceEntry 사용 시나리오:**

| 시나리오 | 설명 |
|---------|------|
| 외부 API 호출 | 외부 REST API를 등록하여 트래픽 정책을 적용한다 |
| 외부 데이터베이스 | AWS RDS 같은 외부 DB를 등록하여 mTLS와 연결 풀을 관리한다 |
| 레거시 서비스 | Kubernetes 밖에서 실행되는 VM 기반 서비스를 메시에 편입한다 |
| Egress 제어 | 허용된 외부 서비스만 등록하여 egress 트래픽을 제한한다 |

### 3.5 Sidecar 리소스

Sidecar 리소스는 각 사이드카 프록시가 수신할 트래픽의 범위를 제한한다. 기본적으로 Envoy는 메시 내 모든 서비스의 설정을 수신하는데, 이는 대규모 메시에서 메모리와 CPU를 많이 소비한다.

```yaml
apiVersion: networking.istio.io/v1beta1
kind: Sidecar
metadata:
  name: default
  namespace: demo
spec:
  # 이 설정이 적용될 워크로드 (생략하면 네임스페이스 전체)
  workloadSelector:
    labels:
      app: nginx-web

  # Inbound 트래픽 설정
  ingress:
    - port:
        number: 80
        protocol: HTTP
        name: http
      defaultEndpoint: 127.0.0.1:80    # 앱 컨테이너의 실제 포트
      # captureMode: DEFAULT           # DEFAULT, IPTABLES, NONE

  # Outbound 트래픽 설정 (핵심: 사이드카가 알아야 할 서비스 범위 제한)
  egress:
    - hosts:
        - "./*"                        # 같은 네임스페이스의 모든 서비스
        - "istio-system/*"             # istio-system의 모든 서비스
        # 특정 서비스만 지정할 수도 있다:
        # - "./httpbin"
        # - "other-ns/other-service"
      port:
        number: 80
        protocol: HTTP
        name: http

  # Outbound 트래픽 정책
  outboundTrafficPolicy:
    mode: ALLOW_ANY                    # ALLOW_ANY: 모든 외부 트래픽 허용
                                       # REGISTRY_ONLY: 레지스트리에 등록된
                                       #   서비스만 허용
```

**Sidecar 리소스의 성능 영향:**

```
Sidecar 리소스 미적용 (기본):
  - 모든 서비스의 Listener, Route, Cluster, Endpoint 설정을 수신
  - 서비스 100개 → Envoy 메모리 ~100MB+
  - xDS 업데이트마다 모든 설정을 처리

Sidecar 리소스 적용 후:
  - 필요한 서비스의 설정만 수신
  - 관련 서비스 10개 → Envoy 메모리 ~30MB
  - xDS 업데이트 범위가 축소되어 CPU 사용량 감소
```

---

