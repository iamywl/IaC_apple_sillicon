# 07. CI/CD 파이프라인 -- Jenkins와 ArgoCD

> **시리즈**: Apple Silicon Mac 한 대로 만드는 프로덕션급 멀티 클러스터 Kubernetes 인프라
>
> **난이도**: 입문 -- 인프라 경험이 전혀 없어도 괜찮습니다

---

## 이번 글에서 다루는 것

지금까지 우리는 클러스터를 만들고, 네트워크를 연결하고, 애플리케이션을 배포했습니다.
그런데 한 가지 큰 문제가 남아 있습니다.

> "매번 사람이 직접 `kubectl apply`를 쳐야 하나요?"

이번 글에서는 **코드를 푸시하면 자동으로 테스트하고, 자동으로 배포하는 파이프라인**을 만듭니다.

---

## CI/CD가 뭔가요?

### 비유: 자동차 공장의 컨베이어 벨트

자동차를 만든다고 생각해 보세요.

- **수작업 방식**: 한 사람이 부품을 가져오고, 조립하고, 도색하고, 검사하고, 출고한다.
  느리고, 실수가 많고, 한 번에 한 대밖에 못 만든다.
- **컨베이어 벨트 방식**: 각 단계가 자동으로 이어진다. 부품이 들어오면 로봇이 조립하고,
  자동으로 도색 부스로 이동하고, 검사 로봇이 불량을 잡아낸다.

CI/CD는 소프트웨어 세계의 컨베이어 벨트입니다.

| 용어 | 풀네임 | 의미 |
|------|--------|------|
| **CI** | Continuous Integration | 코드 변경 사항을 자동으로 빌드하고 테스트한다 |
| **CD** | Continuous Delivery / Deployment | 테스트를 통과한 코드를 자동으로 배포한다 |

### 왜 이게 필요한가?

수동 배포의 문제점을 나열해 보겠습니다.

1. **사람은 실수한다** -- `kubectl apply -f` 할 때 파일 하나를 빠뜨린다
2. **느리다** -- 6개 서비스를 하나씩 배포하면 30분은 걸린다
3. **추적이 안 된다** -- "누가 언제 뭘 바꿨지?" 아무도 모른다
4. **테스트를 건너뛴다** -- 바쁘면 "이번엔 괜찮겠지" 하고 넘어간다

CI/CD 파이프라인은 이 모든 문제를 해결합니다.
**코드를 Git에 푸시하는 것만으로** 나머지가 전부 자동으로 돌아갑니다.

---

## Jenkins -- 파이프라인의 엔진

### Jenkins가 뭔가요?

Jenkins는 **작업을 자동으로 실행해 주는 로봇**입니다.

- "코드가 바뀌면 테스트를 돌려라"
- "테스트가 통과하면 배포해라"
- "배포가 끝나면 결과를 알려라"

이런 명령을 **파이프라인(Pipeline)**이라는 스크립트로 적어 놓으면,
Jenkins가 시키는 대로 한 단계씩 실행합니다.

### Pipeline이라는 개념

파이프라인은 이름 그대로 "파이프처럼 연결된 단계들"입니다.

```
Stage 1 → Stage 2 → Stage 3 → ... → Stage 7
(검증)    (보안검사)  (배포)          (최종테스트)
```

각 단계(Stage)가 성공해야 다음 단계로 넘어갑니다.
하나라도 실패하면? **파이프라인 전체가 멈추고** 알림을 보냅니다.
이것이 핵심입니다 -- 문제가 있는 코드가 운영에 나가는 것을 **자동으로 막아주는** 것이죠.

---

## ArgoCD -- GitOps의 실현

### ArgoCD가 뭔가요?

ArgoCD는 **Git 저장소를 계속 감시하는 로봇**입니다.

일반적인 배포 방식 (Push 방식):
```
개발자 → (수동으로) → kubectl apply → 클러스터에 반영
```

ArgoCD 방식 (Pull/GitOps 방식):
```
개발자 → Git에 코드 푸시 → ArgoCD가 감지 → 자동으로 클러스터에 반영
```

### GitOps 개념: Git = 진실의 단일 원천 (Single Source of Truth)

GitOps의 핵심 원칙은 간단합니다.

> **"Git에 있는 것이 곧 클러스터에 있어야 할 것이다"**

비유하자면, Git 저장소는 **설계도**이고, ArgoCD는 **현장 감독**입니다.
현장 감독은 항상 설계도를 들여다보면서, 현장(클러스터)이 설계도(Git)와 다르면
자동으로 고칩니다.

이것이 왜 중요한가요?

- 누군가 클러스터에서 직접 뭔가를 바꿔도, ArgoCD가 다시 Git 상태로 되돌린다
- 모든 변경 이력이 Git에 남는다 (누가, 언제, 왜 바꿨는지)
- 문제가 생기면 `git revert` 한 번으로 이전 상태로 돌아갈 수 있다

---

## 실제 프로젝트의 ArgoCD 설정

우리 프로젝트의 ArgoCD Application 매니페스트를 살펴보겠습니다.

> 파일: `manifests/argocd/demo-app.yaml`

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

한 줄씩 뜯어보겠습니다.

| 필드 | 값 | 의미 |
|------|-----|------|
| `source.repoURL` | GitHub 저장소 URL | "이 Git 저장소를 감시해라" |
| `source.path` | `manifests/demo` | "이 폴더에 있는 YAML 파일들을 배포해라" |
| `destination.name` | `dev-cluster` | "dev 클러스터에 배포해라" |
| `destination.namespace` | `demo` | "demo 네임스페이스에 배포해라" |
| `automated.prune` | `true` | Git에서 파일을 삭제하면, 클러스터에서도 삭제한다 |
| `automated.selfHeal` | `true` | 누가 클러스터를 직접 바꿔도, Git 상태로 자동 복구한다 |
| `CreateNamespace` | `true` | demo 네임스페이스가 없으면 자동으로 만든다 |

### prune와 selfHeal이 왜 중요한가?

**prune (가지치기)**:
Git에서 `redis-deployment.yaml`을 삭제했다고 합시다.
prune가 꺼져 있으면 클러스터에 Redis가 좀비처럼 남아 있습니다.
prune가 켜져 있으면 ArgoCD가 "Git에 없으니 삭제해야겠다"하고 자동으로 정리합니다.

**selfHeal (자가 치유)**:
새벽 3시에 당직자가 급한 마음에 `kubectl edit`로 직접 설정을 바꿨다고 합시다.
selfHeal이 켜져 있으면 ArgoCD가 "설계도(Git)와 다르네?" 하고 원래대로 되돌립니다.
이렇게 하면 "아무도 모르게 바뀐 설정" 때문에 장애가 나는 일을 방지할 수 있습니다.

---

## 7단계 Jenkins 파이프라인 상세 분석

우리 프로젝트의 파이프라인은 총 **7단계**로 구성됩니다.

> 파일: `manifests/jenkins/demo-pipeline.yaml`

전체 흐름을 먼저 그림으로 보겠습니다.

```
Git Push
  │
  ▼
┌─────────────────────┐
│ 1. Validate         │  매니페스트 문법 검사
│    Manifests        │
├─────────────────────┤
│ 2. Security Scan    │  보안 취약점 검사
├─────────────────────┤
│ 3. Deploy to Dev    │  ArgoCD로 배포
├─────────────────────┤
│ 4. Wait for         │  6개 서비스 롤아웃 대기
│    Rollouts         │
├─────────────────────┤
│ 5. Health Check     │  Pod, HPA, Service 상태 확인
├─────────────────────┤
│ 6. Integration Test │  각 서비스 개별 테스트
├─────────────────────┤
│ 7. Smoke Test       │  전체 체인 E2E 테스트
└─────────────────────┘
  │
  ▼
배포 완료!
```

---

### Stage 1: Validate Manifests (매니페스트 검증)

```groovy
stage('Validate Manifests') {
  steps {
    sh '''
      echo "=== [1/7] Validating Kubernetes manifests ==="
      ERRORS=0
      for f in manifests/demo/*.yaml manifests/hpa/*.yaml manifests/network-policies/*.yaml; do
        echo "  Checking $f..."
        if ! kubectl apply --dry-run=client -f "$f" 2>&1; then
          ERRORS=$((ERRORS + 1))
        fi
      done
      echo "=== Validation complete (errors: $ERRORS) ==="
      [ $ERRORS -eq 0 ] || exit 1
    '''
  }
}
```

**비유**: 건물을 짓기 전에 설계도에 오류가 없는지 확인하는 것과 같습니다.

핵심은 `kubectl apply --dry-run=client`입니다.
`--dry-run=client`는 "실제로 적용하지 말고, 적용할 수 있는지만 확인해라"라는 뜻입니다.

- YAML 문법이 틀렸다면? 여기서 잡힙니다.
- 필수 필드가 빠졌다면? 여기서 잡힙니다.
- 리소스 타입이 잘못되었다면? 여기서 잡힙니다.

에러가 하나라도 있으면 (`[ $ERRORS -eq 0 ] || exit 1`) 파이프라인이 즉시 멈춥니다.

---

### Stage 2: Security Scan (보안 검사)

```groovy
stage('Security Scan') {
  steps {
    sh '''
      echo "=== [2/7] Running security checks ==="

      echo "--- Checking for hardcoded secrets in manifests ---"
      ISSUES=0
      for f in manifests/demo/*.yaml; do
        if grep -qiE '(password|secret|token).*:.*[A-Za-z0-9]{8,}' "$f" 2>/dev/null; then
          echo "  WARNING: Potential secret in $f"
          ISSUES=$((ISSUES + 1))
        fi
      done

      echo "--- Checking resource limits ---"
      for f in manifests/demo/*.yaml; do
        if grep -q 'limits:' "$f"; then
          echo "  OK: $f has resource limits"
        else
          echo "  WARN: $f missing resource limits"
        fi
      done

      echo "--- Checking container image tags ---"
      for f in manifests/demo/*.yaml; do
        if grep -qE 'image:.*:latest' "$f"; then
          echo "  WARN: $f uses :latest tag"
        fi
      done

      echo "=== Security scan complete ==="
    '''
  }
}
```

이 단계에서는 3가지를 검사합니다.

**1. 하드코딩된 시크릿 검사**

YAML 파일에 비밀번호가 그대로 적혀 있으면 큰 문제입니다.
`password: MyS3cretP@ss`처럼 적혀 있으면 Git에 비밀번호가 올라가는 것이니까요.
정규식 `(password|secret|token).*:.*[A-Za-z0-9]{8,}`으로 이런 패턴을 찾습니다.

**2. 리소스 제한(Resource Limits) 검사**

컨테이너에 CPU/메모리 제한이 없으면 어떻게 될까요?
하나의 파드가 노드의 자원을 전부 먹어버려서 다른 파드가 죽을 수 있습니다.
비유하자면, 뷔페에서 한 사람이 음식을 전부 가져가는 것과 같습니다.

**3. `:latest` 태그 검사**

`image: nginx:latest`는 위험합니다.
"최신 버전"은 시간에 따라 바뀌기 때문에, 어제 잘 되던 배포가 오늘은 깨질 수 있습니다.
`image: nginx:1.25.3`처럼 정확한 버전을 쓰는 것이 안전합니다.

---

### Stage 3: Deploy to Dev (ArgoCD로 배포)

```groovy
stage('Deploy to Dev') {
  steps {
    sh '''
      echo "=== [3/7] Triggering ArgoCD sync ==="
      argocd app sync ${ARGOCD_APP} --timeout 180 || echo "ArgoCD sync triggered (async)"
      echo "=== ArgoCD sync initiated ==="
    '''
  }
}
```

이 단계는 놀랍도록 간단합니다. 단 한 줄입니다.

`argocd app sync demo-apps` -- ArgoCD에게 "지금 즉시 Git과 동기화해라"라고 명령합니다.

앞서 본 ArgoCD 설정에서 `automated: true`로 해 놓았으므로
사실 기다리면 자동으로 동기화됩니다.
하지만 파이프라인에서는 "지금 당장" 동기화를 원하므로 명시적으로 sync 명령을 내립니다.

`--timeout 180`은 최대 3분간 기다린다는 뜻입니다.

---

### Stage 4: Wait for Rollouts (롤아웃 대기)

```groovy
stage('Wait for Rollouts') {
  steps {
    sh '''
      echo "=== [4/7] Waiting for all deployments to be ready ==="
      DEPLOYMENTS="nginx-web httpbin redis postgres rabbitmq keycloak"
      FAILED=0
      for deploy in $DEPLOYMENTS; do
        echo "  Waiting for $deploy..."
        if kubectl -n ${NAMESPACE} rollout status deploy/$deploy --timeout=180s; then
          echo "    $deploy: READY"
        else
          echo "    $deploy: FAILED or NOT FOUND"
          FAILED=$((FAILED + 1))
        fi
      done
      echo "=== Rollout complete (failed: $FAILED) ==="
      [ $FAILED -eq 0 ] || exit 1
    '''
  }
}
```

**비유**: 식당에서 6가지 요리를 주문했다면, 모든 요리가 나올 때까지 기다리는 것과 같습니다.

`kubectl rollout status`는 디플로이먼트의 모든 파드가 Running 상태가 될 때까지
기다립니다. 6개 서비스 모두를 확인합니다.

| 서비스 | 역할 |
|--------|------|
| nginx-web | 웹 서버 (프론트 엔드 역할) |
| httpbin | API 서버 (백엔드 역할) |
| redis | 캐시 서버 |
| postgres | 데이터베이스 |
| rabbitmq | 메시지 큐 |
| keycloak | 인증 서버 |

하나라도 180초(3분) 안에 Ready가 되지 않으면 파이프라인이 실패합니다.

---

### Stage 5: Health Check (상태 확인)

```groovy
stage('Health Check') {
  steps {
    sh '''
      echo "=== [5/7] Verifying service health ==="

      echo "--- Checking Pod status ---"
      kubectl -n ${NAMESPACE} get pods -o wide

      echo "--- Checking HPA status ---"
      kubectl -n ${NAMESPACE} get hpa

      echo "--- Checking Services ---"
      kubectl -n ${NAMESPACE} get svc

      echo "--- Checking Network Policies ---"
      kubectl -n ${NAMESPACE} get cnp 2>/dev/null || echo "(CiliumNetworkPolicy CRD not available)"

      echo "=== Health check complete ==="
    '''
  }
}
```

파드가 Running이라고 해서 모든 것이 정상인 것은 아닙니다.
이 단계에서는 더 넓은 범위를 확인합니다.

- **Pod 상태**: 모든 파드가 Running인지, 재시작(Restart)이 반복되지는 않는지
- **HPA 상태**: 오토스케일러가 정상적으로 CPU 메트릭을 수집하고 있는지
- **Service 상태**: 서비스 엔드포인트가 제대로 연결되어 있는지
- **Network Policy**: CiliumNetworkPolicy가 올바르게 적용되었는지

이 정보들은 파이프라인 로그에 남아서, 나중에 문제가 생겼을 때 디버깅 자료로 쓸 수 있습니다.

---

### Stage 6: Integration Test (통합 테스트)

```groovy
stage('Integration Test') {
  steps {
    sh '''
      echo "=== [6/7] Running integration tests ==="
      DEV_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
      PASS=0; FAIL=0

      # Test 1: nginx web server
      echo "--- Test: nginx (NodePort 30080) ---"
      if curl -sf --max-time 10 "http://${DEV_IP}:30080" > /dev/null; then
        echo "  PASS: nginx responds with 200"
        PASS=$((PASS + 1))
      else
        echo "  FAIL: nginx not responding"
        FAIL=$((FAIL + 1))
      fi

      # Test 2: Keycloak admin console
      echo "--- Test: Keycloak (NodePort 30880) ---"
      if curl -sf --max-time 15 "http://${DEV_IP}:30880" > /dev/null; then
        echo "  PASS: Keycloak responds"
        PASS=$((PASS + 1))
      else
        echo "  FAIL: Keycloak not responding"
        FAIL=$((FAIL + 1))
      fi

      # ... Redis, PostgreSQL, RabbitMQ 등 총 6개 테스트

      echo "=== Integration test results: $PASS passed, $FAIL failed ==="
      [ $FAIL -eq 0 ] || exit 1
    '''
  }
}
```

**비유**: 자동차를 조립한 후, 각 부품이 제대로 동작하는지 하나씩 테스트하는 것입니다.
엔진 시동이 걸리는지, 브레이크가 작동하는지, 라이트가 켜지는지 각각 확인합니다.

이 단계에서 수행하는 6개의 테스트를 정리하면 다음과 같습니다.

| 테스트 | 대상 | 방법 | 확인 내용 |
|--------|------|------|-----------|
| 1 | nginx | NodePort 30080으로 HTTP 요청 | 웹 서버가 응답하는지 |
| 2 | Keycloak | NodePort 30880으로 HTTP 요청 | 인증 서버가 응답하는지 |
| 3 | httpbin | nginx에서 ClusterIP로 내부 호출 | 내부 통신이 되는지 |
| 4 | Redis | redis-cli ping | 캐시 서버가 살아있는지 |
| 5 | PostgreSQL | pg_isready | DB가 연결을 받는지 |
| 6 | RabbitMQ | Management API 호출 | 메시지 큐가 동작하는지 |

주목할 점: httpbin 테스트는 `kubectl exec deploy/nginx-web` 방식으로,
**nginx 파드 안에서 httpbin으로 curl을 날립니다**.
이것은 클러스터 **내부 통신**이 정상인지 확인하는 것입니다.

---

### Stage 7: Smoke Test (연기 테스트 -- 전체 체인 E2E 검증)

```groovy
stage('Smoke Test') {
  steps {
    sh '''
      echo "=== [7/7] Running end-to-end smoke tests ==="

      echo "--- E2E: Full request chain ---"
      echo "  Client -> nginx -> httpbin -> [redis + postgres + rabbitmq]"

      # L7 정책 검증: GET은 허용
      HTTP_CODE=$(kubectl -n ${NAMESPACE} exec deploy/nginx-web -c nginx -- \
        curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
        "http://httpbin.${NAMESPACE}.svc.cluster.local/get" || echo "000")
      echo "  nginx -> httpbin GET: HTTP $HTTP_CODE"

      # L7 정책 검증: POST는 차단
      HTTP_CODE_POST=$(kubectl -n ${NAMESPACE} exec deploy/nginx-web -c nginx -- \
        curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST \
        "http://httpbin.${NAMESPACE}.svc.cluster.local/post" || echo "000")
      echo "  nginx -> httpbin POST: HTTP $HTTP_CODE_POST (expected: blocked by L7 policy)"

      echo "=== Pipeline complete ==="
    '''
  }
}
```

**"Smoke Test"란?** 전자 제품을 처음 켤 때 연기가 나면 큰 문제가 있다는 뜻에서
유래한 이름입니다. "전원을 넣었을 때 연기가 나지 않는지" 확인하는, 가장 기본적인 테스트입니다.

이 단계에서 가장 중요한 것은 **L7 (Layer 7) 네트워크 정책 검증**입니다.

```
nginx → httpbin GET  → 200 OK  (허용됨 -- 네트워크 정책에서 GET만 허용)
nginx → httpbin POST → 403/000 (차단됨 -- 네트워크 정책에서 POST 차단)
```

GET 요청은 되지만 POST 요청은 차단된다는 것을 확인합니다.
이것은 단순히 "서비스가 살아있는지"를 넘어서,
**보안 정책이 제대로 적용되어 있는지**까지 검증하는 것입니다.

---

## 파이프라인이 실패하면?

```groovy
post {
  success {
    echo "Pipeline SUCCESS: All 7 stages passed. Application fully deployed and verified."
  }
  failure {
    echo "Pipeline FAILED: Check stage logs for details."
  }
  always {
    echo "Pipeline finished: ${currentBuild.result ?: 'SUCCESS'}"
  }
}
```

Jenkins는 파이프라인 결과를 3가지로 나누어 처리합니다.

- `success`: 7단계 모두 통과 -- 배포가 완료되었다는 메시지 출력
- `failure`: 하나라도 실패 -- 어떤 단계에서 실패했는지 로그를 확인하라는 메시지 출력
- `always`: 성공이든 실패든 항상 실행 -- 최종 결과를 기록

실제 프로덕션에서는 `failure` 블록에 Slack 알림이나 이메일 발송을 추가합니다.
새벽 3시에 배포가 실패하면 담당자에게 즉시 알림이 가도록 하는 것이죠.

---

## 전체 흐름 정리

```
개발자가 Git에 코드 푸시
       │
       ▼
  Jenkins가 감지
       │
       ├── 1. YAML 문법 검사 (dry-run)
       ├── 2. 보안 검사 (시크릿, 리소스 제한, 이미지 태그)
       ├── 3. ArgoCD에 배포 명령
       ├── 4. 6개 서비스 롤아웃 대기
       ├── 5. 전체 시스템 상태 점검
       ├── 6. 서비스별 개별 테스트
       └── 7. 전체 체인 E2E + 보안 정책 테스트
       │
       ▼
  모두 통과 → 배포 완료!
  하나라도 실패 → 파이프라인 중단, 알림 발송
```

---

## 실제 프로젝트에서는

### Jenkins 파이프라인은 어떻게 확장되나요?

실제 기업 환경에서는 이 7단계에 더 많은 것들이 추가됩니다.

- **Docker 이미지 빌드**: 소스 코드를 컨테이너 이미지로 만드는 단계
- **이미지 취약점 스캔**: Trivy, Snyk 같은 도구로 컨테이너 이미지의 보안 취약점 검사
- **스테이징 환경 배포**: dev에서 성공하면 staging으로, staging에서 성공하면 production으로
- **승인 게이트**: production 배포 전에 관리자의 수동 승인을 받는 단계
- **카나리 배포**: 전체 사용자의 5%에게만 먼저 배포해서 문제를 확인하는 방식

### GitOps를 쓰면 뭐가 달라지나요?

전통적인 배포와 GitOps의 가장 큰 차이는 **감사 추적(Audit Trail)**입니다.

```bash
# 전통적 배포: "누가 바꿨어?" -- 알 수 없음
$ kubectl get deployment nginx-web -o yaml
# ... 바뀌어 있는데 누가 바꿨는지 모름

# GitOps: Git 로그에 다 기록되어 있음
$ git log --oneline manifests/demo/
a1b2c3d feat: nginx replica 3 -> 5 for holiday traffic (by 김개발)
e4f5g6h fix: update postgres image to 15.4 for CVE patch (by 이보안)
```

모든 변경에 "누가, 언제, 왜" 바꿨는지가 기록됩니다.
장애가 나면 `git log`만 보면 원인을 찾을 수 있습니다.

---

## 핵심 요약

| 개념 | 한 줄 정리 |
|------|-----------|
| CI/CD | 코드 변경을 자동으로 테스트하고 배포하는 컨베이어 벨트 |
| Jenkins | 파이프라인을 실행해 주는 자동화 엔진 |
| ArgoCD | Git을 감시하고, 클러스터를 Git 상태로 유지하는 도구 |
| GitOps | "Git에 있는 것 = 클러스터에 있어야 할 것" |
| Pipeline | 순서대로 실행되는 단계들의 묶음 (하나 실패하면 전체 중단) |
| dry-run | 실제 실행 없이 "실행 가능한지"만 확인 |
| prune | Git에서 삭제된 리소스를 클러스터에서도 자동 삭제 |
| selfHeal | 클러스터 상태가 Git과 다르면 자동 복구 |

---

## 관련 파일

```
manifests/jenkins/demo-pipeline.yaml   ← Jenkins 파이프라인 정의 (7단계)
manifests/argocd/demo-app.yaml         ← ArgoCD Application 정의 (GitOps 설정)
```

---

> **다음 글**: [08. 네트워크 보안 -- 제로 트러스트와 CiliumNetworkPolicy](08-network-security.md)
>
> 파이프라인의 7번째 단계에서 "L7 정책이 POST를 차단하는지" 확인했습니다.
> 다음 글에서는 이 네트워크 보안 정책이 정확히 어떻게 동작하는지 하나씩 파헤칩니다.
