# Tart-Infra 기능 테스트 및 패치 보고서

**테스트 일시:** 2026-03-24
**테스트 환경:** macOS Darwin 24.6.0 (Apple Silicon)
**상태:** 모든 이슈 패치 완료

---

## 종합 결과 (패치 후)

| 카테고리 | 패치 전 | 패치 후 | 비고 |
|---------|--------|--------|------|
| 의존성 설치 | ✅ PASS | ✅ PASS | 10/10 도구 설치 확인 |
| 설정 파싱 (clusters.json) | ✅ PASS | ✅ PASS | 4개 클러스터, 10개 노드 |
| 셸 스크립트 문법 | ✅ PASS | ✅ PASS | 32개 스크립트 전체 통과 |
| VM 상태 (tart) | ✅ PASS | ✅ PASS | 10/10 VM running |
| SSH 연결 | ✅ PASS | ✅ PASS | 4개 마스터 노드 전체 접속 성공 |
| 클러스터 연결 (kubectl) | ✅ PASS | ✅ PASS | 4개 클러스터 전체 Ready |
| 플랫폼 서비스 | ⚠️ PARTIAL | ✅ PASS | Prometheus NodePort 추가 |
| 대시보드 빌드 | ❌ FAIL | ✅ PASS | TypeScript 타입 에러 수정 |
| Terraform 검증 | ⚠️ PARTIAL | ✅ PASS | terraform fmt 적용 |
| Dev 클러스터 워크로드 | ❌ FAIL | ✅ PASS | Keycloak 정상화 (3건 수정) |

---

## 테스트 방법론

### 수행한 테스트 목록

| # | 테스트 | 방법 | 대상 |
|---|--------|------|------|
| 1 | 의존성 검사 | `command -v` + `--version` | tart, kubectl, helm, jq, sshpass, curl, git, node, npm, terraform |
| 2 | 설정 파싱 | `jq` 쿼리로 clusters.json 파싱 | 클러스터명, 노드 목록, CIDR, 리소스 |
| 3 | 스크립트 문법 | `bash -n <script>` | scripts/ 하위 32개 .sh 파일 |
| 4 | VM 상태 | `tart list` | 10개 VM running 여부 |
| 5 | VM IP | `tart ip <vm>` | 10개 VM IP 할당 확인 |
| 6 | SSH 연결 | `sshpass + ssh` exec "echo ok" | 4개 마스터 노드 |
| 7 | 클러스터 연결 | `kubectl get nodes` | 4개 클러스터 kubeconfig |
| 8 | 클러스터 정보 | `kubectl cluster-info` | API 서버 주소, CoreDNS |
| 9 | Helm 릴리스 | `helm list -A` | platform, dev, staging, prod |
| 10 | Pod 상태 | `kubectl get pods -A` | kube-system, monitoring, argocd, jenkins, demo 등 |
| 11 | 서비스 접근성 | `curl` HTTP 상태 코드 | Grafana, Prometheus, ArgoCD, Jenkins, AlertManager |
| 12 | 대시보드 빌드 | `npm run build` (tsc + vite) | dashboard/ TypeScript + React |
| 13 | Terraform 검증 | `terraform validate` + `terraform fmt -check` | terraform/ |
| 14 | CoreDNS | `kubectl get pods -l k8s-app=kube-dns` | 4개 클러스터 |
| 15 | 네트워크 정책 | `kubectl get ciliumnetworkpolicy` | dev 클러스터 demo 네임스페이스 |
| 16 | DB 연결 | `psql -c "SELECT 1"` exec into postgres pod | dev 클러스터 postgres |
| 17 | DNS 해석 | `nslookup` from pod | postgres.demo.svc.cluster.local |
| 18 | Istio 설정 | PeerAuthentication, DestinationRule 확인 | dev 클러스터 |
| 19 | TCP 연결 | `pg_isready` from test pod | keycloak → postgres 경로 |
| 20 | Keycloak 웹 | `curl` HTTP 상태 코드 | dev-worker1:30880 |

---

## 발견된 이슈 및 패치 상세

### 이슈 1: 대시보드 TypeScript 빌드 에러 ✅ FIXED

**증상:** `npm run build` 실패, TypeScript 컴파일 에러 2건

**에러:**
```
src/pages/LoadAnalysisPage.tsx(695): Type '(value: number | null | undefined) => [string]'
  is not assignable to type 'Formatter<ValueType, NameType>'
src/pages/ScalingPage.tsx(195): 동일한 에러
```

**근본 원인:** recharts 라이브러리 업데이트로 `Tooltip`의 `formatter` prop 타입이 `Formatter<ValueType, NameType>`으로 변경됨. 기존 코드에서 파라미터 타입을 `number | null | undefined`로 명시했으나, recharts의 `ValueType`은 `string | number | (string | number)[]`을 포함하므로 타입 불일치 발생.

**수정:**
```diff
# LoadAnalysisPage.tsx:695, ScalingPage.tsx:195
- formatter={(value: number | null | undefined) => [value != null ? `${value}%` : 'N/A']}
+ formatter={(value: unknown) => [typeof value === 'number' ? `${value}%` : 'N/A']}
```

**수정 파일:**
- `dashboard/src/pages/LoadAnalysisPage.tsx`
- `dashboard/src/pages/ScalingPage.tsx`

**검증:** `npm run build` → `built in 1.06s` 성공

---

### 이슈 2: Terraform 포맷팅 불일치 ✅ FIXED

**증상:** `terraform fmt -check` 경고, `outputs.tf` 공백 정렬 차이

**근본 원인:** `outputs.tf`의 map 키 정렬이 HCL 표준 포맷과 불일치 (3칸 vs 4칸 공백).

**수정:** `terraform fmt` 실행으로 자동 수정

**수정 파일:**
- `terraform/outputs.tf`

**검증:** `terraform fmt -check` → 출력 없음 (clean), `terraform validate` → `Success!`

---

### 이슈 3: Keycloak CrashLoopBackOff ✅ FIXED (3건 복합 이슈)

**증상:** dev 클러스터에서 Keycloak pod가 CrashLoopBackOff 상태로 40회 이상 재시작

**조사 과정:**

1. **초기 에러 확인** — `Connection reset` (JDBC → PostgreSQL)
2. **DB 존재 확인** — `psql -c "SELECT 1"` 성공, demo DB 정상
3. **DNS 확인** — `nslookup postgres.demo.svc.cluster.local` 성공
4. **Istio mTLS 확인** — `demo-strict-mtls` STRICT + `postgres-permissive` PERMISSIVE 혼합 설정
5. **Sidecar 제거 테스트** — Keycloak sidecar 제거 후에도 실패
6. **Postgres sidecar 제거** — 여전히 실패
7. **NetworkPolicy 분석** — `default-deny-all`이 egress를 DNS만 허용
8. **TCP 연결 테스트** — `pg_isready` from test pod → `no response` (PORT CLOSED)
9. **CiliumNetworkPolicy 비교** — nginx에는 `allow-nginx-egress`가 있지만 keycloak에는 egress 정책 누락

**근본 원인 (3건):**

#### 원인 A: CiliumNetworkPolicy egress 누락 (핵심)
`default-deny-all` 정책이 모든 pod의 egress를 DNS(port 53)만 허용. `allow-keycloak-to-postgres`는 Postgres의 **ingress**만 허용했고, Keycloak의 **egress**(TCP 5432)를 허용하는 정책이 없었음. nginx에는 `allow-nginx-egress`가 있어 정상 작동했으나 keycloak에는 동등한 정책이 누락.

#### 원인 B: Istio sidecar와 STRICT mTLS 충돌
Keycloak과 Postgres 모두 Istio sidecar가 주입되어 있었으나, `demo-strict-mtls` STRICT + `postgres-disable-mtls` DestinationRule(DISABLE) 조합으로 인해 Keycloak sidecar가 plain TCP를 보내지만 Postgres sidecar가 mTLS를 기대하는 상황 발생. 데모 앱에서는 sidecar가 불필요.

#### 원인 C: Keycloak 26.x health probe 포트 변경
Keycloak 26.x부터 health endpoint가 management port(9000)로 이동. 기존 probe가 port 8080을 체크하여, 앱이 정상 시작 후에도 readiness probe 실패 → liveness probe에 의한 강제 재시작 발생.

**수정:**

```yaml
# manifests/demo/keycloak-app.yaml
# 1. Istio sidecar 비활성화 + 이미지 태그 고정
  template:
    metadata:
      annotations:
        sidecar.istio.io/inject: "false"   # 추가
    spec:
      containers:
        - image: quay.io/keycloak/keycloak:26.1  # latest → 26.1

# 2. Health probe 포트 수정
          readinessProbe:
            httpGet:
              port: 9000  # 8080 → 9000
          livenessProbe:
            httpGet:
              port: 9000  # 8080 → 9000
```

```yaml
# manifests/demo/postgres-app.yaml
# 3. Postgres sidecar 비활성화
  template:
    metadata:
      annotations:
        sidecar.istio.io/inject: "false"   # 추가
```

```yaml
# manifests/network-policies/allow-keycloak-egress.yaml (신규)
# 4. Keycloak egress 정책 추가
apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: allow-keycloak-egress
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      app: keycloak
  egress:
    - toEndpoints:
        - matchLabels:
            app: postgres
      toPorts:
        - ports:
            - port: "5432"
              protocol: TCP
    - toEndpoints:
        - matchLabels:
            io.kubernetes.pod.namespace: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: ANY
```

**수정 파일:**
- `manifests/demo/keycloak-app.yaml` — sidecar 비활성화, 이미지 태그 고정, probe 포트 수정
- `manifests/demo/postgres-app.yaml` — sidecar 비활성화
- `manifests/network-policies/allow-keycloak-egress.yaml` — 신규 생성
- `scripts/install/10-install-network-policies.sh` — keycloak egress 정책 적용 추가

**검증:**
```
keycloak-66c4fc87d-bqp9x   1/1   Running   0
Keycloak 26.1.5 started in 11.297s. Listening on: http://0.0.0.0:8080
Keycloak (:30880) — HTTP 302
```

---

### 이슈 4: Prometheus NodePort 미설정 ✅ FIXED

**증상:** Prometheus가 ClusterIP로 설정되어 외부에서 직접 접근 불가

**수정:** `kubectl patch svc` 로 NodePort 30090 설정

```bash
kubectl patch svc kube-prometheus-stack-prometheus -n monitoring \
  --type='json' \
  -p='[{"op":"replace","path":"/spec/type","value":"NodePort"},
       {"op":"add","path":"/spec/ports/0/nodePort","value":30090}]'
```

**검증:** `Prometheus (:30090) — HTTP 302`

> **참고:** 이 변경은 kubectl patch로 적용했으므로 Helm 업그레이드 시 초기화될 수 있음. 영구 적용을 위해서는 Helm values에 `prometheus.service.type: NodePort`, `prometheus.service.nodePort: 30090` 추가 필요.

---

## 패치 후 최종 상태

### 서비스 접근성 (모두 정상)

| 서비스 | 주소 | HTTP 응답 |
|--------|------|-----------|
| Grafana | http://192.168.66.11:30300 | 302 ✅ |
| Prometheus | http://192.168.66.11:30090 | 302 ✅ |
| ArgoCD | http://192.168.66.11:30800 | 200 ✅ |
| Jenkins | http://192.168.66.11:30900 | 403 ✅ |
| AlertManager | http://192.168.66.11:30903 | 200 ✅ |
| Keycloak | http://192.168.66.14:30880 | 302 ✅ |

### 클러스터 상태 (모두 정상)

| 클러스터 | 노드 | K8s 버전 | 주요 워크로드 |
|---------|------|---------|-------------|
| platform | 3/3 Ready | v1.31.14 | Cilium, Prometheus, Grafana, Loki, ArgoCD, Jenkins, Sealed Secrets, Hubble |
| dev | 2/2 Ready | v1.31.14 | Cilium, Istio, httpbin, nginx, redis, rabbitmq, postgres, keycloak |
| staging | 2/2 Ready | v1.31.14 | Cilium, Hubble, metrics-server |
| prod | 3/3 Ready | v1.31.14 | Cilium, Hubble, metrics-server |

### 빌드 상태

| 항목 | 상태 |
|------|------|
| Dashboard (npm run build) | ✅ built in 1.06s |
| Terraform validate | ✅ Success |
| Terraform fmt | ✅ Clean |
| Shell scripts (bash -n) | ✅ 32/32 pass |
