# CKAD Day 12: API Deprecation 실전 문제와 Observability 심화

> CKAD 도메인: Application Observability and Maintenance (15%) - Part 2b | 예상 소요 시간: 1시간

---

## 오늘의 학습 목표

- [ ] API Deprecation 관련 실전 문제를 풀 수 있다
- [ ] Observability(관측성) 개념과 구성 요소를 이해한다
- [ ] 컨테이너 리소스 모니터링(kubectl top)을 활용할 수 있다
- [ ] 실전 시나리오 기반 트러블슈팅을 수행할 수 있다

---

## 1. 실전 시험 문제 (6문제)

### 문제 1. Deprecated API 식별

클러스터에서 실행 중인 리소스 중 deprecated API를 사용하는 것이 있는지 확인하라.

<details><summary>풀이</summary>

```bash
# 방법 1: kubectl get으로 Warning 확인
kubectl get ingress -A 2>&1 | grep -i warning

# 방법 2: audit log 확인 (클러스터 관리자)
# API Server의 --audit-log-path에서 deprecated API 호출 확인

# 방법 3: API Server metrics 확인
kubectl get --raw /metrics | grep apiserver_requested_deprecated_apis

# 방법 4: 특정 리소스의 API 버전 확인
kubectl get deployment -A -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.apiVersion}{"\n"}{end}'
```

</details>

---

### 문제 2. kubectl explain 활용

`Ingress`의 `spec.rules.http.paths.backend` 구조를 `kubectl explain`으로 확인하고, 필수 필드를 파악하라.

<details><summary>풀이</summary>

```bash
# backend 구조 확인
kubectl explain ingress.spec.rules.http.paths.backend
# service 필드가 있음을 확인

# service 하위 구조 확인
kubectl explain ingress.spec.rules.http.paths.backend.service
# name: required
# port: required

# port 구조 확인
kubectl explain ingress.spec.rules.http.paths.backend.service.port
# name: string (서비스 포트 이름)
# number: int32 (서비스 포트 번호)
# name 또는 number 중 하나 필수

# pathType 확인
kubectl explain ingress.spec.rules.http.paths.pathType
# Required: true
# Prefix, Exact, ImplementationSpecific
```

**핵심**: `kubectl explain`은 시험에서 YAML 구조를 모를 때 필수 도구이다.

</details>

---

### 문제 3. API 그룹별 리소스 분류

다음 리소스들이 어떤 API 그룹에 속하는지 확인하라: Pod, Deployment, Job, Ingress, NetworkPolicy

<details><summary>풀이</summary>

```bash
# 각 리소스의 API 그룹 확인
kubectl api-resources | grep -E "^pods |^deployments |^jobs |^ingresses |^networkpolicies "

# 결과:
# pods          po    v1                          true   Pod
# deployments   deploy apps/v1                    true   Deployment
# jobs                 batch/v1                   true   Job
# ingresses     ing    networking.k8s.io/v1       true   Ingress
# networkpolicies netpol networking.k8s.io/v1     true   NetworkPolicy
```

**정리:**
| 리소스 | API 그룹 | apiVersion |
|--------|----------|------------|
| Pod | core (빈 문자열) | v1 |
| Deployment | apps | apps/v1 |
| Job | batch | batch/v1 |
| Ingress | networking.k8s.io | networking.k8s.io/v1 |
| NetworkPolicy | networking.k8s.io | networking.k8s.io/v1 |

</details>

---

### 문제 4. Ingress 생성 (현재 API)

다음 조건의 Ingress를 생성하라.

- 이름: `web-ingress`, 네임스페이스: `exam`
- ingressClassName: `nginx`
- 호스트: `web.example.com`
- `/app` -> `app-svc:8080` (Prefix)
- `/api` -> `api-svc:3000` (Prefix)

<details><summary>풀이</summary>

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-ingress
  namespace: exam
spec:
  ingressClassName: nginx
  rules:
    - host: web.example.com
      http:
        paths:
          - path: /app
            pathType: Prefix
            backend:
              service:
                name: app-svc
                port:
                  number: 8080
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-svc
                port:
                  number: 3000
```

```bash
# 명령형 생성 (기본 틀만)
kubectl create ingress web-ingress \
  --class=nginx \
  --rule="web.example.com/app=app-svc:8080" \
  --rule="web.example.com/api=api-svc:3000" \
  -n exam
```

검증:
```bash
kubectl get ingress web-ingress -n exam
```

기대 출력:
```text
NAME          CLASS   HOSTS             ADDRESS   PORTS   AGE
web-ingress   nginx   web.example.com             80      10s
```

```bash
kubectl describe ingress web-ingress -n exam | grep -A 5 "Rules:"
```

기대 출력:
```text
Rules:
  Host             Path  Backends
  ----             ----  --------
  web.example.com
                   /app   app-svc:8080 (<error: endpoints "app-svc" not found>)
                   /api   api-svc:3000 (<error: endpoints "api-svc" not found>)
```

</details>

---

### 문제 5. HPA API 버전 확인

HorizontalPodAutoscaler(HPA)의 현재 API 버전을 확인하고, `autoscaling/v1`과 `autoscaling/v2`의 차이를 설명하라.

<details><summary>풀이</summary>

```bash
# HPA API 버전 확인
kubectl api-versions | grep autoscaling
# autoscaling/v1
# autoscaling/v2

kubectl explain hpa | head -3
# KIND:     HorizontalPodAutoscaler
# VERSION:  autoscaling/v2
```

**차이점:**

| 항목 | autoscaling/v1 | autoscaling/v2 |
|------|---------------|----------------|
| CPU 메트릭 | O | O |
| Memory 메트릭 | X | O |
| Custom 메트릭 | X | O |
| 여러 메트릭 | X | O |
| 동작 제어 (behavior) | X | O |

```yaml
# autoscaling/v2 예시
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web-deploy
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

</details>

---

### 문제 6. 복합 마이그레이션

다음 deprecated 매니페스트의 모든 API 버전을 현재 버전으로 수정하라.

```yaml
apiVersion: extensions/v1beta1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.25
          ports:
            - containerPort: 80
---
apiVersion: extensions/v1beta1
kind: Ingress
metadata:
  name: web-ingress
  annotations:
    kubernetes.io/ingress.class: nginx
spec:
  rules:
    - host: web.example.com
      http:
        paths:
          - path: /
            backend:
              serviceName: web-svc
              servicePort: 80
```

<details><summary>풀이</summary>

```yaml
apiVersion: apps/v1                     # extensions/v1beta1 -> apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  selector:                             # selector 추가 (필수)
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.25
          ports:
            - containerPort: 80
---
apiVersion: networking.k8s.io/v1        # extensions/v1beta1 -> networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-ingress
spec:
  ingressClassName: nginx               # annotation -> spec 필드
  rules:
    - host: web.example.com
      http:
        paths:
          - path: /
            pathType: Prefix            # pathType 추가 (필수)
            backend:
              service:                  # backend 구조 변경
                name: web-svc
                port:
                  number: 80
```

</details>

---

## 2. Observability (관측성) 심화

### 2.1 등장 배경

```
[Observability가 필요한 이유]

전통적 모니터링: 사전에 알려진 메트릭만 감시한다 (CPU, 메모리 등).
- "무엇이 고장났는지"는 알 수 있지만, "왜 고장났는지"를 모른다
- 마이크로서비스 환경에서는 서비스 간 호출 관계가 복잡하여
  단일 메트릭만으로는 근본 원인을 파악할 수 없다

Observability: 시스템 내부 상태를 외부 출력으로 추론할 수 있는 능력이다.
- Metrics: "얼마나"에 대한 수치 데이터 (시계열)
- Logs: "무엇이 일어났는지"에 대한 이벤트 기록
- Traces: "어디서 느려졌는지"에 대한 요청 경로 추적

세 가지를 조합해야 장애의 근본 원인을 파악할 수 있다.
```

### 2.2 관측성의 3대 요소

```
[Observability의 3가지 축]

1. Metrics (메트릭)
   - 수치화된 시계열 데이터
   - CPU/Memory 사용량, 요청 처리량, 에러율
   - 도구: Prometheus, kubectl top, Metrics Server
   - "얼마나?"에 대한 답

2. Logs (로그)
   - 이벤트 기반의 텍스트 데이터
   - 애플리케이션 출력, 에러 메시지, 감사 로그
   - 도구: kubectl logs, Fluentd, Loki
   - "무엇이 일어났나?"에 대한 답

3. Traces (추적)
   - 요청의 전체 경로를 추적
   - 마이크로서비스 간 호출 관계와 지연 시간
   - 도구: Jaeger, Zipkin, OpenTelemetry
   - "어디서 느려졌나?"에 대한 답
```

### 2.3 Metrics Server와 kubectl top

```
[Metrics Server 내부 동작]

1. 각 Node의 kubelet은 cAdvisor를 내장하고 있다
2. cAdvisor가 컨테이너의 CPU/메모리 사용량을 수집한다
3. Metrics Server가 kubelet의 /metrics/resource 엔드포인트를 주기적으로(~15초) 조회한다
4. 수집한 데이터를 메모리에 저장한다 (디스크 저장 없음, 최근값만 보관)
5. kubectl top이 Metrics API (/apis/metrics.k8s.io/v1beta1)를 통해 데이터를 조회한다

Metrics Server는 HPA(Horizontal Pod Autoscaler)의 CPU/메모리 기반 스케일링에도 사용된다.
```

```bash
# Metrics Server 설치 확인
kubectl get pods -n kube-system | grep metrics-server

# 노드 리소스 사용량
kubectl top nodes
# NAME     CPU(cores)  CPU%  MEMORY(bytes)  MEMORY%
# node-1   250m        12%   1024Mi         53%
# node-2   180m        9%    896Mi          46%

# Pod 리소스 사용량
kubectl top pods -n demo
kubectl top pods -n demo --sort-by=cpu
kubectl top pods -n demo --sort-by=memory

# 특정 Pod의 컨테이너별 사용량
kubectl top pod my-pod --containers -n demo
# NAME    NAME         CPU(cores)  MEMORY(bytes)
# my-pod  app          45m         128Mi
# my-pod  log-agent    5m          32Mi

# 모든 네임스페이스의 Pod 리소스 (메모리 순)
kubectl top pods -A --sort-by=memory | head -10
```

### 2.4 리소스 요청/제한과 모니터링

```yaml
# 리소스 설정과 모니터링의 관계
apiVersion: v1
kind: Pod
metadata:
  name: monitored-app
spec:
  containers:
    - name: app
      image: nginx:1.25
      resources:
        requests:                    # 스케줄링 기준
          cpu: 100m                  # 0.1 CPU
          memory: 128Mi              # 128 MiB
        limits:                      # 최대 사용량
          cpu: 200m                  # 0.2 CPU
          memory: 256Mi              # 256 MiB (초과 시 OOMKilled)
```

```bash
# 리소스 사용량 vs 요청/제한 비교
kubectl top pod monitored-app
# CPU: 85m (요청 100m의 85%, 제한 200m의 42.5%)
# Memory: 180Mi (요청 128Mi 초과, 제한 256Mi의 70%)

# OOMKilled 확인
kubectl get pod monitored-app -o jsonpath='{.status.containerStatuses[0].lastState}'
# terminated: reason=OOMKilled
```

---

## 3. 실전 시나리오

### 시나리오 A: API 마이그레이션 체크리스트

```
[Kubernetes 업그레이드 전 API 마이그레이션 체크리스트]

1. 현재 클러스터의 deprecated API 사용 확인
   kubectl get --raw /metrics | grep apiserver_requested_deprecated_apis

2. 각 네임스페이스의 리소스 API 버전 확인
   kubectl get deploy,ing,cronjob -A -o yaml | grep "apiVersion:"

3. Helm Chart의 API 버전 확인
   helm get manifest <release> | grep "apiVersion:"

4. CI/CD 파이프라인의 매니페스트 확인
   grep -r "apiVersion:" ./manifests/ | grep -v "apps/v1\|v1\|networking.k8s.io/v1"

5. kubectl convert로 변환
   kubectl convert -f old-manifest.yaml --output-version <new-version>

6. 테스트 환경에서 먼저 적용
   kubectl apply -f new-manifest.yaml --dry-run=server
```

### 시나리오 B: Observability 기반 트러블슈팅 흐름

```
[문제 감지 및 진단 흐름]

1. 증상 확인
   kubectl get pods -A | grep -v Running
   kubectl get events -A --sort-by='.lastTimestamp' | tail -20

2. 메트릭 확인
   kubectl top nodes              # 노드 리소스 확인
   kubectl top pods -A --sort-by=memory  # 메모리 상위 Pod 확인

3. 로그 확인
   kubectl logs <pod> --tail=50   # 최근 로그
   kubectl logs <pod> --previous  # 이전 컨테이너 로그
   kubectl logs <pod> --since=5m  # 5분 내 로그

4. 상세 분석
   kubectl describe pod <pod>     # Events, Conditions 확인
   kubectl get pod <pod> -o yaml  # 전체 스펙 확인

5. 실시간 디버깅
   kubectl exec -it <pod> -- /bin/sh
   kubectl debug -it <pod> --image=busybox
```

---

## 4. 트러블슈팅

### 장애 시나리오 1: kubectl top에서 메트릭이 안 보임

```bash
# 증상
kubectl top pods -n demo
# error: Metrics API not available

# 디버깅
kubectl get pods -n kube-system | grep metrics-server
kubectl logs -n kube-system -l k8s-app=metrics-server --tail=20

# 흔한 원인:
# 1. Metrics Server가 설치되지 않음
# 2. Metrics Server가 kubelet에 TLS 연결 실패 (--kubelet-insecure-tls 필요)
# 3. Metrics Server Pod가 CrashLoopBackOff

# 해결: Metrics Server 설치 또는 재배포
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

### 장애 시나리오 2: OOMKilled 반복 발생

```bash
# 증상
kubectl get pod myapp
```

```text
NAME    READY   STATUS      RESTARTS      AGE
myapp   0/1     OOMKilled   5 (30s ago)   10m
```

```bash
# 디버깅: 이전 컨테이너 상태 확인
kubectl get pod myapp -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}'
```

```text
OOMKilled
```

```bash
# 리소스 사용량과 limits 비교
kubectl describe pod myapp | grep -A 3 "Limits\|Requests"
# 메모리 limits가 실제 사용량보다 작으면 OOMKilled 발생

# 해결: memory limits 증가 또는 앱의 메모리 사용 최적화
kubectl set resources deployment/myapp --limits=memory=512Mi
```

---

## 5. 자주 하는 실수와 주의사항

### 실수 1: pathType 누락

```yaml
# 잘못된 예 (networking.k8s.io/v1에서 에러)
paths:
  - path: /
    backend:
      service:
        name: web-svc
        port:
          number: 80

# 올바른 예
paths:
  - path: /
    pathType: Prefix        # 필수!
    backend:
      service:
        name: web-svc
        port:
          number: 80
```

### 실수 2: Deployment selector 누락

```yaml
# 잘못된 예 (apps/v1에서 에러)
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 3
  template:               # selector 없음 -> 에러
    metadata:
      labels:
        app: web

# 올바른 예
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 3
  selector:               # 필수!
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
```

### 실수 3: kubectl top 사용 시 Metrics Server 미설치

```bash
# Metrics Server가 없으면 에러 발생
kubectl top pods
# error: Metrics API not available

# 해결: Metrics Server 설치
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# 또는 Helm으로 설치
helm install metrics-server metrics-server/metrics-server -n kube-system
```

---

## 6. 복습 체크리스트

- [ ] Deprecated API를 현재 버전으로 마이그레이션할 수 있다
- [ ] `kubectl explain`으로 리소스 스키마를 탐색할 수 있다
- [ ] Observability의 3대 요소(Metrics, Logs, Traces)를 설명할 수 있다
- [ ] `kubectl top`으로 노드/Pod 리소스를 모니터링할 수 있다
- [ ] API 마이그레이션 체크리스트를 수행할 수 있다
- [ ] Ingress의 `pathType` 필드가 필수인 것을 안다

---

## tart-infra 실습

### 실습 환경 설정

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: API 버전 확인

```bash
# 클러스터의 API 버전 확인
kubectl api-versions | sort

# 주요 리소스의 API 그룹 확인
kubectl api-resources --api-group=apps
kubectl api-resources --api-group=batch
kubectl api-resources --api-group=networking.k8s.io
```

### 실습 2: 리소스 모니터링

```bash
# 노드 리소스 사용량
kubectl top nodes

# Pod 리소스 사용량 (demo 네임스페이스)
kubectl top pods -n demo --sort-by=memory

# 컨테이너별 사용량
kubectl top pods -n demo --containers
```

### 실습 3: kubectl explain 활용

```bash
# Ingress 구조 확인
kubectl explain ingress.spec.rules.http.paths --recursive

# Deployment selector 확인
kubectl explain deployment.spec.selector
```
