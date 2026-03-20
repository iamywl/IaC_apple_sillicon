# Day 6: 실습 환경, 실습, 예제, 디버깅, 자가 점검

> 이 문서에서는 이 프로젝트에서의 Istio 실습 환경 설정, 실습(트래픽 관리, 보안 정책, 카나리 배포), 예제(VirtualService, mTLS, 완전한 프로덕션 설정), 디버깅 명령어, 자가 점검 체크리스트, 참고문헌을 다룬다.

---

## 이 프로젝트에서의 실습 환경

이 프로젝트에서 Istio는 dev 클러스터에만 설치된다 (platform, staging, prod에는 미설치). 카나리 배포, 서킷 브레이커, mTLS를 실습하는 용도이다.

- 설치 스크립트: `scripts/install/12-install-istio.sh`
- Helm values: `manifests/istio/istio-values.yaml`
- 네임스페이스: `istio-system` (컨트롤 플레인), `istio-ingress` (게이트웨이), `demo` (사이드카 주입)
- 정책 매니페스트: `manifests/istio/` 디렉토리
- 실습 대상 클러스터: dev (`kubeconfig/dev.yaml`)

```bash
# dev 클러스터에서 Istio 상태 확인
export KUBECONFIG=kubeconfig/dev.yaml
istioctl version
kubectl get pods -n istio-system
kubectl get vs,dr,gw -n demo
```

주요 Istio 리소스:
| 파일 | 내용 |
|------|------|
| `istio-gateway.yaml` | Ingress Gateway 및 라우팅 규칙 (nginx-web 기본 라우팅, /api → httpbin) |
| `virtual-service.yaml` | Canary 배포 (80/20 분할, x-canary 헤더 기반 라우팅) |
| `destination-rule.yaml` | Circuit Breaker (연속 5xx 3회 시 30초 제외), Outlier Detection |
| `peer-authentication.yaml` | STRICT mTLS (demo 네임스페이스 전체) |
| `httpbin-v2.yaml` | Canary 테스트용 httpbin v2 배포 (kong/httpbin:latest) |

**demo 네임스페이스의 실습 대상 서비스:**

| 서비스 | 용도 | Istio 실습에서의 역할 |
|--------|------|---------------------|
| nginx-web | 웹 서버 | Gateway를 통한 기본 라우팅 대상, 다른 서비스 호출의 클라이언트 |
| httpbin | HTTP 테스트 서비스 | 카나리 배포(v1/v2), 서킷 브레이커, fault injection 대상 |
| redis | 캐시 서버 | TCP 프로토콜 라우팅 실습 |
| postgres | 데이터베이스 | TCP 프로토콜 라우팅, 외부 서비스 시뮬레이션 |
| rabbitmq | 메시지 큐 | TCP 프로토콜 라우팅 실습 |
| keycloak | IAM 서버 | JWT 인증 연동 (RequestAuthentication) |

**설치 과정 (12-install-istio.sh 요약):**

```bash
# 1. Helm 차트 추가
helm repo add istio https://istio-release.storage.googleapis.com/charts

# 2. Istio Base CRD 설치 (istio-system 네임스페이스)
helm upgrade --install istio-base istio/base -n istio-system

# 3. istiod 설치 (manifests/istio/istio-values.yaml 사용)
helm upgrade --install istiod istio/istiod -n istio-system \
  --values manifests/istio/istio-values.yaml

# 4. Ingress Gateway 설치 (istio-ingress 네임스페이스, NodePort)
helm upgrade --install istio-ingressgateway istio/gateway -n istio-ingress \
  --set service.type=NodePort

# 5. demo 네임스페이스에 사이드카 주입 활성화
kubectl label namespace demo istio-injection=enabled

# 6. 기존 Pod 재시작 (사이드카 주입)
kubectl rollout restart deployment -n demo

# 7. httpbin-v2 배포
kubectl apply -f manifests/istio/httpbin-v2.yaml

# 8. Istio 정책 적용
kubectl apply -f manifests/istio/peer-authentication.yaml
kubectl apply -f manifests/istio/virtual-service.yaml
kubectl apply -f manifests/istio/destination-rule.yaml
kubectl apply -f manifests/istio/istio-gateway.yaml
```

---

## 실습

### 실습 1: Istio 설치 및 확인
```bash
# Istio CLI 설치
brew install istioctl

# 설치 가능한 프로파일 확인
istioctl profile list
# default, demo, minimal, remote, empty, preview, ambient

# Istio 설치 (demo 프로파일 - 학습 환경용, 모든 기능 포함)
istioctl install --set profile=demo -y

# 설치 확인
kubectl get pods -n istio-system
istioctl version

# Sidecar 자동 주입 활성화
kubectl label namespace demo istio-injection=enabled

# 설치 검증 (설정 오류 탐지)
istioctl analyze -A
```

### 실습 2: Sidecar 주입 확인
```bash
# Sidecar 주입 전 Pod 확인 (READY 1/1)
kubectl get pods -n demo

# 네임스페이스에 istio-injection 레이블 확인
kubectl get ns demo --show-labels

# Pod를 재시작하면 Sidecar가 주입된다 (READY 2/2)
kubectl rollout restart deployment -n demo
kubectl get pods -n demo  # 2/2 확인

# Sidecar 구성 확인 - 모든 프록시의 동기화 상태를 확인한다
istioctl proxy-status

# 특정 Pod의 Envoy 설정 상세 확인
istioctl proxy-config listeners <pod-name> -n demo
istioctl proxy-config routes <pod-name> -n demo
istioctl proxy-config clusters <pod-name> -n demo
istioctl proxy-config endpoints <pod-name> -n demo
```

### 실습 3: mTLS 확인
```bash
# mTLS 모드 확인
kubectl get peerauthentication -A

# 특정 서비스의 mTLS 상태 확인
istioctl authn tls-check <pod-name> -n demo

# PERMISSIVE 모드 적용 (마이그레이션 단계 - mTLS와 평문 모두 허용)
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

# STRICT mTLS 적용 (모든 트래픽이 mTLS를 사용해야 한다)
kubectl apply -f - <<EOF
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: demo
spec:
  mtls:
    mode: STRICT
EOF

# 특정 포트만 mTLS 제외 (예: 헬스체크 포트)
kubectl apply -f - <<EOF
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: my-app-mtls
  namespace: demo
spec:
  selector:
    matchLabels:
      app: my-app
  mtls:
    mode: STRICT
  portLevelMtls:
    8080:
      mode: DISABLE
EOF
```

### 실습 4: Istio 대시보드 도구
```bash
# Kiali (서비스 메시 관리 대시보드)
istioctl dashboard kiali

# Jaeger (분산 트레이싱)
istioctl dashboard jaeger

# Grafana (메트릭 대시보드)
istioctl dashboard grafana

# Envoy 프록시 관리 대시보드
istioctl dashboard envoy <pod-name> -n demo

# Prometheus (메트릭 수집)
istioctl dashboard prometheus
```

### 실습 5: Gateway 라우팅 확인
```bash
# Gateway 리소스 확인
kubectl get gw -n demo
kubectl describe gw demo-gateway -n demo

# Gateway를 통한 라우팅 확인
# 프로젝트 설정: / → nginx-web, /api → httpbin
WORKER_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[0].address}')
INGRESS_PORT=$(kubectl -n istio-ingress get svc istio-ingressgateway \
  -o jsonpath='{.spec.ports[?(@.name=="http")].nodePort}')

# nginx-web으로 라우팅
curl -s http://$WORKER_IP:$INGRESS_PORT/

# httpbin으로 라우팅
curl -s http://$WORKER_IP:$INGRESS_PORT/api/get
```

### 실습 6: 서킷 브레이커 동작 확인
```bash
# DestinationRule 확인
kubectl get dr httpbin-destination -n demo -o yaml

# 부하 테스트로 서킷 브레이커 동작 확인
# k6 또는 fortio 사용
kubectl -n demo exec deploy/nginx-web -c nginx -- \
  sh -c 'for i in $(seq 1 100); do curl -s -o /dev/null -w "%{http_code}\n" http://httpbin/get; done'

# Envoy 통계에서 서킷 브레이커 메트릭 확인
kubectl -n demo exec deploy/nginx-web -c istio-proxy -- \
  curl -s localhost:15000/stats | grep -E "upstream_rq_pending_overflow|ejections"
```

---

## 예제

### 예제 1: 카나리 배포 (트래픽 분할)
```yaml
# canary-deployment.yaml
# v1에 90%, v2에 10% 트래픽을 보낸다
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-app
  namespace: demo
spec:
  hosts:
    - my-app
  http:
    - route:
        - destination:
            host: my-app
            subset: v1
          weight: 90
        - destination:
            host: my-app
            subset: v2
          weight: 10
---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: my-app
  namespace: demo
spec:
  host: my-app
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
```

### 예제 2: 서킷 브레이커
```yaml
# circuit-breaker.yaml
# 연속 5xx 에러가 3번 발생하면 30초간 해당 인스턴스를 제외한다
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: my-app-circuit-breaker
  namespace: demo
spec:
  host: my-app
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        h2UpgradePolicy: DEFAULT
        http1MaxPendingRequests: 100
        http2MaxRequests: 1000
        maxRequestsPerConnection: 10
    outlierDetection:
      consecutive5xxErrors: 3
      interval: 10s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
```

### 예제 3: 타임아웃 및 재시도
```yaml
# timeout-retry.yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-app
  namespace: demo
spec:
  hosts:
    - my-app
  http:
    - timeout: 3s
      retries:
        attempts: 3
        perTryTimeout: 1s
        retryOn: 5xx,reset,connect-failure
      route:
        - destination:
            host: my-app
```

### 예제 4: Fault Injection (장애 주입)

테스트 환경에서 서비스의 복원력(resilience)을 검증하기 위해 인위적으로 장애를 주입할 수 있다.

```yaml
# fault-injection-delay.yaml
# 전체 트래픽의 10%에 5초 지연을 주입한다
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-app
  namespace: demo
spec:
  hosts:
    - my-app
  http:
    - fault:
        delay:
          percentage:
            value: 10.0
          fixedDelay: 5s
      route:
        - destination:
            host: my-app
```

```yaml
# fault-injection-abort.yaml
# 전체 트래픽의 20%에 HTTP 503 에러를 반환한다
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-app
  namespace: demo
spec:
  hosts:
    - my-app
  http:
    - fault:
        abort:
          percentage:
            value: 20.0
          httpStatus: 503
      route:
        - destination:
            host: my-app
```

```yaml
# fault-injection-combined.yaml
# 지연과 에러를 동시에 주입한다
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-app
  namespace: demo
spec:
  hosts:
    - my-app
  http:
    - fault:
        delay:
          percentage:
            value: 50.0
          fixedDelay: 3s
        abort:
          percentage:
            value: 10.0
          httpStatus: 500
      route:
        - destination:
            host: my-app
```

### 예제 5: 트래픽 미러링 (Traffic Mirroring / Shadowing)

실 트래픽의 복사본을 다른 서비스로 전송하여 새 버전을 안전하게 테스트할 수 있다. 미러링된 요청의 응답은 클라이언트에게 반환되지 않는다.

```yaml
# traffic-mirroring.yaml
# v1으로 라우팅하면서, 트래픽을 v2로 미러링한다
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-app
  namespace: demo
spec:
  hosts:
    - my-app
  http:
    - route:
        - destination:
            host: my-app
            subset: v1
      mirror:
        host: my-app
        subset: v2
      mirrorPercentage:
        value: 100.0  # 100% 미러링 (비율 조절 가능)
---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: my-app
  namespace: demo
spec:
  host: my-app
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
```

### 예제 6: 헤더 기반 라우팅
```yaml
# header-based-routing.yaml
# 특정 헤더 값에 따라 다른 버전으로 라우팅한다
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-app
  namespace: demo
spec:
  hosts:
    - my-app
  http:
    - match:
        - headers:
            x-user-type:
              exact: beta-tester
      route:
        - destination:
            host: my-app
            subset: v2
    - route:
        - destination:
            host: my-app
            subset: v1
```

### 예제 7: RequestAuthentication (JWT 검증)
```yaml
# jwt-auth.yaml
# JWT 토큰을 검증하고, 유효하지 않으면 요청을 거부한다
apiVersion: security.istio.io/v1beta1
kind: RequestAuthentication
metadata:
  name: jwt-auth
  namespace: demo
spec:
  selector:
    matchLabels:
      app: my-app
  jwtRules:
    - issuer: "https://accounts.google.com"
      jwksUri: "https://www.googleapis.com/oauth2/v3/certs"
---
# JWT가 없거나 유효하지 않은 요청을 거부한다
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: require-jwt
  namespace: demo
spec:
  selector:
    matchLabels:
      app: my-app
  action: DENY
  rules:
    - from:
        - source:
            notRequestPrincipals: ["*"]
```

### 예제 8: Consistent Hash 로드밸런싱
```yaml
# consistent-hash.yaml
# 같은 사용자의 요청을 항상 같은 Pod로 라우팅한다 (sticky sessions)
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: httpbin-sticky
  namespace: demo
spec:
  host: httpbin
  trafficPolicy:
    loadBalancer:
      consistentHash:
        httpHeaderName: x-user-id          # 사용자 ID 헤더 기반
        # 또는 쿠키 기반:
        # httpCookie:
        #   name: session-id
        #   ttl: 0s
        # 또는 소스 IP 기반:
        # useSourceIp: true
```

### 예제 9: ServiceEntry를 사용한 외부 서비스 접근
```yaml
# external-service.yaml
# 외부 API를 Istio 서비스 레지스트리에 등록하여 트래픽 정책을 적용한다
apiVersion: networking.istio.io/v1beta1
kind: ServiceEntry
metadata:
  name: external-api
  namespace: demo
spec:
  hosts:
    - api.github.com
  ports:
    - number: 443
      name: https
      protocol: TLS
  resolution: DNS
  location: MESH_EXTERNAL
---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: external-api-dr
  namespace: demo
spec:
  host: api.github.com
  trafficPolicy:
    tls:
      mode: SIMPLE                         # 외부 서비스이므로 SIMPLE TLS
    connectionPool:
      tcp:
        maxConnections: 10
      http:
        http1MaxPendingRequests: 10
        maxRequestsPerConnection: 5
    outlierDetection:
      consecutive5xxErrors: 3
      interval: 30s
      baseEjectionTime: 60s
```

### 예제 10: Sidecar 리소스로 프록시 스코프 제한
```yaml
# sidecar-scope.yaml
# nginx-web 사이드카가 알아야 할 서비스 범위를 제한하여 리소스를 절약한다
apiVersion: networking.istio.io/v1beta1
kind: Sidecar
metadata:
  name: nginx-web-sidecar
  namespace: demo
spec:
  workloadSelector:
    labels:
      app: nginx-web
  egress:
    - hosts:
        - "./httpbin"                      # httpbin만 필요
        - "./redis"                        # redis만 필요
        - "istio-system/*"                 # istio-system 서비스
```

---

## 디버깅

### istioctl analyze

설정 오류를 자동으로 탐지하고 개선 방법을 제안한다.

```bash
# 전체 클러스터 분석
istioctl analyze -A

# 특정 네임스페이스 분석
istioctl analyze -n demo

# 파일 적용 전 사전 분석
istioctl analyze -n demo my-virtualservice.yaml
```

### istioctl proxy-config

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
```

### 자주 발생하는 문제와 해결법

| 증상 | 원인 | 해결 방법 |
|------|------|----------|
| Pod가 1/1로 실행된다 (사이드카 미주입) | 네임스페이스에 `istio-injection` 레이블이 없다 | `kubectl label ns <ns> istio-injection=enabled` 후 Pod 재시작 |
| `proxy-status`에서 STALE 표시 | Envoy가 istiod와의 xDS 연결이 끊겼다 | istiod Pod 상태 확인, 네트워크 정책 확인 |
| 503 에러 발생 | upstream 서비스를 찾을 수 없거나, 서킷 브레이커가 동작 중이다 | `istioctl proxy-config clusters` 확인, outlierDetection 설정 검토 |
| mTLS 연결 실패 | STRICT 모드에서 비메시 서비스가 접근을 시도한다 | PeerAuthentication을 PERMISSIVE로 변경하거나, 클라이언트에 사이드카 주입 |
| VirtualService가 동작하지 않는다 | hosts 필드가 실제 서비스 이름과 불일치한다 | `istioctl analyze`로 확인, hosts와 Kubernetes Service 이름 대조 |
| 트래픽이 의도한 subset으로 가지 않는다 | DestinationRule의 subset 레이블과 Pod 레이블이 불일치한다 | `kubectl get pods --show-labels`로 Pod 레이블 확인 |
| 높은 지연 시간 | 사이드카 리소스 부족 또는 연결 풀 설정 문제이다 | Envoy 리소스 limit 확인, connectionPool 튜닝 |

```bash
# Envoy 로그 레벨 조정 (디버깅 시 유용)
istioctl proxy-config log <pod-name> -n demo --level debug

# 기본 로그 레벨로 복원
istioctl proxy-config log <pod-name> -n demo --level info

# istiod 로그 확인
kubectl logs -n istio-system -l app=istiod -f

# Envoy 사이드카 로그 확인
kubectl logs <pod-name> -n demo -c istio-proxy -f
```

---

## 자가 점검

### 기본 개념
- [ ] 서비스 메시가 왜 필요한지 설명할 수 있는가?
- [ ] Sidecar 패턴의 동작 원리(Mutating Webhook, istio-init, iptables)를 설명할 수 있는가?
- [ ] istiod가 통합하는 세 가지 기능(Pilot, Citadel, Galley)과 xDS API를 설명할 수 있는가?
- [ ] Data Plane과 Control Plane의 역할과 분리의 이점을 설명할 수 있는가?
- [ ] Sidecar 모드와 Ambient 모드의 차이를 설명할 수 있는가?

### 보안
- [ ] mTLS가 무엇이고, SPIFFE ID 기반 인증서가 어떻게 발급/갱신되는지 설명할 수 있는가?
- [ ] PERMISSIVE와 STRICT mTLS 모드의 차이를 설명할 수 있는가?
- [ ] PeerAuthentication과 RequestAuthentication의 차이를 설명할 수 있는가?
- [ ] AuthorizationPolicy의 ALLOW/DENY/CUSTOM 액션과 평가 순서를 설명할 수 있는가?
- [ ] JWT 검증 흐름(RequestAuthentication + AuthorizationPolicy)을 설명할 수 있는가?
- [ ] Zero-Trust 네트워크를 Istio로 어떻게 구축하는지 설명할 수 있는가?

### 트래픽 관리
- [ ] VirtualService와 DestinationRule의 역할을 각각 설명할 수 있는가?
- [ ] Gateway, ServiceEntry, Sidecar 리소스의 역할을 설명할 수 있는가?
- [ ] 카나리 배포를 Istio로 어떻게 구현하는지 설명할 수 있는가?
- [ ] 서킷 브레이커(outlierDetection)의 동작 원리를 설명할 수 있는가?
- [ ] connectionPool과 outlierDetection의 차이를 설명할 수 있는가?
- [ ] Fault Injection과 Traffic Mirroring의 용도와 설정 방법을 설명할 수 있는가?
- [ ] 재시도(retries)와 타임아웃(timeout)의 관계를 설명할 수 있는가?

### 관찰성
- [ ] Istio가 자동 생성하는 세 가지 옵저버빌리티 신호를 나열할 수 있는가?
- [ ] 분산 트레이싱에서 trace context propagation이 왜 애플리케이션의 책임인지 설명할 수 있는가?
- [ ] Envoy 응답 플래그(RESPONSE_FLAGS)의 주요 값을 설명할 수 있는가?
- [ ] Kiali, Jaeger, Grafana의 역할 차이를 설명할 수 있는가?

### 고급
- [ ] Ambient Mesh(ztunnel, Waypoint Proxy)의 개념과 기존 사이드카 모드와의 차이를 설명할 수 있는가?
- [ ] Kubernetes Gateway API와 Istio Gateway API의 차이를 설명할 수 있는가?
- [ ] Multi-cluster 메시의 토폴로지(Primary-Remote, Primary-Primary)를 설명할 수 있는가?
- [ ] Sidecar 리소스로 프록시 스코프를 제한하는 이유와 방법을 설명할 수 있는가?
- [ ] Wasm 플러그인과 EnvoyFilter의 차이를 설명할 수 있는가?

### 트러블슈팅
- [ ] `istioctl analyze`와 `istioctl proxy-config`를 사용하여 문제를 진단할 수 있는가?
- [ ] `istioctl proxy-status`의 SYNCED/STALE 상태의 의미를 설명할 수 있는가?
- [ ] Envoy admin interface의 주요 엔드포인트를 설명할 수 있는가?
- [ ] 503, 504, 401, 403 에러의 일반적인 원인을 설명할 수 있는가?

---

## 참고문헌

### 공식 문서
- [Istio 공식 문서](https://istio.io/latest/docs/) - 아키텍처, 설치, 설정 가이드 전반
- [Istio GitHub 리포지토리](https://github.com/istio/istio) - 소스 코드, 이슈 트래커, 릴리스 노트
- [Istio Architecture](https://istio.io/latest/docs/ops/deployment/architecture/) - Control Plane과 Data Plane 구조 상세
- [Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/) - VirtualService, DestinationRule, Gateway 개념
- [Security](https://istio.io/latest/docs/concepts/security/) - mTLS, 인증, 인가 아키텍처
- [Observability](https://istio.io/latest/docs/concepts/observability/) - 메트릭, 트레이싱, 접근 로그
- [Ambient Mesh](https://istio.io/latest/docs/ambient/) - Sidecar-less 모드 문서
- [istioctl Reference](https://istio.io/latest/docs/reference/commands/istioctl/) - CLI 명령어 레퍼런스

### 데이터 플레인
- [Envoy Proxy Documentation](https://www.envoyproxy.io/docs/envoy/latest/) - Istio가 사용하는 데이터 플레인 프록시 문서
- [Envoy xDS API](https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol) - xDS 프로토콜 상세 스펙
- [Envoy Filter Chain](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/listeners/listener_filters) - 필터 체인 아키텍처

### 보안
- [SPIFFE Specification](https://spiffe.io/) - Istio가 채택한 워크로드 ID 프레임워크
- [Istio Security Best Practices](https://istio.io/latest/docs/ops/best-practices/security/) - 보안 모범 사례

### Gateway API
- [Kubernetes Gateway API](https://gateway-api.sigs.k8s.io/) - Kubernetes 표준 Gateway API 스펙
- [Istio Gateway API Support](https://istio.io/latest/docs/tasks/traffic-management/ingress/gateway-api/) - Istio의 Gateway API 지원

### 성능 및 운영
- [Istio Performance and Scalability](https://istio.io/latest/docs/ops/deployment/performance-and-scalability/) - 성능 벤치마크, 튜닝 가이드
- [Istio Troubleshooting](https://istio.io/latest/docs/ops/diagnostic-tools/) - 진단 도구 사용법
- [Istio Best Practices](https://istio.io/latest/docs/ops/best-practices/) - 운영 모범 사례

### 서적
- *Istio in Action* (Manning) - Istio 실무 가이드
- *Istio: Up and Running* (O'Reilly) - Istio 입문서
- *Service Mesh Patterns* (O'Reilly) - 서비스 메시 패턴 모음
