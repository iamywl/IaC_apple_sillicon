---
marp: true
theme: default
paginate: true
backgroundColor: #1a1a2e
color: #eaeaea
style: |
  section {
    font-family: 'Pretendard', 'Apple SD Gothic Neo', sans-serif;
    padding: 40px 60px;
  }
  h1 { color: #00d2ff; font-size: 2.2em; border-bottom: 3px solid #00d2ff; padding-bottom: 10px; }
  h2 { color: #7b2ff7; font-size: 1.7em; }
  h3 { color: #00d2ff; font-size: 1.3em; }
  strong { color: #ff6b6b; }
  code { background: #16213e; color: #0ff; padding: 2px 8px; border-radius: 4px; }
  pre { background: #16213e !important; border-radius: 8px; }
  table { font-size: 0.75em; }
  th { background: #7b2ff7; color: white; }
  td { background: #16213e; }
  blockquote { border-left: 4px solid #ff6b6b; background: #16213e; padding: 10px 20px; font-size: 0.9em; }
  a { color: #00d2ff; }
  .columns { display: flex; gap: 30px; }
  .col { flex: 1; }
  section.lead h1 { border: none; text-align: center; font-size: 2.8em; }
  section.lead h2 { text-align: center; color: #eaeaea; font-size: 1.3em; font-weight: 300; }
  section.lead p { text-align: center; }
---

<!-- _class: lead -->

# tart-infra

## Apple Silicon Mac 한 대로 구축하는
## 프로덕션급 멀티클러스터 Kubernetes 인프라

---

# 목차

1. **프로젝트 소개** — 왜 만들었는가
2. **아키텍처** — 4개 클러스터, 10개 VM
3. **자동화 파이프라인** — 17단계 설치
4. **네트워킹** — Cilium, 보안, 서비스 메시
5. **모니터링** — Prometheus, Grafana, Loki
6. **CI/CD** — Jenkins + ArgoCD GitOps
7. **애플리케이션** — 데모앱, 오토스케일링
8. **SRE 대시보드** — 실시간 모니터링
9. **보안** — Sealed Secrets, RBAC, Gatekeeper
10. **기술 스택 총정리**

---

# 1. 이 프로젝트가 해결하는 문제

### 수동 구축의 고통

```
VM 10대 생성 → IP 10개 확인 → SSH 10번 접속 → 설정 반복
→ containerd 설치 → kubeadm 설치 → 클러스터 초기화 4번
→ CNI 설치 → 모니터링 설치 → CI/CD 설치 → ...
```

> **수동으로 1~2시간**, IP 바뀌면 처음부터, 한 단계 빠뜨리면 전체 실패

### 이 프로젝트의 해결

```bash
bash scripts/demo.sh    # 명령어 하나로 전체 자동 구축
```

> **15~60분** 자동 완료, 반복 가능, 실수 없음

---

# 2. 전체 아키텍처

```
┌──────────────────────────────────────────────────────┐
│                    Apple Silicon Mac                  │
│                                                      │
│  ┌─────────────┐  ┌──────────┐  ┌──────────────────┐│
│  │  platform    │  │   dev    │  │  staging  │ prod ││
│  │ master      │  │ master   │  │  master   │master││
│  │ worker1     │  │ worker1  │  │  worker1  │worker1│
│  │ worker2     │  │          │  │           │worker2│
│  │             │  │          │  │           │      ││
│  │ Prometheus  │  │ Istio    │  │           │ HA   ││
│  │ Grafana     │  │ HPA      │  │ Pre-prod  │ Prod ││
│  │ Jenkins     │  │ 데모앱   │  │ 테스트    │ 운영 ││
│  │ ArgoCD      │  │ Cilium   │  │           │      ││
│  └─────────────┘  └──────────┘  └──────────────────┘│
│                                                      │
│  4 클러스터 / 10 VM / Tart 가상화                     │
└──────────────────────────────────────────────────────┘
```

---

# 2. 클러스터별 역할

| 클러스터 | VM 수 | 역할 | 설치 컴포넌트 |
|----------|--------|------|--------------|
| **platform** | 3 (M+W2) | 운영 플랫폼 | Prometheus, Grafana, Loki, Jenkins, ArgoCD, Harbor |
| **dev** | 2 (M+W1) | 개발 환경 | Istio, HPA, CiliumNetworkPolicy, 데모앱 6종 |
| **staging** | 2 (M+W1) | 사전 검증 | Pre-production 테스트 |
| **prod** | 3 (M+W2) | 프로덕션 | HA 구성, Production 워크로드 |

### 네트워크 설계

| 클러스터 | Pod CIDR | Service CIDR |
|----------|----------|-------------|
| platform | `10.10.0.0/16` | `10.96.0.0/16` |
| dev | `10.20.0.0/16` | `10.97.0.0/16` |
| staging | `10.30.0.0/16` | `10.98.0.0/16` |
| prod | `10.40.0.0/16` | `10.99.0.0/16` |

---

# 3. 자동화 파이프라인 — 17단계

```
Phase 1   VM 생성 (tart clone)
Phase 2   노드 준비 (swap off, 커널 모듈, sysctl)
Phase 3   containerd 설치
Phase 4   kubeadm/kubelet/kubectl 설치
Phase 5   클러스터 초기화 (kubeadm init)
Phase 6   워커 노드 조인 (kubeadm join)
Phase 7   Cilium CNI + Hubble 설치
Phase 8   Prometheus + Grafana + Loki + AlertManager
Phase 9   Jenkins + ArgoCD (CI/CD)
Phase 10  Istio 서비스 메시 + Kiali
Phase 11  데모 앱 6종 배포
Phase 12  HPA + k6 부하 테스트
Phase 13  Sealed Secrets (시크릿 암호화)
Phase 14  RBAC (접근 제어)
Phase 15  OPA Gatekeeper (정책 강제)
Phase 16  etcd/Velero 백업
Phase 17  ResourceQuota + Harbor 레지스트리
```

---

# 3. 핵심 설계: clusters.json

> **SSOT(Single Source of Truth)** — 모든 설정의 유일한 원천

```json
{
  "clusters": [
    {
      "name": "platform",
      "master": { "cpu": 4, "memory": 8192 },
      "workers": [
        { "cpu": 4, "memory": 8192 },
        { "cpu": 4, "memory": 8192 }
      ],
      "pod_cidr": "10.10.0.0/16",
      "service_cidr": "10.96.0.0/16"
    }
  ]
}
```

- 클러스터 추가 = JSON에 항목 추가 → `install.sh` 재실행
- IP, 인증, CIDR 모두 이 파일에서 자동 파싱

---

# 4. 네트워킹 — Cilium + eBPF

### 왜 Cilium인가?

| 항목 | kube-proxy (iptables) | Cilium (eBPF) |
|------|----------------------|---------------|
| 동작 위치 | 커널 (iptables 규칙 순회) | **커널 내부 (eBPF)** |
| 성능 | O(n) 규칙 순회 | O(1) 해시 테이블 |
| 가시성 | 없음 | **Hubble로 실시간 관찰** |
| L7 필터링 | 불가 | HTTP/gRPC/DNS 필터링 |

### Hubble — 네트워크 관측

```bash
hubble observe --namespace demo              # 실시간 트래픽
hubble observe --verdict DROPPED             # 차단된 패킷
hubble observe --from-pod demo/nginx-web     # 특정 Pod 추적
```

---

# 4. 네트워크 보안 — 제로 트러스트

### Default Deny → Whitelist 방식

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: default-deny
  namespace: demo
spec:
  endpointSelector: {}    # 모든 Pod에 적용
  ingress: []              # 빈 배열 = 모든 인그레스 차단
  egress:
    - toEndpoints:
        - matchLabels:
            io.kubernetes.pod.namespace: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: ANY
```

> **원칙**: 명시적으로 허용하지 않은 모든 트래픽은 차단된다.

| 정책 | 방향 | 허용 대상 |
|------|------|----------|
| `allow-dns` | Egress | kube-system CoreDNS |
| `nginx-ingress` | Ingress | 외부 → nginx (HTTP) |
| `nginx-to-httpbin` | Egress | nginx → httpbin (GET/POST) |
| `httpbin-from-nginx` | Ingress | nginx에서만 httpbin 접근 |

---

# 4. 서비스 메시 — Istio

### Sidecar 패턴

```
[Pod]
├── nginx 컨테이너 (비즈니스 로직)
└── istio-proxy (Envoy sidecar)    ← 자동 주입
    ├── mTLS 암호화
    ├── 트래픽 라우팅
    ├── 메트릭 수집
    └── 장애 대응 (Circuit Breaker)
```

### 카나리 배포

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
spec:
  http:
    - route:
        - destination:
            host: nginx-web
            subset: stable
          weight: 90        # 기존 버전 90%
        - destination:
            host: nginx-web
            subset: canary
          weight: 10        # 새 버전 10%
```

---

# 5. 모니터링 — 옵저버빌리티 3대 요소

| 요소 | 도구 | 역할 |
|------|------|------|
| **Metrics** | Prometheus | 시계열 데이터 수집 (CPU, 메모리, RPS) |
| **Logs** | Loki + Promtail | 로그 수집/검색 |
| **Traces** | (확장 가능) | 요청 추적 |

### Prometheus Pull 모델

```
Prometheus  ──(scrape)──→  Pod /metrics
     │                          │
     ├── TSDB 저장              ├── node_cpu_seconds_total
     ├── PromQL 쿼리            ├── container_memory_usage_bytes
     └── AlertManager 연동      └── http_requests_total
```

### Grafana 대시보드 접속

```bash
open http://$(tart ip platform-worker1):30300
# admin / admin
```

---

# 5. 알림 흐름 — AlertManager

```
Prometheus Alert Rule
    │
    ▼
AlertManager
    ├── Grouping (같은 종류 묶기)
    ├── Inhibition (상위 알림 시 하위 억제)
    ├── Silencing (점검 시 알림 중단)
    │
    ▼
Slack / Email / PagerDuty
```

### 알림 규칙 예시

```yaml
- alert: HighCPUUsage
  expr: node_cpu_seconds_total > 0.8
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "CPU 사용률 80% 초과"
```

---

# 6. CI/CD — Jenkins + ArgoCD

### 7단계 파이프라인

```
[개발자 Push]
    │
    ▼
Jenkins (CI)
    ├── 1. Checkout     — 코드 가져오기
    ├── 2. Build        — Docker 이미지 빌드
    ├── 3. Test         — 유닛/통합 테스트
    ├── 4. Scan         — Trivy 보안 스캔
    ├── 5. Push         — Harbor 레지스트리 Push
    │
    ▼
ArgoCD (CD)
    ├── 6. Sync         — Git manifest ↔ K8s 비교
    └── 7. Deploy       — 자동/수동 배포
```

### GitOps 원칙

> Git = **단일 진실 공급원(SSOT)**
> 클러스터 상태 = Git에 선언된 상태

- `git push` → ArgoCD 자동 감지 → 배포
- 수동 변경(kubectl edit) → ArgoCD가 **자동 복원**

---

# 7. 데모 앱 — 6종 마이크로서비스

```
[외부 요청]
    │
    ▼
┌────────┐     ┌─────────┐     ┌────────────┐
│ nginx  │────▶│ httpbin │────▶│ postgresql │
│ (Web)  │     │ (API)   │     │ (DB)       │
└────────┘     └─────────┘     └────────────┘
                    │
              ┌─────┴─────┐
              ▼           ▼
         ┌────────┐  ┌──────────┐
         │ redis  │  │ rabbitmq │
         │(Cache) │  │ (Queue)  │
         └────────┘  └──────────┘
                          │
                     ┌────┴────┐
                     │keycloak │
                     │ (Auth)  │
                     └─────────┘
```

| 앱 | 역할 | HPA 범위 |
|----|------|----------|
| nginx | 웹 프론트엔드 | 2~10 replicas |
| httpbin | REST API | 2~8 replicas |
| postgresql | 관계형 DB | StatefulSet |
| redis | 캐시/세션 | 1~3 replicas |
| rabbitmq | 메시지 큐 | StatefulSet |
| keycloak | OAuth 2.0 인증 | 1~2 replicas |

---

# 7. 오토스케일링 — HPA

### HPA 계산 공식

```
desiredReplicas = ⌈ currentReplicas × (currentMetric / targetMetric) ⌉
```

### 예시: CPU 70% 목표, 현재 3개 Pod, CPU 90%

```
⌈ 3 × (90 / 70) ⌉ = ⌈ 3.86 ⌉ = 4개로 스케일 아웃
```

### PDB — 스케일 다운 시 가용성 보장

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
spec:
  minAvailable: 1       # 최소 1개는 항상 유지
  selector:
    matchLabels:
      app: nginx-web
```

---

# 8. SRE 대시보드

### 6개 페이지 구성

| 페이지 | 기능 |
|--------|------|
| **Overview** | 4개 클러스터 상태 한눈에 |
| **Cluster Detail** | 노드, Pod, 리소스 상세 |
| **Scaling** | HPA 상태, 스케일링 이벤트 |
| **Traffic** | 서비스 간 트래픽 토폴로지 |
| **Load Test** | k6 실행, 결과 실시간 |
| **Jobs** | 백그라운드 수집 상태 |

### 아키텍처

```
[브라우저]  ←→  [Express API (11개)]  ←→  [SSH Pool]  ←→  [4개 클러스터]
                     │
              [Background Jobs]
              (30초마다 메트릭 수집)
```

---

# 9. 보안 — 다층 방어

```
┌──────────────────────────────────────────────┐
│  Layer 1: 네트워크         CiliumNetworkPolicy │
│  Layer 2: 전송 암호화      Istio mTLS          │
│  Layer 3: 시크릿 관리      Sealed Secrets       │
│  Layer 4: 접근 제어        RBAC                 │
│  Layer 5: 정책 강제        OPA Gatekeeper       │
│  Layer 6: 리소스 제한      ResourceQuota        │
│  Layer 7: 이미지 보안      Harbor + Trivy       │
│  Layer 8: 백업             etcd + Velero        │
└──────────────────────────────────────────────┘
```

---

# 9. Sealed Secrets — Git에 시크릿 저장

### 문제: K8s Secret은 base64 (평문이나 다름없음)

```bash
echo "cGFzc3dvcmQ=" | base64 -d    # → "password"
```

### 해결: Sealed Secrets

```
개발자 → kubeseal 암호화 → SealedSecret (Git 안전)
                                    │
                              Sealed Secrets Controller
                                    │
                              K8s Secret (클러스터 내부에서만 복호화)
```

### OPA Gatekeeper — 정책 강제

```
Pod 생성 요청 → API Server → Gatekeeper Webhook
                                    │
                              ConstraintTemplate 검사
                                    │
                              ├── 특권 컨테이너? → 거부
                              ├── 라벨 없음? → 경고
                              └── 통과 → Pod 생성
```

---

# 10. 기술 스택 총정리

| 계층 | 기술 | 용도 |
|------|------|------|
| **가상화** | Tart (Apple Virtualization.framework) | VM 관리 |
| **컨테이너** | containerd + runc | 컨테이너 런타임 |
| **오케스트레이션** | Kubernetes (kubeadm) | 클러스터 관리 |
| **CNI** | Cilium + Hubble | 네트워킹 + 관측 |
| **메시** | Istio + Envoy | 서비스 메시 |
| **모니터링** | Prometheus + Grafana + Loki | 옵저버빌리티 |
| **CI/CD** | Jenkins + ArgoCD | 파이프라인 |
| **보안** | Sealed Secrets, RBAC, Gatekeeper | 다층 방어 |
| **백업** | etcd snapshot + Velero | 재해 복구 |
| **레지스트리** | Harbor + Trivy | 이미지 관리 + 스캔 |
| **IaC** | Bash + Terraform | 인프라 자동화 |
| **대시보드** | React + Express | SRE 운영 |

---

# 빠른 시작

### 1. 설치

```bash
brew install tart kubectl helm jq sshpass
```

### 2. 전체 구축

```bash
git clone <repo-url> tart-infra && cd tart-infra
bash scripts/demo.sh
```

### 3. 상태 확인

```bash
./scripts/status.sh
```

### 4. 서비스 접속

```bash
open http://$(tart ip platform-worker1):30300    # Grafana
open http://$(tart ip platform-worker1):30900    # Jenkins
open http://$(tart ip platform-worker1):30800    # ArgoCD
open http://$(tart ip dev-worker1):30080          # Nginx (dev)
```

---

<!-- _class: lead -->

# 학습 자료

## LEARN/ — 프로젝트 학습 가이드 15개 문서
## guide/ — 실습 가이드 13개 문서
## STUDY_PLAN.md — 5주(25일) 학습 로드맵

---

<!-- _class: lead -->

# Thank You

## Apple Silicon Mac 한 대로
## 프로덕션급 인프라를 경험하다
