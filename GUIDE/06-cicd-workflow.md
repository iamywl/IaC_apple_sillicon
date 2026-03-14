# 재연 가이드 06. CI/CD 파이프라인 운영

이 장에서는 Jenkins CI 파이프라인과 ArgoCD GitOps 워크플로우를 설명한다. Jenkins는 platform 클러스터에서 실행되며, ArgoCD가 dev 클러스터에 애플리케이션을 배포한다.


## 1. Jenkins 파이프라인

### 1.1 접속 및 로그인

- URL: `http://<platform-worker1-ip>:30900`
- 사용자: `admin`
- 비밀번호: `admin`

```bash
PLATFORM_WORKER1_IP=$(tart ip platform-worker1)
open http://$PLATFORM_WORKER1_IP:30900
```

로그인 후 메인 대시보드에서 `demo-pipeline` 작업을 확인한다.

### 1.2 파이프라인 구성

파이프라인 정의 파일: `manifests/jenkins/demo-pipeline.yaml`

이 파일은 ConfigMap으로 Jenkinsfile을 포함한다. 파이프라인은 Kubernetes Agent를 사용하여 Jenkins Pod 내에서 실행된다.

환경 변수:

| 변수 | 값 | 설명 |
|---|---|---|
| `KUBECONFIG` | `/kubeconfig/dev.yaml` | dev 클러스터 접속용 kubeconfig |
| `NAMESPACE` | `demo` | 배포 대상 네임스페이스 |
| `ARGOCD_APP` | `demo-apps` | ArgoCD Application 이름 |

### 1.3 7단계 파이프라인

파이프라인은 7개 스테이지로 구성된다.

#### Stage 1: Validate Manifests (매니페스트 검증)

`manifests/demo/`, `manifests/hpa/`, `manifests/network-policies/` 디렉토리의 모든 YAML 파일에 대해 `kubectl apply --dry-run=client`를 실행한다.

```
=== [1/7] Validating Kubernetes manifests ===
  Checking manifests/demo/nginx-app.yaml...
  Checking manifests/demo/httpbin-app.yaml...
  ...
=== Validation complete (errors: 0) ===
```

하나라도 검증에 실패하면 파이프라인이 중단된다.

#### Stage 2: Security Scan (보안 검사)

세 가지 보안 검사를 수행한다:
1. **하드코딩된 시크릿 탐지**: 매니페스트에서 password, secret, token 패턴을 검색한다
2. **리소스 제한 확인**: 각 매니페스트에 `limits:` 설정이 있는지 확인한다
3. **컨테이너 이미지 태그 확인**: `:latest` 태그 사용 여부를 경고한다

```
=== [2/7] Running security checks ===
--- Checking for hardcoded secrets in manifests ---
  Found 0 potential issues (non-blocking in dev)
--- Checking resource limits ---
  OK: manifests/demo/nginx-app.yaml has resource limits
  ...
--- Checking container image tags ---
=== Security scan complete ===
```

이 스테이지는 dev 환경에서 논블로킹이다. 경고만 출력하고 파이프라인은 계속 진행된다.

#### Stage 3: Deploy to Dev (ArgoCD 배포)

ArgoCD CLI로 `demo-apps` Application의 동기화를 트리거한다.

```
=== [3/7] Triggering ArgoCD sync ===
ArgoCD sync triggered (async)
=== ArgoCD sync initiated ===
```

#### Stage 4: Wait for Rollouts (롤아웃 대기)

6개 디플로이먼트의 롤아웃 완료를 대기한다: `nginx-web`, `httpbin`, `redis`, `postgres`, `rabbitmq`, `keycloak`.

```
=== [4/7] Waiting for all deployments to be ready ===
  Waiting for nginx-web...
    nginx-web: READY
  Waiting for httpbin...
    httpbin: READY
  ...
=== Rollout complete (failed: 0) ===
```

각 디플로이먼트에 180초 타임아웃이 설정되어 있다. 하나라도 실패하면 파이프라인이 중단된다.

#### Stage 5: Health Check (헬스 체크)

배포된 서비스의 전체 상태를 확인한다:
- Pod 상태 (Running/NotReady 수)
- HPA 상태
- Service 목록
- CiliumNetworkPolicy 목록

```
=== [5/7] Verifying service health ===
--- Checking Pod status ---
NAME              READY   STATUS    RESTARTS   AGE
nginx-web-xxx     2/2     Running   0          5m
httpbin-xxx       2/2     Running   0          5m
...
  Non-ready pods: 0
--- Checking HPA status ---
NAME             REFERENCE              TARGETS        MINPODS   MAXPODS   REPLICAS
nginx-web-hpa    Deployment/nginx-web   20%/50%        3         10        3
...
=== Health check complete ===
```

#### Stage 6: Integration Test (통합 테스트)

6개 서비스에 대한 연결 테스트를 수행한다:

| 테스트 | 방법 | 성공 조건 |
|---|---|---|
| nginx (NodePort 30080) | `curl http://<DEV_IP>:30080` | HTTP 200 |
| Keycloak (NodePort 30880) | `curl http://<DEV_IP>:30880` | HTTP 200 |
| httpbin (ClusterIP) | nginx Pod에서 `curl httpbin.demo.svc/get` | HTTP 200 |
| Redis (ClusterIP 6379) | redis Pod에서 `redis-cli ping` | PONG |
| PostgreSQL (ClusterIP 5432) | postgres Pod에서 `pg_isready` | accepting connections |
| RabbitMQ (Management 15672) | nginx Pod에서 `curl -u demo:demo123 rabbitmq:15672/api/overview` | HTTP 200 |

```
=== [6/7] Running integration tests ===
--- Test: nginx (NodePort 30080) ---
  PASS: nginx responds with 200
--- Test: Keycloak (NodePort 30880) ---
  PASS: Keycloak responds
...
=== Integration test results: 6 passed, 0 failed ===
```

하나라도 실패하면 파이프라인이 중단된다.

#### Stage 7: Smoke Test (E2E 스모크 테스트)

서비스 간 통신 경로와 L7 네트워크 정책을 검증한다:
1. nginx → httpbin GET 요청 (허용, HTTP 200 예상)
2. nginx → httpbin POST 요청 (L7 정책에 의해 차단, HTTP 403 예상)
3. Keycloak /health/ready 엔드포인트 확인

```
=== [7/7] Running end-to-end smoke tests ===
--- E2E: Full request chain ---
  Client → nginx → httpbin → [redis + postgres + rabbitmq]
  nginx → httpbin GET: HTTP 200
  nginx → httpbin POST: HTTP 403 (expected: blocked by L7 policy)
  Keycloak health: {"status":"UP"}

=== Pipeline complete ===
=== Deployed services: nginx, httpbin, redis, postgres, rabbitmq, keycloak ===
=== Access points: ===
    nginx:    http://192.168.64.6:30080
    keycloak: http://192.168.64.6:30880
```

### 1.4 파이프라인 실행 방법

#### Jenkins UI에서 실행

1. Jenkins 대시보드에서 `demo-pipeline`을 클릭한다
2. 좌측 메뉴에서 `Build Now`를 클릭한다
3. Build History에서 빌드 번호를 클릭한다
4. `Console Output`에서 실행 로그를 확인한다

#### Pipeline 뷰

빌드 번호 클릭 후 `Pipeline Steps`에서 각 스테이지의 성공/실패 상태를 확인할 수 있다. 각 스테이지는 녹색(성공), 빨간색(실패), 회색(미실행)으로 표시된다.

### 1.5 각 단계 실패 시 대응

| 스테이지 | 실패 원인 | 대응 방법 |
|---|---|---|
| Validate Manifests | YAML 문법 오류, API 버전 불일치 | `kubectl apply --dry-run=client -f <파일>`로 개별 확인 후 수정 |
| Security Scan | (non-blocking) | 경고 내용을 확인하고 필요시 시크릿을 Secret 리소스로 분리 |
| Deploy to Dev | ArgoCD 연결 실패 | ArgoCD Pod 상태 확인, Git 리포지토리 접근 확인 |
| Wait for Rollouts | 이미지 풀 실패, 리소스 부족 | `kubectl describe pod <pod>`, `kubectl get events -n demo` |
| Health Check | Pod CrashLoopBackOff | Pod 로그 확인: `kubectl logs -n demo <pod>` |
| Integration Test | 서비스 미응답 | 해당 서비스의 Pod 상태, Service 엔드포인트, 네트워크 정책 확인 |
| Smoke Test | L7 정책 미적용 | CiliumNetworkPolicy 확인: `kubectl get cnp -n demo` |


## 2. ArgoCD GitOps

### 2.1 접속 및 로그인

- URL: `http://<platform-worker1-ip>:30800`
- 사용자: `admin`
- 비밀번호: 아래 명령으로 확인

```bash
export KUBECONFIG=kubeconfig/platform.yaml
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
echo
```

```bash
PLATFORM_WORKER1_IP=$(tart ip platform-worker1)
open http://$PLATFORM_WORKER1_IP:30800
```

### 2.2 Application 구성

ArgoCD Application 정의: `manifests/argocd/demo-app.yaml`

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: demo-apps
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/iamywl/IaC_apple_sillicon.git
    targetRevision: HEAD
    path: manifests/demo
  destination:
    name: dev-cluster
    namespace: demo
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

주요 설정:
- **source.path**: `manifests/demo` 디렉토리의 모든 YAML을 배포 대상으로 한다
- **destination.name**: `dev-cluster`로 등록된 클러스터에 배포한다
- **prune: true**: Git에서 삭제된 리소스를 클러스터에서도 삭제한다
- **selfHeal: true**: 클러스터에서 수동 변경된 리소스를 Git 상태로 자동 복원한다
- **CreateNamespace=true**: demo 네임스페이스가 없으면 자동 생성한다

### 2.3 Application 상태 확인

ArgoCD UI에서 `demo-apps` Application을 클릭하면 다음을 확인할 수 있다:
- **Sync Status**: `Synced` (Git과 클러스터가 일치) 또는 `OutOfSync` (불일치)
- **Health Status**: `Healthy` (모든 리소스 정상) 또는 `Degraded`/`Progressing`
- **리소스 트리**: 배포된 모든 Deployment, Service, ConfigMap 등의 계층 구조

CLI로 확인:

```bash
export KUBECONFIG=kubeconfig/platform.yaml
kubectl get applications -n argocd
```

예상 출력:

```
NAME        SYNC STATUS   HEALTH STATUS   PROJECT
demo-apps   Synced        Healthy         default
```

상세 정보:

```bash
kubectl get application demo-apps -n argocd -o yaml | grep -A5 status:
```

### 2.4 수동 Sync 방법

자동 동기화가 활성화되어 있지만, 수동으로 트리거할 수도 있다.

#### ArgoCD UI에서

1. `demo-apps` Application 페이지에서 `SYNC` 버튼을 클릭한다
2. Synchronize 옵션을 확인한다:
   - `Prune`: 삭제된 리소스 정리
   - `Force`: 강제 동기화
   - `Apply Out of Sync Only`: 변경된 리소스만 적용
3. `SYNCHRONIZE`를 클릭한다

#### CLI에서

ArgoCD CLI가 설치되어 있다면:

```bash
argocd app sync demo-apps
```

또는 kubectl로 annotation을 추가하여 트리거:

```bash
export KUBECONFIG=kubeconfig/platform.yaml
kubectl annotate application demo-apps -n argocd argocd.argoproj.io/refresh=hard --overwrite
```

### 2.5 Git Push → 자동 배포 흐름

1. `manifests/demo/` 디렉토리의 파일을 수정한다
2. Git commit & push한다

```bash
git add manifests/demo/nginx-app.yaml
git commit -m "update nginx replicas"
git push origin main
```

3. ArgoCD가 Git 변경을 감지한다 (기본 폴링 주기: 3분, webhook 설정 시 즉시)
4. `syncPolicy.automated` 설정에 의해 자동으로 Sync가 시작된다
5. `demo-apps` Application 상태가 `OutOfSync` → `Synced`로 변경된다
6. dev 클러스터에 변경 사항이 반영된다

```bash
# 동기화 상태 확인
export KUBECONFIG=kubeconfig/platform.yaml
kubectl get application demo-apps -n argocd -o jsonpath='{.status.sync.status}'
```

예상 출력:

```
Synced
```

### 2.6 Prune 동작 확인

`prune: true`가 설정되어 있으므로, Git에서 매니페스트를 삭제하면 클러스터에서도 해당 리소스가 삭제된다.

테스트 방법:

1. 임시 매니페스트를 추가하고 push한다

```bash
cat > manifests/demo/test-configmap.yaml << 'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: test-prune
  namespace: demo
data:
  key: value
EOF

git add manifests/demo/test-configmap.yaml
git commit -m "add test configmap for prune verification"
git push origin main
```

2. ArgoCD 동기화 후 리소스가 생성되었는지 확인한다

```bash
export KUBECONFIG=kubeconfig/dev.yaml
kubectl get configmap test-prune -n demo
```

3. 매니페스트를 삭제하고 push한다

```bash
rm manifests/demo/test-configmap.yaml
git add -A
git commit -m "remove test configmap"
git push origin main
```

4. ArgoCD 동기화 후 리소스가 삭제되었는지 확인한다

```bash
kubectl get configmap test-prune -n demo
```

예상 출력:

```
Error from server (NotFound): configmaps "test-prune" not found
```

### 2.7 SelfHeal 동작 확인

`selfHeal: true`가 설정되어 있으므로, 클러스터에서 리소스를 수동으로 변경해도 Git 상태로 자동 복원된다.

테스트 방법:

```bash
export KUBECONFIG=kubeconfig/dev.yaml

# nginx 디플로이먼트의 레플리카를 수동으로 변경한다
kubectl scale deploy nginx-web -n demo --replicas=1
```

ArgoCD가 차이를 감지하고 자동으로 Git에 정의된 레플리카 수로 복원한다. 약간의 시간(수 초~수십 초)이 걸린다.

```bash
# 복원 확인
kubectl get deploy nginx-web -n demo
```

레플리카가 Git에 정의된 원래 값으로 돌아와야 한다.


## 3. 배포 시나리오

### 3.1 새 앱 배포

`manifests/demo/` 디렉토리에 새 YAML 파일을 추가하고 push하면 ArgoCD가 자동으로 배포한다.

예시: echo 서버 배포

```bash
cat > manifests/demo/echo-app.yaml << 'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: echo-server
  namespace: demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: echo-server
  template:
    metadata:
      labels:
        app: echo-server
    spec:
      containers:
        - name: echo
          image: hashicorp/http-echo:latest
          args: ["-text=hello from echo server"]
          ports:
            - containerPort: 5678
          resources:
            requests:
              cpu: 50m
              memory: 32Mi
            limits:
              cpu: 100m
              memory: 64Mi
---
apiVersion: v1
kind: Service
metadata:
  name: echo-server
  namespace: demo
spec:
  type: NodePort
  selector:
    app: echo-server
  ports:
    - port: 5678
      targetPort: 5678
      nodePort: 30567
EOF

git add manifests/demo/echo-app.yaml
git commit -m "add echo server"
git push origin main
```

ArgoCD 동기화 후 확인:

```bash
export KUBECONFIG=kubeconfig/dev.yaml
kubectl get deploy echo-server -n demo
curl http://$DEV_WORKER1_IP:30567
```

예상 출력:

```
hello from echo server
```

### 3.2 롤백

ArgoCD UI에서 이전 Revision으로 복원할 수 있다.

1. `demo-apps` Application 페이지에서 `HISTORY AND ROLLBACK` 버튼을 클릭한다
2. 이전 Revision 목록이 표시된다
3. 원하는 Revision의 `Rollback` 버튼을 클릭한다
4. `Rollback`을 확인한다

롤백하면 자동 동기화가 일시적으로 비활성화된다. Git의 최신 상태로 다시 돌아가려면:

1. Application 설정에서 자동 동기화를 다시 활성화한다
2. 또는 `SYNC` 버튼을 클릭하여 수동으로 최신 상태를 적용한다

### 3.3 Canary 배포

Istio VirtualService를 사용하여 트래픽을 분배한다. 현재 설정은 `manifests/istio/virtual-service.yaml`에 정의되어 있다.

현재 라우팅 규칙:
- `x-canary: true` 헤더가 있는 요청 → httpbin v2로 전달
- 일반 요청 → v1 80%, v2 20% 비율로 분배

#### 가중치 조정

v2 트래픽 비율을 50%로 증가시키는 방법:

```bash
export KUBECONFIG=kubeconfig/dev.yaml
kubectl edit virtualservice httpbin-routing -n demo
```

`weight` 값을 수정한다:

```yaml
- route:
    - destination:
        host: httpbin
        subset: v1
      weight: 50
    - destination:
        host: httpbin
        subset: v2
      weight: 50
```

#### Canary 트래픽 확인

```bash
# 일반 요청 (v1/v2 비율에 따라 분배)
for i in $(seq 1 10); do
  kubectl exec -n demo deploy/nginx-web -c nginx -- \
    curl -sf http://httpbin.demo.svc.cluster.local/get 2>/dev/null | grep -o '"url":[^,]*'
done

# x-canary 헤더로 v2 강제 지정
kubectl exec -n demo deploy/nginx-web -c nginx -- \
  curl -sf -H "x-canary: true" http://httpbin.demo.svc.cluster.local/get
```

#### 전체 트래픽을 v2로 전환

```yaml
- route:
    - destination:
        host: httpbin
        subset: v2
      weight: 100
```

#### v1으로 롤백

```yaml
- route:
    - destination:
        host: httpbin
        subset: v1
      weight: 100
```
