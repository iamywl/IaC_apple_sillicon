# 08. 코드 수정 가이드

이 문서는 자주 있는 수정 시나리오별로 어떤 파일을 수정해야 하는지 안내합니다.

## 시나리오 1: 새 클러스터 추가

### 수정할 파일

1. **config/clusters.json** - 클러스터 정의 추가

```json
{
  "clusters": {
    "newcluster": {
      "podCIDR": "10.50.0.0/16",
      "serviceCIDR": "10.150.0.0/16",
      "nodes": {
        "newcluster-master": { "cpu": 2, "memory": 4096, "role": "master" },
        "newcluster-worker1": { "cpu": 2, "memory": 8192, "role": "worker" }
      }
    }
  }
}
```

2. **확인**: CIDR이 기존 클러스터와 겹치지 않는지 확인

| 기존 | Pod CIDR | Service CIDR |
|------|----------|-------------|
| platform | 10.10.0.0/16 | 10.110.0.0/16 |
| dev | 10.20.0.0/16 | 10.120.0.0/16 |
| staging | 10.30.0.0/16 | 10.130.0.0/16 |
| prod | 10.40.0.0/16 | 10.140.0.0/16 |

3. **실행**: `./scripts/install.sh`가 자동으로 새 클러스터를 포함하여 처리

4. **대시보드**: `dashboard/server/config.ts`가 clusters.json을 읽으므로 자동 반영

## 시나리오 2: VM 리소스 변경

### 수정할 파일

1. **config/clusters.json** - cpu, memory 값 변경

```json
"dev-worker1": { "cpu": 4, "memory": 16384, "role": "worker" }
```

2. **적용**: VM을 재생성해야 합니다

```bash
# 방법 1: 해당 VM만 재생성
tart stop dev-worker1
tart delete dev-worker1
tart clone "$BASE_IMAGE" dev-worker1
tart set dev-worker1 --cpu 4 --memory 16384

# 방법 2: 전체 재설치
./scripts/destroy.sh
./scripts/install.sh
```

## 시나리오 3: 새 데모 앱 배포

### 수정할 파일

1. **manifests/demo/myapp.yaml** 생성

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: demo
  labels:
    app: myapp
spec:
  replicas: 2
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: myapp
          image: myapp:latest
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
---
apiVersion: v1
kind: Service
metadata:
  name: myapp
  namespace: demo
spec:
  type: NodePort
  ports:
    - port: 8080
      nodePort: 30081        # 사용하지 않는 포트 선택
  selector:
    app: myapp
```

2. **네트워크 정책 추가** (필요시): `manifests/network-policies/allow-xxx-to-myapp.yaml`

3. **HPA 추가** (필요시): `manifests/hpa/myapp-hpa.yaml`

4. **적용**:

```bash
export KUBECONFIG=kubeconfig/dev.yaml
kubectl apply -f manifests/demo/myapp.yaml
kubectl apply -f manifests/network-policies/allow-xxx-to-myapp.yaml  # 필요시
kubectl apply -f manifests/hpa/myapp-hpa.yaml  # 필요시
```

## 시나리오 4: 네트워크 정책 추가

### CiliumNetworkPolicy 템플릿

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-A-to-B
  namespace: demo
spec:
  # 대상: B Pod
  endpointSelector:
    matchLabels:
      app: B
  ingress:
    # 출발지: A Pod
    - fromEndpoints:
        - matchLabels:
            app: A
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
          # L7 필터링 (선택)
          rules:
            http:
              - method: "GET"
                path: "/api/.*"    # 정규식 가능
```

### 적용:

```bash
export KUBECONFIG=kubeconfig/dev.yaml
kubectl apply -f manifests/network-policies/allow-A-to-B.yaml
```

### 확인:

대시보드 Traffic 페이지에서 FORWARDED/DROPPED 상태를 확인

## 시나리오 5: 대시보드에 새 페이지 추가

### 1. 페이지 컴포넌트 생성

```typescript
// dashboard/src/pages/MyNewPage.tsx
import { usePolling } from '../hooks/usePolling';

export default function MyNewPage() {
    const data = usePolling('/api/my-endpoint', 5000);

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-4">My New Page</h1>
            {/* 내용 */}
        </div>
    );
}
```

### 2. 라우트 등록

```typescript
// dashboard/src/App.tsx
import MyNewPage from './pages/MyNewPage';

<Routes>
    {/* 기존 라우트들 */}
    <Route path="/my-new" element={<MyNewPage />} />
</Routes>
```

### 3. 사이드바에 링크 추가

```typescript
// dashboard/src/components/layout/Sidebar.tsx
const links = [
    // 기존 링크들
    { path: '/my-new', label: 'My New Page', icon: '...' },
];
```

### 4. 백엔드 API 추가 (필요시)

```typescript
// dashboard/server/index.ts
app.get('/api/my-endpoint', (req, res) => {
    res.json({ /* 데이터 */ });
});
```

## 시나리오 6: 새 데이터 수집기 추가

### 1. Collector 생성

```typescript
// dashboard/server/collectors/mydata.ts
export interface MyData { /* ... */ }

let cache: MyData | null = null;

export async function collect(): Promise<void> {
    // 데이터 수집 로직
    cache = { /* 수집된 데이터 */ };
}

export function getData(): MyData | null {
    return cache;
}
```

### 2. collector.ts에 등록

```typescript
// dashboard/server/collector.ts
import * as mydata from './collectors/mydata';

// 기존 루프에 추가하거나 새 루프 생성
setInterval(() => mydata.collect(), 5000);
```

### 3. API 엔드포인트 추가

```typescript
// dashboard/server/index.ts
import * as mydata from './collectors/mydata';

app.get('/api/mydata', (req, res) => {
    res.json(mydata.getData());
});
```

## 시나리오 7: 알림 규칙 추가

### manifests/alerting/prometheus-rules.yaml에 추가

```yaml
- alert: MyNewAlert
  expr: |
    # PromQL 쿼리
    sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.05
  for: 3m
  labels:
    severity: warning
  annotations:
    summary: "5xx 에러율이 5%를 초과했습니다"
    description: "현재 에러율: {{ $value | humanizePercentage }}"
```

### 적용:

```bash
export KUBECONFIG=kubeconfig/platform.yaml
kubectl apply -f manifests/alerting/prometheus-rules.yaml
```

## 시나리오 8: Istio 트래픽 비율 변경

### manifests/istio/virtual-service.yaml 수정

```yaml
http:
  - route:
      - destination:
          host: httpbin
          subset: v1
        weight: 50        # 50%로 변경 (기존 80%)
      - destination:
          host: httpbin
          subset: v2
        weight: 50        # 50%로 변경 (기존 20%)
```

### 적용:

```bash
export KUBECONFIG=kubeconfig/dev.yaml
kubectl apply -f manifests/istio/virtual-service.yaml
```

## 시나리오 9: 설치 단계 추가

### 1. 스크립트 생성

```bash
# scripts/install/13-my-new-step.sh
#!/bin/bash
source "$(dirname "$0")/../lib/common.sh"
source "$(dirname "$0")/../lib/ssh.sh"
source "$(dirname "$0")/../lib/k8s.sh"

log_phase 13 "My New Step"

# 설치 로직
for cluster in $(get_clusters); do
    log_info "Configuring $cluster..."
    # ...
done

log_success "Phase 13 completed"
```

### 2. install.sh에 등록

```bash
# scripts/install.sh 마지막에 추가
source scripts/install/13-my-new-step.sh
```

### 3. 실행 권한 부여

```bash
chmod +x scripts/install/13-my-new-step.sh
```

## 디버깅 팁

### VM이 시작되지 않을 때

```bash
tart list                     # VM 상태 확인
tart ip <vm-name>             # IP 확인
tart run <vm-name> --no-display &  # 수동 시작
```

### K8s 노드가 NotReady일 때

```bash
export KUBECONFIG=kubeconfig/<cluster>.yaml
kubectl get nodes                           # 노드 상태
kubectl describe node <node-name>           # 상세 정보
ssh admin@<node-ip> "systemctl status kubelet"  # kubelet 상태
```

### Pod가 시작되지 않을 때

```bash
kubectl get pods -n <namespace>             # Pod 상태
kubectl describe pod <pod-name> -n <namespace>  # 이벤트 확인
kubectl logs <pod-name> -n <namespace>      # 로그 확인
```

### 네트워크 정책이 안 먹힐 때

```bash
# Hubble로 트래픽 확인
kubectl -n kube-system exec ds/cilium -- hubble observe \
    --namespace demo --verdict DROPPED

# Cilium 정책 상태 확인
kubectl -n kube-system exec ds/cilium -- cilium policy get
```

### 대시보드가 데이터를 못 가져올 때

```bash
# 백엔드 로그 확인
cd dashboard && npm run dev  # 콘솔 출력 확인

# SSH 연결 확인
ssh admin@<vm-ip> "echo ok"

# kubectl 연결 확인
KUBECONFIG=kubeconfig/<cluster>.yaml kubectl get nodes
```
