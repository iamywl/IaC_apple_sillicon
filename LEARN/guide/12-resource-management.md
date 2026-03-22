# 재연 가이드 12. 리소스 관리 & 레지스트리

이 문서는 Phase 16(ResourceQuota + LimitRange)과 Phase 17(Harbor)을 다룬다. 리소스 사용량을 제어하고, 프라이빗 이미지 레지스트리를 운영하는 방법을 설명한다.


## 1. ResourceQuota — 네임스페이스 리소스 상한

### 1.1 개요

ResourceQuota는 네임스페이스 내에서 사용할 수 있는 총 리소스 양을 제한한다. Pod가 과도하게 생성되거나 리소스를 독점하는 것을 방지한다.

Phase 16에서 dev, staging, prod 클러스터의 demo 네임스페이스에 각각 다른 Quota를 적용한다.

### 1.2 클러스터별 Quota 비교

| 리소스 | dev | staging | prod |
|--------|-----|---------|------|
| requests.cpu | 4 | 2 | 6 |
| requests.memory | 8Gi | 4Gi | 12Gi |
| limits.cpu | 8 | 4 | 12 |
| limits.memory | 16Gi | 8Gi | 24Gi |
| pods | 30 | 20 | 50 |
| services | 15 | 10 | 20 |
| secrets | 20 | 15 | 30 |
| configmaps | 20 | 15 | 30 |
| persistentvolumeclaims | 10 | 5 | 15 |
| services.nodeports | 10 | 5 | 10 |

> dev는 실험 여유가 크고, staging은 제한적이며, prod는 대용량이지만 통제된다.

### 1.3 Quota 확인

```bash
export KUBECONFIG=kubeconfig/dev.yaml

# Quota 요약
kubectl get resourcequota -n demo

# 상세 사용량
kubectl describe resourcequota demo-quota -n demo
```

예상 출력:

```
Name:                   demo-quota
Namespace:              demo
Resource                Used    Hard
--------                ----    ----
configmaps              3       20
limits.cpu              4500m   8
limits.memory           2816Mi  16Gi
persistentvolumeclaims  1       10
pods                    8       30
requests.cpu            1200m   4
requests.memory         1024Mi  8Gi
secrets                 4       20
services                5       15
services.nodeports      2       10
```

### 1.4 Quota 초과 테스트

```bash
# Pod 수 제한 테스트: 31개 Pod 생성 시도 (30개가 상한)
kubectl --kubeconfig kubeconfig/dev.yaml -n demo run test-quota \
  --image=nginx --restart=Never
# 이미 30개 Pod가 있다면 에러 발생:
# Error from server (Forbidden): pods "test-quota" is forbidden:
# exceeded quota: demo-quota, requested: pods=1, used: pods=30, limited: pods=30
```


## 2. LimitRange — 컨테이너 기본 리소스

### 2.1 개요

LimitRange는 리소스 request/limit을 명시하지 않은 컨테이너에 자동으로 기본값을 적용한다. 또한 컨테이너/Pod 단위의 최소/최대 리소스를 강제한다.

### 2.2 클러스터별 LimitRange 비교

| 항목 | dev | staging | prod |
|------|-----|---------|------|
| 기본 CPU limit | 500m | 300m | 500m |
| 기본 memory limit | 512Mi | 384Mi | 512Mi |
| 기본 CPU request | 100m | 100m | 200m |
| 기본 memory request | 128Mi | 128Mi | 256Mi |
| 최대 CPU (컨테이너) | 2 | 1 | 2 |
| 최대 memory (컨테이너) | 2Gi | 1Gi | 2Gi |
| 최소 CPU (컨테이너) | 50m | 50m | 100m |
| 최소 memory (컨테이너) | 64Mi | 64Mi | 128Mi |
| 최대 CPU (Pod) | 4 | 2 | 4 |
| 최대 memory (Pod) | 4Gi | 2Gi | 4Gi |

> staging이 가장 보수적이고, prod는 최소 request가 높다.

### 2.3 LimitRange 확인

```bash
export KUBECONFIG=kubeconfig/dev.yaml

kubectl describe limitrange demo-limitrange -n demo
```

예상 출력:

```
Name:       demo-limitrange
Namespace:  demo
Type        Resource  Min    Max    Default Request  Default Limit
----        --------  ---    ---    ---------------  -------------
Container   cpu       50m    2      100m             500m
Container   memory    64Mi   2Gi    128Mi            512Mi
Pod         cpu       -      4      -                -
Pod         memory    -      4Gi    -                -
```

### 2.4 자동 기본값 적용 확인

리소스를 지정하지 않은 Pod를 생성하면 LimitRange가 자동으로 기본값을 적용한다:

```bash
# 리소스 지정 없이 Pod 생성
kubectl --kubeconfig kubeconfig/dev.yaml run test-limits \
  --image=nginx --restart=Never -n demo

# 자동 적용된 리소스 확인
kubectl --kubeconfig kubeconfig/dev.yaml get pod test-limits -n demo -o jsonpath='{.spec.containers[0].resources}' | jq .

# 정리
kubectl --kubeconfig kubeconfig/dev.yaml delete pod test-limits -n demo
```

예상 출력:

```json
{
  "limits": {
    "cpu": "500m",
    "memory": "512Mi"
  },
  "requests": {
    "cpu": "100m",
    "memory": "128Mi"
  }
}
```


## 3. Harbor — 프라이빗 컨테이너 레지스트리

### 3.1 개요

Harbor는 CNCF 졸업 프로젝트로, 프라이빗 컨테이너 이미지 레지스트리이다. Phase 17에서 platform 클러스터에 설치된다.

주요 기능:
- 이미지 저장 및 배포
- Trivy 취약점 스캔
- RBAC 기반 접근 제어
- 이미지 복제 및 프록시 캐시

### 3.2 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│  platform 클러스터 — harbor 네임스페이스                       │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │  Portal   │  │  Core     │  │ Registry │  │   Trivy      │ │
│  │ :30400   │  │ (API)     │  │ (Storage)│  │ (Vuln Scan)  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────────────┘ │
│       │             │             │                           │
│  ┌────┴─────────────┴─────────────┴──────────────────┐       │
│  │               PostgreSQL + Redis                   │       │
│  └────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────┘
         │
         │ containerd (모든 노드에서 pull 가능)
         ▼
┌──────────────────────┐
│  dev / staging / prod │
│  클러스터 노드들       │
│  image: <ip>:30500/...│
└──────────────────────┘
```

### 3.3 Harbor 접속

- **Portal URL**: `http://<platform-worker1-ip>:30400`
- **관리자**: admin / Harbor12345

```bash
PLATFORM_WORKER1_IP=$(tart ip platform-worker1)

# 접속 확인
curl -sf -o /dev/null -w "%{http_code}" http://$PLATFORM_WORKER1_IP:30400
# 200
```

### 3.4 이미지 Push/Pull

```bash
HARBOR_URL=$(tart ip platform-worker1):30500

# 1. 이미지 태깅
docker tag nginx:alpine $HARBOR_URL/library/nginx:alpine

# 2. Harbor에 Push
docker push $HARBOR_URL/library/nginx:alpine

# 3. K8s에서 Harbor 이미지 사용
kubectl --kubeconfig kubeconfig/dev.yaml -n demo run harbor-test \
  --image=$HARBOR_URL/library/nginx:alpine --restart=Never

# 4. Pod 확인
kubectl --kubeconfig kubeconfig/dev.yaml -n demo get pod harbor-test

# 5. 정리
kubectl --kubeconfig kubeconfig/dev.yaml -n demo delete pod harbor-test
```

### 3.5 Trivy 취약점 스캔

Harbor에 Push된 이미지는 자동으로 Trivy가 취약점을 스캔한다.

1. Harbor Portal(`http://<platform-worker1-ip>:30400`)에 로그인
2. Projects > library 선택
3. 이미지 선택 → 태그 클릭
4. "Vulnerabilities" 탭에서 스캔 결과 확인

### 3.6 containerd 설정

Phase 17에서 모든 노드의 containerd를 Harbor를 trust하도록 자동 설정한다:

```
/etc/containerd/certs.d/<harbor-ip>:30500/hosts.toml
```

이 설정으로 모든 클러스터의 노드에서 Harbor 이미지를 직접 pull할 수 있다.


## 4. 리소스 관리 체크리스트

| 항목 | 구현 | Phase |
|------|------|-------|
| 네임스페이스 리소스 총량 제한 | ResourceQuota | 16 |
| 컨테이너 기본 리소스 자동 적용 | LimitRange | 16 |
| 환경별 차등 리소스 정책 | dev/staging/prod 별도 설정 | 16 |
| 프라이빗 이미지 레지스트리 | Harbor | 17 |
| 이미지 취약점 자동 스캔 | Harbor + Trivy | 17 |
| 전체 클러스터 Harbor 연동 | containerd 자동 설정 | 17 |
| Pod 오토스케일링 | HPA + PDB | 11 |
| 리소스 제한 정책 강제 | OPA Gatekeeper | 14 |
