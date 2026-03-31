# CKAD Day 6: Blue/Green, Canary 배포와 Deployment 실전 문제

> CKAD 도메인: Application Deployment (20%) - Part 1b | 예상 소요 시간: 1시간

---

## 오늘의 학습 목표

- [ ] Blue/Green 배포 전략을 Service selector 변경으로 구현할 수 있다
- [ ] Canary 배포를 두 Deployment + 공통 label Service로 구현할 수 있다
- [ ] Deployment 관련 실전 문제를 풀 수 있다

---

## 1. Blue/Green 배포

### 1.1 Blue/Green이란?

**등장 배경:**
RollingUpdate는 업데이트 중 이전 버전과 새 버전이 일시적으로 공존한다. API 변경이 있거나 DB 스키마가 달라지면 두 버전이 동시에 트래픽을 처리하는 것이 문제가 된다. Blue/Green 배포는 새 버전을 완전히 준비하고 검증한 뒤, 트래픽을 한 번에 전환하여 이 문제를 해결한다. 전환이 실패하면 selector만 되돌리면 되므로 롤백이 즉시 가능하다.

**공학적 정의:**
Blue/Green 배포는 동일한 프로덕션 환경을 두 벌(Blue=현재, Green=신규) 유지하고, Service의 selector를 변경하여 트래픽을 즉시 전환하는 릴리스 전략이다. 전환이 즉시 이루어지므로 다운타임이 없고, 문제 발생 시 selector를 원래 값으로 변경하여 즉시 롤백이 가능하다.

**내부 동작 원리 심화:**
Service의 selector를 변경하면 Endpoints Controller가 즉시 매칭되는 Pod IP 목록을 재계산한다. kube-proxy는 Endpoints 변경을 감지하여 iptables 또는 IPVS 규칙을 업데이트한다. 이 과정은 수 초 내에 완료되지만, 기존 TCP 연결은 즉시 끊기지 않는다. 따라서 완전한 전환까지는 기존 연결의 graceful close가 필요하다.

### 1.2 Blue/Green 구현

```yaml
# Blue Deployment (현재 운영)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-blue
  namespace: demo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      version: blue
  template:
    metadata:
      labels:
        app: myapp
        version: blue
    spec:
      containers:
        - name: app
          image: myapp:v1.0
          ports:
            - containerPort: 80
---
# Green Deployment (새 버전)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-green
  namespace: demo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      version: green
  template:
    metadata:
      labels:
        app: myapp
        version: green
    spec:
      containers:
        - name: app
          image: myapp:v2.0
          ports:
            - containerPort: 80
---
# Service (Blue를 가리킴)
apiVersion: v1
kind: Service
metadata:
  name: myapp-svc
  namespace: demo
spec:
  selector:
    app: myapp
    version: blue               # Blue를 가리킴
  ports:
    - port: 80
      targetPort: 80
```

```bash
# 1. Green Deployment 배포 및 검증
kubectl get pods -l version=green -n demo
```

검증:
```text
NAME                         READY   STATUS    RESTARTS   AGE
app-green-xxxxxxxxx-aaaaa    1/1     Running   0          30s
app-green-xxxxxxxxx-bbbbb    1/1     Running   0          30s
app-green-xxxxxxxxx-ccccc    1/1     Running   0          30s
```

```bash
# 2. 트래픽 전환: Blue -> Green
kubectl patch service myapp-svc -n demo \
  -p '{"spec":{"selector":{"version":"green"}}}'
```

검증:
```text
service/myapp-svc patched
```

```bash
# 3. Endpoints 확인 (Green Pod IP가 표시되어야 한다)
kubectl get endpoints myapp-svc -n demo
```

검증:
```text
NAME        ENDPOINTS                                   AGE
myapp-svc   10.244.1.10:80,10.244.1.11:80,10.244.1.12:80   5m
```

```bash
# 4. 문제 시 롤백: Green -> Blue
kubectl patch service myapp-svc -n demo \
  -p '{"spec":{"selector":{"version":"blue"}}}'
```

### 1.3 Blue/Green 배포 흐름

```
[Blue/Green 배포 과정]

Phase 1: Blue 운영 중
  [Service] --selector: version=blue--> [Blue Deployment (v1.0)]
                                        [Green Deployment (배포 안 됨)]

Phase 2: Green 배포 및 검증
  [Service] --selector: version=blue--> [Blue Deployment (v1.0)]
                                        [Green Deployment (v2.0)] <- 테스트

Phase 3: 트래픽 전환
  [Service] --selector: version=green--> [Green Deployment (v2.0)]
                                         [Blue Deployment (v1.0)] <- 대기

Phase 4: Blue 정리 (안정화 후)
  [Service] --selector: version=green--> [Green Deployment (v2.0)]
  kubectl delete deployment app-blue
```

---

## 2. Canary 배포

### 2.1 Canary란?

**등장 배경:**
Blue/Green은 100% 트래픽을 한 번에 전환하므로, 새 버전에 잠재적 문제가 있으면 전체 사용자에게 영향을 준다. Canary 배포는 "탄광의 카나리아"에서 이름을 딴 전략으로, 소수의 사용자에게만 새 버전을 노출하여 위험을 최소화한다. 문제가 없으면 점진적으로 새 버전의 비율을 높이고, 문제가 발견되면 Canary Pod만 제거하면 된다.

**공학적 정의:**
Canary 배포는 새 버전(Canary)을 소수의 Pod로 배포하고, Service selector가 기존 버전과 새 버전 Pod를 모두 선택하도록 하여 트래픽의 일부(Pod 비율에 따라)를 새 버전으로 전달하는 점진적 릴리스 전략이다. Canary Pod의 메트릭을 모니터링하여 문제가 없으면 점진적으로 확대하고, 문제가 있으면 Canary를 즉시 제거한다.

**내부 동작 원리 심화:**
순수 쿠버네티스 Canary에서 트래픽 비율은 Endpoints에 등록된 Pod 수에 의존한다. kube-proxy는 iptables 모드에서 random probability를 사용하여 Pod를 선택하므로, stable 4개 + canary 1개면 약 80/20 비율이 된다. 단, 이 비율은 확률적이므로 요청 수가 적으면 정확하지 않다. 정밀한 트래픽 제어가 필요하면 Istio VirtualService의 weight 필드를 사용한다.

### 2.2 Canary 구현

```yaml
# Stable Deployment (기존 운영)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-stable
  namespace: demo
spec:
  replicas: 4                    # 안정 버전 4개
  selector:
    matchLabels:
      app: web
      version: stable
  template:
    metadata:
      labels:
        app: web                 # Service selector와 일치
        version: stable
    spec:
      containers:
        - name: app
          image: myapp:v1.0
          ports:
            - containerPort: 80
---
# Canary Deployment (새 버전, 소수)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-canary
  namespace: demo
spec:
  replicas: 1                    # Canary 1개 = 20% 트래픽
  selector:
    matchLabels:
      app: web
      version: canary
  template:
    metadata:
      labels:
        app: web                 # Service selector와 일치 (같은 app 레이블)
        version: canary
    spec:
      containers:
        - name: app
          image: myapp:v2.0
          ports:
            - containerPort: 80
---
# Service: app=web만 selector (version 포함 안 함!)
apiVersion: v1
kind: Service
metadata:
  name: web-svc
  namespace: demo
spec:
  selector:
    app: web                     # version을 포함하지 않아 양쪽 모두 선택
  ports:
    - port: 80
      targetPort: 80
```

### 2.3 Canary 배포 흐름

```
[Canary 배포 과정]

Phase 1: Stable만 운영 (replicas=4)
  [Service: app=web] --> [Stable Pod-1] [Stable Pod-2] [Stable Pod-3] [Stable Pod-4]
  100% 트래픽 -> v1.0

Phase 2: Canary 배포 (replicas=1)
  [Service: app=web] --> [Stable x4] [Canary x1]
  80% -> v1.0, 20% -> v2.0

Phase 3: 모니터링 후 확대
  [Service: app=web] --> [Stable x2] [Canary x3]
  40% -> v1.0, 60% -> v2.0

Phase 4: 완전 전환
  [Service: app=web] --> [Canary x4] (= 새 Stable)
  kubectl delete deployment web-stable
  100% -> v2.0
```

```bash
# Canary 확대
kubectl scale deployment web-canary --replicas=2 -n demo
kubectl scale deployment web-stable --replicas=3 -n demo

# Canary 제거 (문제 발생 시)
kubectl delete deployment web-canary -n demo

# Canary 완전 전환
kubectl scale deployment web-canary --replicas=4 -n demo
kubectl delete deployment web-stable -n demo
```

---

## 3. 배포 전략 비교

### 3.1 RollingUpdate vs Blue/Green vs Canary

| 항목 | RollingUpdate | Blue/Green | Canary |
|------|-------------|------------|--------|
| 다운타임 | 없음 | 없음 | 없음 |
| 리소스 사용 | 1x + maxSurge | 2x (두 벌) | 1x + 소수 |
| 롤백 속도 | 느림 (재배포) | 즉시 (selector 변경) | 빠름 (Canary 삭제) |
| 트래픽 제어 | 불가 | 즉시 전환 | Pod 비율로 제어 |
| 복잡도 | 낮음 (내장) | 중간 | 중간 |
| 시험 출제 | 높음 | 중간 | 중간 |

---

## 4. 실전 시험 문제 (12문제)

### 문제 1. Deployment 생성

다음 조건의 Deployment를 생성하라.

- 이름: `app-deploy`, 네임스페이스: `exam`
- 이미지: `nginx:1.24`, replicas: 3
- Label: `app=web`

<details><summary>풀이</summary>

```bash
kubectl create namespace exam
kubectl create deployment app-deploy \
  --image=nginx:1.24 --replicas=3 -n exam
```

검증:
```bash
kubectl get deployment app-deploy -n exam
```

```text
NAME         READY   UP-TO-DATE   AVAILABLE   AGE
app-deploy   3/3     3            3           30s
```

**핵심**: `kubectl create deployment`은 자동으로 selector와 template label을 설정한다.

</details>

---

### 문제 2. RollingUpdate 전략 설정

`app-deploy`에 다음 전략을 설정하라.

- type: RollingUpdate
- maxSurge: 2
- maxUnavailable: 1

<details><summary>풀이</summary>

```bash
kubectl patch deployment app-deploy -n exam -p \
  '{"spec":{"strategy":{"type":"RollingUpdate","rollingUpdate":{"maxSurge":2,"maxUnavailable":1}}}}'
```

```bash
kubectl get deployment app-deploy -n exam -o jsonpath='{.spec.strategy}'
```

</details>

---

### 문제 3. 이미지 업데이트

`app-deploy`의 이미지를 `nginx:1.25`로 업데이트하고 롤아웃 상태를 확인하라.

<details><summary>풀이</summary>

```bash
kubectl set image deployment/app-deploy nginx=nginx:1.25 -n exam
kubectl rollout status deployment/app-deploy -n exam
```

```bash
kubectl get deployment app-deploy -n exam -o jsonpath='{.spec.template.spec.containers[0].image}'
# nginx:1.25
```

</details>

---

### 문제 4. Rollback

`app-deploy`를 `nginx:invalid`로 업데이트한 후 이전 버전으로 롤백하라.

<details><summary>풀이</summary>

```bash
# 잘못된 이미지로 업데이트
kubectl set image deployment/app-deploy nginx=nginx:invalid -n exam

# 실패 확인
kubectl rollout status deployment/app-deploy -n exam --timeout=30s

# 이력 확인
kubectl rollout history deployment/app-deploy -n exam

# 롤백
kubectl rollout undo deployment/app-deploy -n exam

# 성공 확인
kubectl rollout status deployment/app-deploy -n exam
kubectl get deployment app-deploy -n exam -o jsonpath='{.spec.template.spec.containers[0].image}'
# nginx:1.25
```

</details>

---

### 문제 5. 특정 Revision으로 롤백

`app-deploy`의 revision 1으로 롤백하라.

<details><summary>풀이</summary>

```bash
# revision 확인
kubectl rollout history deployment/app-deploy -n exam

# revision 1로 롤백
kubectl rollout undo deployment/app-deploy --to-revision=1 -n exam

# 확인
kubectl rollout status deployment/app-deploy -n exam
kubectl get deployment app-deploy -n exam -o jsonpath='{.spec.template.spec.containers[0].image}'
# nginx:1.24
```

</details>

---

### 문제 6. Recreate 전략

Recreate 전략을 사용하는 Deployment를 생성하라.

- 이름: `batch-deploy`, replicas: 2
- 이미지: `busybox:1.36`, 명령: `sleep 3600`
- strategy: Recreate

<details><summary>풀이</summary>

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: batch-deploy
  namespace: exam
spec:
  replicas: 2
  selector:
    matchLabels:
      app: batch-deploy
  strategy:
    type: Recreate
  template:
    metadata:
      labels:
        app: batch-deploy
    spec:
      containers:
        - name: app
          image: busybox:1.36
          command: ["sh", "-c", "sleep 3600"]
```

</details>

---

### 문제 7. Blue/Green 배포

Blue/Green 배포를 구현하라.

- Blue: `app-blue` (nginx:1.24, replicas=2, labels: app=myapp, version=blue)
- Green: `app-green` (nginx:1.25, replicas=2, labels: app=myapp, version=green)
- Service `myapp-svc`: 처음에 Blue를 가리키고, Green으로 전환하라

<details><summary>풀이</summary>

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-blue
  namespace: exam
spec:
  replicas: 2
  selector:
    matchLabels:
      app: myapp
      version: blue
  template:
    metadata:
      labels:
        app: myapp
        version: blue
    spec:
      containers:
        - name: app
          image: nginx:1.24
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-green
  namespace: exam
spec:
  replicas: 2
  selector:
    matchLabels:
      app: myapp
      version: green
  template:
    metadata:
      labels:
        app: myapp
        version: green
    spec:
      containers:
        - name: app
          image: nginx:1.25
---
apiVersion: v1
kind: Service
metadata:
  name: myapp-svc
  namespace: exam
spec:
  selector:
    app: myapp
    version: blue
  ports:
    - port: 80
      targetPort: 80
```

```bash
# 트래픽 전환
kubectl patch service myapp-svc -n exam \
  -p '{"spec":{"selector":{"version":"green"}}}'
```

</details>

---

### 문제 8. Canary 배포

Canary 배포를 구현하라.

- Stable: `web-stable` (nginx:1.24, replicas=4, labels: app=web)
- Canary: `web-canary` (nginx:1.25, replicas=1, labels: app=web)
- Service `web-svc`: app=web selector (양쪽 Pod 모두 선택)
- Endpoints에 5개 Pod IP가 있는지 확인

<details><summary>풀이</summary>

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-stable
  namespace: exam
spec:
  replicas: 4
  selector:
    matchLabels:
      app: web
      version: stable
  template:
    metadata:
      labels:
        app: web
        version: stable
    spec:
      containers:
        - name: nginx
          image: nginx:1.24
          ports:
            - containerPort: 80
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-canary
  namespace: exam
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web
      version: canary
  template:
    metadata:
      labels:
        app: web
        version: canary
    spec:
      containers:
        - name: nginx
          image: nginx:1.25
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: web-svc
  namespace: exam
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 80
```

```bash
kubectl get endpoints web-svc -n exam
# 5개 Pod IP:80 확인
```

**핵심**: Service selector에 `version`을 포함하지 않아 양쪽 Pod를 모두 선택한다. 트래픽 비율은 Pod 수 비율(4:1 = 80:20)에 따른다.

</details>

---

### 문제 9. Scale

`app-deploy`를 5개로 스케일링하라.

<details><summary>풀이</summary>

```bash
kubectl scale deployment app-deploy --replicas=5 -n exam
kubectl get deployment app-deploy -n exam
# READY: 5/5
```

</details>

---

### 문제 10. Rollout 일시정지/재개

`app-deploy`의 롤아웃을 일시정지하고, 이미지와 리소스를 동시에 변경한 뒤 재개하라.

<details><summary>풀이</summary>

```bash
# 일시정지
kubectl rollout pause deployment/app-deploy -n exam

# 여러 변경을 한 번에 적용
kubectl set image deployment/app-deploy nginx=nginx:1.25 -n exam
kubectl set resources deployment/app-deploy \
  --requests=cpu=100m,memory=128Mi -n exam

# 재개 (한 번의 롤아웃으로 모든 변경이 적용됨)
kubectl rollout resume deployment/app-deploy -n exam
kubectl rollout status deployment/app-deploy -n exam
```

**핵심**: pause 상태에서는 여러 변경을 해도 롤아웃이 시작되지 않는다. resume 시 모든 변경이 한 번에 적용된다.

</details>

---

### 문제 11. Deployment 정보 추출

`app-deploy`의 다음 정보를 추출하라.
1. 현재 이미지
2. strategy 타입
3. 현재 replicas
4. 사용 가능한 replicas

<details><summary>풀이</summary>

```bash
# 이미지
kubectl get deployment app-deploy -n exam \
  -o jsonpath='{.spec.template.spec.containers[0].image}'

# strategy
kubectl get deployment app-deploy -n exam \
  -o jsonpath='{.spec.strategy.type}'

# replicas
kubectl get deployment app-deploy -n exam \
  -o jsonpath='{.spec.replicas}'

# availableReplicas
kubectl get deployment app-deploy -n exam \
  -o jsonpath='{.status.availableReplicas}'
```

</details>

---

### 문제 12. revisionHistoryLimit

`app-deploy`의 revisionHistoryLimit을 5로 설정하라.

<details><summary>풀이</summary>

```bash
kubectl patch deployment app-deploy -n exam \
  -p '{"spec":{"revisionHistoryLimit":5}}'

# 확인
kubectl get deployment app-deploy -n exam \
  -o jsonpath='{.spec.revisionHistoryLimit}'
# 5
```

**핵심**: revisionHistoryLimit은 보관할 이전 ReplicaSet 수를 제한한다. 기본값은 10이다. 너무 많으면 etcd 저장 공간을 차지한다.

</details>

---

## 5. 트러블슈팅

### 5.1 Blue/Green 전환 후 트래픽이 전달되지 않는 경우

```bash
kubectl get endpoints myapp-svc -n demo
kubectl get pods -l version=green -n demo
```

검증 (Endpoints 비어있음):
```text
NAME        ENDPOINTS   AGE
myapp-svc   <none>      5m
```

주요 원인:
- **selector label 오타**: `kubectl get svc myapp-svc -o jsonpath='{.spec.selector}'`로 selector를 확인한다.
- **Green Pod가 Ready 아님**: Pod가 Running이지만 Readiness Probe 실패로 Endpoints에 등록되지 않는다.
- **네임스페이스 불일치**: Service와 Pod가 다른 네임스페이스에 있다.

### 5.2 Canary 배포에서 트래픽 비율이 기대와 다른 경우

**증상:** stable 4개, canary 1개인데 canary에 트래픽이 거의 오지 않는다.

원인: kube-proxy의 iptables 모드는 확률 기반 분배이므로 요청 수가 적으면 편차가 크다. 충분한 요청(100+ 이상)을 보내면 Pod 수 비율에 수렴한다. 정확한 비율 제어가 필요하면 Istio VirtualService를 사용한다.

---

## 6. 복습 체크리스트

- [ ] Blue/Green 배포를 Service selector 변경으로 구현할 수 있다
- [ ] Canary 배포를 두 Deployment + 공통 label Service로 구현할 수 있다
- [ ] Canary에서 Service selector에 version을 포함하지 않는 이유를 안다
- [ ] `kubectl rollout pause/resume`으로 여러 변경을 일괄 적용할 수 있다
- [ ] revisionHistoryLimit의 역할을 안다
- [ ] RollingUpdate, Blue/Green, Canary의 장단점을 비교할 수 있다

---

## tart-infra 실습

### 실습 환경 설정

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get pods -n demo
```

검증:
```text
NAME                     READY   STATUS    RESTARTS   AGE
nginx-xxxxxxxxx-xxxxx    1/1     Running   0          xxd
```

### 실습 1: httpbin Canary 배포 확인

dev 클러스터에는 httpbin v1/v2가 Istio VirtualService를 통해 80/20 canary 배포되어 있다. 이를 확인한다.

```bash
# httpbin 배포 현황 확인
kubectl get deploy -n demo -l app=httpbin
kubectl get pods -n demo -l app=httpbin --show-labels

# Istio VirtualService canary 설정 확인
kubectl get virtualservice -n demo -o yaml | grep -A 10 "route:"

# 트래픽 분배 테스트 (10회 요청)
for i in $(seq 1 10); do
  kubectl exec -n demo deploy/nginx -- curl -s httpbin.demo:8000/headers | grep -o '"Host":.*' &
done; wait
```

**예상 출력 (VirtualService):**
```yaml
route:
  - destination:
      host: httpbin
      subset: v1
    weight: 80
  - destination:
      host: httpbin
      subset: v2
    weight: 20
```

**동작 원리:** Istio VirtualService는 L7에서 트래픽 비율을 정밀하게 제어한다. 순수 쿠버네티스의 Canary(Deployment replica 비율)는 Pod 수에 의존하지만, Istio는 weight 필드로 정확한 퍼센트 기반 분배가 가능하다. CKAD 시험에서는 순수 쿠버네티스 방식을 주로 출제한다.

### 실습 2: 순수 쿠버네티스 Canary 배포 구현

Istio 없이 두 Deployment + 공통 label Service로 Canary를 구현한다.

```bash
# Stable (4 replicas)
kubectl create deploy canary-stable --image=nginx:1.24 -n demo --replicas=4
kubectl label deploy canary-stable -n demo app=canary-app

# Canary (1 replica)
kubectl create deploy canary-new --image=nginx:1.25 -n demo --replicas=1
kubectl label deploy canary-new -n demo app=canary-app

# 공통 label로 Service 생성
kubectl expose deploy canary-stable -n demo --name=canary-svc \
  --port=80 --target-port=80 --selector=app=canary-app

# 트래픽 분배 확인 (약 80/20 비율)
kubectl get endpoints canary-svc -n demo
```

**예상 출력:**
```
NAME         ENDPOINTS                                            AGE
canary-svc   10.244.x.1:80,10.244.x.2:80,...,10.244.x.5:80       5s
```

**동작 원리:** Service selector가 `app=canary-app`이므로 두 Deployment의 Pod 모두 Endpoints에 등록된다. 5개 Pod 중 4개가 stable, 1개가 canary이므로 약 80/20 비율로 트래픽이 분배된다. replica 수를 조절하여 비율을 변경한다.

### 정리

```bash
kubectl delete deploy canary-stable canary-new -n demo
kubectl delete svc canary-svc -n demo
```

검증:
```text
deployment.apps "canary-stable" deleted
deployment.apps "canary-new" deleted
service "canary-svc" deleted
```
