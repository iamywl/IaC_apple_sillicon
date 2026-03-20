# CKA Day 18: Troubleshooting 시험 문제 & 빠른 참조

> CKA 도메인: Troubleshooting (30%) 실전 | 예상 소요 시간: 2시간

---

## 9. 시험에서 이 주제가 어떻게 출제되는가?

### 출제 패턴 분석

```
CKA 시험의 Troubleshooting 관련 출제:
Troubleshooting 도메인 = 전체의 30% (최대 비중!)

주요 출제 유형:
1. Pod 장애 복구 (CrashLoopBackOff, ImagePullBackOff) — 매우 빈출!
2. Node NotReady 복구 (kubelet 재시작) — 빈출
3. Service Endpoints 문제 해결 — 빈출
4. Control Plane 컴포넌트 복구 (Static Pod 수정) — 빈출
5. 로그 수집/분석 — 빈출
6. DNS 문제 해결 — 가끔 출제
7. 이벤트 필터링/수집 — 가끔 출제
8. PVC Pending 해결 — Storage 도메인과 연계

핵심 전략:
- kubectl describe의 Events 섹션을 가장 먼저 확인
- CrashLoopBackOff는 kubectl logs --previous 필수
- Service 문제는 kubectl get endpoints 먼저
- Node 문제는 SSH → systemctl status kubelet
- Static Pod 문제는 /etc/kubernetes/manifests/ 확인
```

---

## 10. 시험 대비 연습 문제 (12문제)

### 문제 1. Pending Pod 진단 및 복구 [4%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스의 `pending-app` Pod가 Pending 상태이다. 원인을 찾아 `/tmp/pending-reason.txt`에 기록하고, Pod가 Running 되도록 수정하라.

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 장애 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: pending-app
  namespace: demo
spec:
  nodeSelector:
    nonexistent-label: "true"
  containers:
  - name: app
    image: nginx
EOF

# 진단
kubectl get pod pending-app -n demo
# STATUS: Pending

kubectl describe pod pending-app -n demo | grep -A5 Events
# "node(s) didn't match Pod's node affinity/selector"

# 원인 기록
echo "nodeSelector에 존재하지 않는 레이블(nonexistent-label=true)이 지정되어 스케줄링 실패" \
  > /tmp/pending-reason.txt

# 복구: nodeSelector 제거 (Pod 재생성 필요)
kubectl delete pod pending-app -n demo
kubectl run pending-app --image=nginx -n demo

# 확인
kubectl get pod pending-app -n demo
# STATUS: Running

# 정리
kubectl delete pod pending-app -n demo
```

</details>

---

### 문제 2. CrashLoopBackOff 복구 [4%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스의 `crash-app` Pod가 CrashLoopBackOff 상태이다. 로그를 확인하여 원인을 파악하고 수정하라.

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 장애 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: crash-app
  namespace: demo
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "cat /config/app.conf"]
EOF

# 진단
kubectl get pod crash-app -n demo
# STATUS: CrashLoopBackOff

kubectl logs crash-app -n demo --previous
# "cat: can't open '/config/app.conf': No such file or directory"

kubectl describe pod crash-app -n demo | grep "Exit Code"
# Exit Code: 1

# 복구: 정상 명령으로 재생성
kubectl delete pod crash-app -n demo
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: crash-app
  namespace: demo
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "echo 'App running' && sleep 3600"]
EOF

kubectl get pod crash-app -n demo
# STATUS: Running

# 정리
kubectl delete pod crash-app -n demo
```

**핵심:** CrashLoopBackOff는 `kubectl logs --previous`로 이전 컨테이너의 로그를 확인하는 것이 핵심이다.

</details>

---

### 문제 3. Node NotReady 복구 [7%]

**컨텍스트:** `kubectl config use-context staging`

`staging-worker1` 노드가 NotReady 상태이다. SSH로 접속하여 원인을 파악하고 복구하라.

<details>
<summary>풀이</summary>

```bash
kubectl config use-context staging

# 노드 상태 확인
kubectl get nodes
# staging-worker1  NotReady

kubectl describe node staging-worker1 | grep -A10 Conditions
# Ready=False 또는 Ready=Unknown

# SSH 접속
ssh admin@<staging-worker1-ip>

# kubelet 상태 확인
sudo systemctl status kubelet
# Active: inactive (dead) 또는 failed

# kubelet 로그 확인
sudo journalctl -u kubelet --no-pager -n 30

# containerd 상태 확인
sudo systemctl status containerd

# 복구 시도 1: kubelet 재시작
sudo systemctl restart kubelet

# containerd가 문제인 경우
sudo systemctl restart containerd
sudo systemctl restart kubelet

# kubelet이 시작되지 않는 경우: 설정 확인
sudo cat /var/lib/kubelet/config.yaml
# 설정 오류가 있는지 확인

# 상태 확인
sudo systemctl status kubelet
# Active: active (running)

exit

# 노드 상태 확인
kubectl get nodes
# staging-worker1  Ready
```

</details>

---

### 문제 4. Service 연결 문제 해결 [7%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스의 `app-service`로 접근이 안 된다. 원인을 찾고 수정하라.

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 장애 생성
kubectl run app-pod --image=nginx --labels="app=myapp" --port=80 -n demo
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: app-service
  namespace: demo
spec:
  selector:
    app: wrong-app
  ports:
  - port: 80
    targetPort: 8080
EOF

# === 체계적 진단 ===

# 1. Service 확인
kubectl get svc app-service -n demo

# 2. Endpoints 확인 (핵심!)
kubectl get endpoints app-service -n demo
# ENDPOINTS: <none>

# 3. selector 확인
kubectl get svc app-service -n demo -o jsonpath='{.spec.selector}'
# {"app":"wrong-app"}

# 4. Pod label 확인
kubectl get pods -n demo --show-labels | grep app-pod
# app=myapp

# 5. Pod containerPort 확인
kubectl get pod app-pod -n demo -o jsonpath='{.spec.containers[0].ports[0].containerPort}'
# 80 (Service targetPort 8080과 불일치)

# 6. 수정
kubectl patch svc app-service -n demo \
  -p '{"spec":{"selector":{"app":"myapp"},"ports":[{"port":80,"targetPort":80}]}}'

# 7. 검증
kubectl get endpoints app-service -n demo
# Pod IP 표시됨

kubectl run curl-test --image=curlimages/curl -n demo --rm -it --restart=Never -- \
  curl -s http://app-service.demo.svc.cluster.local

# 정리
kubectl delete svc app-service -n demo
kubectl delete pod app-pod -n demo
```

</details>

---

### 문제 5. 로그 수집 [4%]

**컨텍스트:** `kubectl config use-context platform`

`monitoring` 네임스페이스에서 재시작 횟수가 1 이상인 Pod를 찾아 `/tmp/restarted-pods.txt`에 기록하라.

<details>
<summary>풀이</summary>

```bash
kubectl config use-context platform

# 재시작 횟수가 0보다 큰 Pod 찾기
kubectl get pods -n monitoring \
  -o custom-columns='NAME:.metadata.name,RESTARTS:.status.containerStatuses[0].restartCount' | \
  awk 'NR==1 || $2 > 0' > /tmp/restarted-pods.txt

# 또는 jsonpath 사용
kubectl get pods -n monitoring \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.containerStatuses[0].restartCount}{"\n"}{end}' | \
  awk '$2 > 0' > /tmp/restarted-pods.txt

cat /tmp/restarted-pods.txt
```

</details>

---

### 문제 6. kube-apiserver 복구 [7%]

**컨텍스트:** `kubectl config use-context staging`

kube-apiserver가 동작하지 않는다. SSH로 접속하여 문제를 찾고 수정하라.

<details>
<summary>풀이</summary>

```bash
# kubectl이 응답하지 않으면 직접 SSH 접속
ssh admin@<staging-master-ip>

# apiserver 컨테이너 확인
sudo crictl ps -a | grep apiserver
# Exited 상태

# 로그 확인
APISERVER_ID=$(sudo crictl ps -a | grep apiserver | head -1 | awk '{print $1}')
sudo crictl logs $APISERVER_ID 2>&1 | tail -30

# 에러 메시지에 따라 매니페스트 확인
sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml

# 일반적인 수정 대상:
# 1. 잘못된 인증서 경로 → 올바른 경로로 수정
# 2. 잘못된 포트 → 6443으로 수정
# 3. 잘못된 etcd 엔드포인트 → https://127.0.0.1:2379
# 4. YAML 문법 오류 → 수정

sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml
# 오류 수정 후 저장

# kubelet이 자동으로 apiserver를 재시작
sleep 30
sudo crictl ps | grep apiserver
# Running 상태 확인

exit

# kubectl 테스트
kubectl config use-context staging
kubectl get nodes
```

</details>

---

### 문제 7. DNS 문제 해결 [4%]

**컨텍스트:** `kubectl config use-context dev`

Pod에서 Service 이름으로 접근이 안 된다. DNS 문제를 진단하고 해결하라.

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 1. CoreDNS Pod 상태 확인
kubectl -n kube-system get pods -l k8s-app=kube-dns
# Running이 아니면 → describe/logs 확인

# 2. CoreDNS 로그 확인
kubectl -n kube-system logs -l k8s-app=kube-dns --tail=20

# 3. kube-dns Service 확인
kubectl -n kube-system get svc kube-dns
kubectl -n kube-system get endpoints kube-dns

# 4. DNS 테스트
kubectl run dns-test --image=busybox:1.28 -n demo --rm -it --restart=Never -- \
  nslookup kubernetes.default.svc.cluster.local

# 5. CoreDNS ConfigMap 확인
kubectl -n kube-system get configmap coredns -o yaml
# 문법 오류 있으면 수정

# 6. CoreDNS 재시작 (필요시)
kubectl -n kube-system rollout restart deployment coredns

# 7. 재테스트
kubectl run dns-test2 --image=busybox:1.28 -n demo --rm -it --restart=Never -- \
  nslookup nginx-web.demo.svc.cluster.local
```

</details>

---

### 문제 8. Warning 이벤트 수집 [4%]

**컨텍스트:** `kubectl config use-context platform`

클러스터 전체에서 Warning 타입 이벤트를 찾아 `/tmp/warning-events.txt`에 저장하라.

<details>
<summary>풀이</summary>

```bash
kubectl config use-context platform

# Warning 이벤트 필터링
kubectl get events -A --field-selector type=Warning \
  --sort-by='.lastTimestamp' > /tmp/warning-events.txt

cat /tmp/warning-events.txt
```

</details>

---

### 문제 9. ImagePullBackOff 복구 [4%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스의 `broken-image-pod`가 ImagePullBackOff 상태이다. 이미지를 `nginx:1.24`로 수정하라.

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 장애 생성
kubectl run broken-image-pod --image=nginx:nonexistent-12345 -n demo

# 진단
kubectl get pod broken-image-pod -n demo
# ImagePullBackOff

kubectl describe pod broken-image-pod -n demo | grep -A5 "Events"
# "Failed to pull image"

# 복구
kubectl set image pod/broken-image-pod broken-image-pod=nginx:1.24 -n demo

# 확인
kubectl get pod broken-image-pod -n demo
# Running

# 정리
kubectl delete pod broken-image-pod -n demo
```

</details>

---

### 문제 10. Control Plane 컴포넌트 진단 [7%]

**컨텍스트:** `kubectl config use-context platform`

Control Plane 컴포넌트의 상태를 점검하고 다음 정보를 `/tmp/cp-status.txt`에 저장하라:
1. 모든 Control Plane Pod의 이름과 상태
2. kube-apiserver의 `--service-cluster-ip-range` 값
3. kube-scheduler의 최근 5줄 로그

<details>
<summary>풀이</summary>

```bash
kubectl config use-context platform

# 1. Control Plane Pod 상태
echo "=== Control Plane Pods ===" > /tmp/cp-status.txt
kubectl get pods -n kube-system \
  -l tier=control-plane \
  -o custom-columns='NAME:.metadata.name,STATUS:.status.phase,RESTARTS:.status.containerStatuses[0].restartCount' \
  >> /tmp/cp-status.txt
echo "" >> /tmp/cp-status.txt

# 2. service-cluster-ip-range
echo "=== Service CIDR ===" >> /tmp/cp-status.txt
kubectl -n kube-system get pod -l component=kube-apiserver \
  -o jsonpath='{.items[0].spec.containers[0].command}' | \
  tr ',' '\n' | grep service-cluster-ip-range >> /tmp/cp-status.txt
echo "" >> /tmp/cp-status.txt

# 3. kube-scheduler 로그
echo "=== Scheduler Logs (last 5 lines) ===" >> /tmp/cp-status.txt
kubectl -n kube-system logs -l component=kube-scheduler --tail=5 >> /tmp/cp-status.txt

cat /tmp/cp-status.txt
```

</details>

---

### 문제 11. Multi-Container Pod 트러블슈팅 [7%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스의 `multi-pod`의 sidecar 컨테이너가 CrashLoopBackOff 상태이다. 원인을 찾고 수정하라.

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 장애 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: multi-pod
  namespace: demo
spec:
  containers:
  - name: main
    image: nginx
    volumeMounts:
    - name: logs
      mountPath: /var/log/nginx
  - name: sidecar
    image: busybox:1.36
    command: ["sh", "-c", "cat /nonexistent/file"]
    volumeMounts:
    - name: logs
      mountPath: /logs
  volumes:
  - name: logs
    emptyDir: {}
EOF

# 진단
kubectl get pod multi-pod -n demo
# READY: 1/2 (sidecar가 Running이 아님)

# sidecar 컨테이너 로그 확인
kubectl logs multi-pod -c sidecar -n demo --previous
# "cat: can't open '/nonexistent/file': No such file or directory"

# 수정: Pod 재생성 (command 수정)
kubectl delete pod multi-pod -n demo
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: multi-pod
  namespace: demo
spec:
  containers:
  - name: main
    image: nginx
    volumeMounts:
    - name: logs
      mountPath: /var/log/nginx
  - name: sidecar
    image: busybox:1.36
    command: ["sh", "-c", "tail -f /logs/access.log"]
    volumeMounts:
    - name: logs
      mountPath: /logs
      readOnly: true
  volumes:
  - name: logs
    emptyDir: {}
EOF

# 확인
kubectl get pod multi-pod -n demo
# READY: 2/2

# 정리
kubectl delete pod multi-pod -n demo
```

**핵심:** Multi-Container Pod에서는 `-c <container-name>`으로 특정 컨테이너의 로그를 확인해야 한다.

</details>

---

### 문제 12. 종합 트러블슈팅 [7%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스에서 다음 문제를 모두 해결하라:
1. `web-deploy` Deployment의 Pod가 Pending 상태
2. `web-svc` Service의 Endpoints가 비어있음
3. DNS로 `web-svc`에 접근 불가

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 장애 생성
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-deploy
  namespace: demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web-deploy
  template:
    metadata:
      labels:
        app: web-deploy
    spec:
      nodeSelector:
        fake-label: "true"          # 문제 1: 존재하지 않는 nodeSelector
      containers:
      - name: nginx
        image: nginx:1.24
        ports:
        - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: web-svc
  namespace: demo
spec:
  selector:
    app: wrong-label                # 문제 2: selector 불일치
  ports:
  - port: 80
    targetPort: 80
EOF

# === 진단 & 해결 ===

# 문제 1: Pending Pod
kubectl get pods -n demo -l app=web-deploy
# STATUS: Pending

kubectl describe pod -n demo -l app=web-deploy | grep -A3 Events
# "node(s) didn't match Pod's node affinity/selector"

# 해결: nodeSelector 제거
kubectl patch deployment web-deploy -n demo --type=json \
  -p='[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'

# Pod가 Running이 될 때까지 대기
kubectl rollout status deployment web-deploy -n demo

# 문제 2: Endpoints 비어있음
kubectl get endpoints web-svc -n demo
# <none>

kubectl get svc web-svc -n demo -o jsonpath='{.spec.selector}'
# {"app":"wrong-label"}

kubectl get pods -n demo --show-labels | grep web-deploy
# app=web-deploy

# 해결: selector 수정
kubectl patch svc web-svc -n demo \
  -p '{"spec":{"selector":{"app":"web-deploy"}}}'

kubectl get endpoints web-svc -n demo
# Pod IP 표시

# 문제 3: DNS 접근 테스트
kubectl run dns-check --image=busybox:1.28 -n demo --rm -it --restart=Never -- \
  nslookup web-svc.demo.svc.cluster.local
# 성공

kubectl run curl-check --image=curlimages/curl -n demo --rm -it --restart=Never -- \
  curl -s http://web-svc.demo.svc.cluster.local
# nginx 응답

# 정리
kubectl delete deployment web-deploy -n demo
kubectl delete svc web-svc -n demo
```

</details>

---

## 11. 트러블슈팅 빠른 참조 카드

```
┌──────────────────────────────────────────────────────────┐
│              CKA Troubleshooting Quick Reference          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ Pod 문제:                                                │
│   Pending     → describe pod → Events → 리소스/노드/PVC  │
│   Crash       → logs --previous → 명령어/설정 확인       │
│   ImagePull   → describe pod → 이미지명/태그/Secret      │
│   OOMKilled   → describe pod → limits.memory 증가        │
│                                                          │
│ Service 문제:                                            │
│   접근 불가   → get endpoints → selector/label 비교      │
│   DNS 실패    → kube-system coredns Pod/ConfigMap 확인   │
│                                                          │
│ Node 문제:                                               │
│   NotReady    → SSH → systemctl status kubelet           │
│               → journalctl -u kubelet                    │
│               → systemctl restart kubelet                │
│                                                          │
│ Control Plane:                                           │
│   kubectl 불가 → SSH → crictl ps -a | grep apiserver     │
│               → /etc/kubernetes/manifests/ 확인           │
│               → crictl logs <container-id>                │
│                                                          │
│ 핵심 명령어:                                             │
│   kubectl describe pod   → Events 확인                   │
│   kubectl logs --previous → 이전 로그                    │
│   kubectl get endpoints  → Service-Pod 연결              │
│   systemctl status kubelet → kubelet 상태                │
│   crictl ps -a           → Static Pod 컨테이너           │
│   journalctl -u kubelet  → kubelet 로그                  │
└──────────────────────────────────────────────────────────┘
```

---

## 12. 복습 체크리스트

### 개념 확인

- [ ] Pod 상태별(Pending, CrashLoopBackOff, ImagePullBackOff, OOMKilled) 진단 절차를 설명할 수 있는가?
- [ ] Exit Code(0, 1, 127, 137, 143)의 의미를 알고 있는가?
- [ ] Node NotReady의 일반적인 원인 5가지를 나열할 수 있는가?
- [ ] Control Plane 컴포넌트별 장애 증상을 구분할 수 있는가?
- [ ] Static Pod 매니페스트의 위치(`/etc/kubernetes/manifests/`)를 기억하는가?
- [ ] Service Endpoints가 비어있는 주요 원인을 3가지 이상 말할 수 있는가?

### kubectl 명령어 확인

- [ ] `kubectl describe pod <name>` → Events 확인
- [ ] `kubectl logs <name> --previous` → 이전 컨테이너 로그
- [ ] `kubectl logs <name> -c <container>` → 특정 컨테이너 로그
- [ ] `kubectl get endpoints <svc-name>` → Service-Pod 연결 확인
- [ ] `kubectl get events --sort-by='.lastTimestamp'` → 이벤트 정렬
- [ ] `kubectl get events --field-selector type=Warning` → Warning 필터

### 시험 핵심 팁

1. **첫 번째 확인** — `kubectl describe pod`의 Events 섹션이 가장 중요하다
2. **이전 로그** — CrashLoopBackOff는 `kubectl logs --previous`로 확인
3. **Endpoints** — Service 연결 문제는 `kubectl get endpoints`로 시작
4. **kubelet** — `systemctl status kubelet`과 `journalctl -u kubelet`이 핵심
5. **Static Pod** — apiserver 등 Control Plane 문제는 `/etc/kubernetes/manifests/` 확인
6. **crictl** — SSH 접속 후 컨테이너 상태 확인에 사용

---

## 내일 예고

**Day 19: CKA 모의시험** — 120분 시간 제한 모의시험으로 전 도메인을 종합 테스트한다.

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속 (실제 앱이 동작 중인 환경에서 트러블슈팅 연습)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: Pod 상태 진단

```bash
# demo 네임스페이스의 모든 Pod 상태 확인
kubectl get pods -n demo -o wide
```

**예상 출력:**
```
NAME                          READY   STATUS    RESTARTS   AGE   IP           NODE
httpbin-v1-xxxxxxxxx-xxxxx    2/2     Running   0          5d    10.20.1.22   dev-worker1
httpbin-v2-xxxxxxxxx-xxxxx    2/2     Running   0          5d    10.20.1.23   dev-worker1
keycloak-xxxxxxxxx-xxxxx      1/1     Running   0          5d    10.20.1.35   dev-worker1
nginx-web-xxxxxxxxx-xxxxx     1/1     Running   0          5d    10.20.1.15   dev-worker1
postgres-xxxxxxxxx-xxxxx      1/1     Running   0          5d    10.20.1.30   dev-worker1
rabbitmq-xxxxxxxxx-xxxxx      1/1     Running   0          5d    10.20.1.32   dev-worker1
redis-xxxxxxxxx-xxxxx         1/1     Running   0          5d    10.20.1.31   dev-worker1
```

**동작 원리:** READY 컬럼 해석:
1. `2/2`(httpbin): 앱 컨테이너 + Istio sidecar(envoy) = 2개 컨테이너가 모두 Ready
2. `1/1`(nginx 등): 앱 컨테이너만 실행 중 (Istio sidecar 미주입 또는 별도 설정)
3. `0/1` Running: 컨테이너는 실행 중이지만 Readiness Probe가 실패
4. CrashLoopBackOff: 컨테이너가 시작 후 즉시 종료되어 반복 재시작 중

### 실습 2: 이벤트 기반 진단

```bash
# demo 네임스페이스의 최근 이벤트 확인
kubectl get events -n demo --sort-by='.lastTimestamp' | tail -10

# Warning 이벤트만 필터링
kubectl get events -n demo --field-selector type=Warning
```

**동작 원리:** K8s Event 오브젝트:
1. 각 컴포넌트(Scheduler, kubelet, Controller 등)가 중요한 상태 변경을 Event로 기록한다
2. Event는 기본 1시간 후 자동 삭제된다 (TTL 설정 가능)
3. `FailedScheduling`: Scheduler가 적합한 노드를 찾지 못함 (리소스 부족, Taint 등)
4. `BackOff`: kubelet이 CrashLoopBackOff 상태의 컨테이너를 재시작 대기 중
5. `Unhealthy`: Probe 실패 — Liveness면 컨테이너 재시작, Readiness면 Endpoints에서 제거

### 실습 3: 로그 기반 트러블슈팅

```bash
# nginx Pod의 로그 확인
kubectl logs -n demo deploy/nginx-web --tail=10

# httpbin Pod의 특정 컨테이너(envoy sidecar) 로그
kubectl logs -n demo -l app=httpbin,version=v1 -c istio-proxy --tail=5
```

**동작 원리:** `kubectl logs`의 내부 동작:
1. kubectl이 API Server에 로그 요청을 보낸다
2. API Server가 해당 Pod가 실행 중인 노드의 kubelet에 요청을 프록시한다
3. kubelet이 컨테이너 런타임(containerd)에서 로그 파일을 읽어 반환한다
4. 로그 파일은 노드의 `/var/log/containers/` 디렉터리에 JSON 형태로 저장된다
5. `--previous` 플래그: CrashLoopBackOff 시 이전에 종료된 컨테이너의 로그를 확인한다

### 실습 4: Service 연결 문제 진단

```bash
# Service와 Endpoints 매핑 확인
kubectl get svc,endpoints -n demo -l app=nginx-web
```

**예상 출력:**
```
NAME                TYPE       CLUSTER-IP   EXTERNAL-IP   PORT(S)        AGE
service/nginx-web   NodePort   10.97.x.x    <none>        80:30080/TCP   5d

NAME                  ENDPOINTS        AGE
endpoints/nginx-web   10.20.1.15:80    5d
```

**동작 원리:** Service 연결 문제 진단 순서:
1. `kubectl get endpoints`: Endpoints가 비어있으면 selector와 Pod label 불일치
2. `kubectl get pods -l <selector>`: selector에 매칭되는 Pod가 있는지 확인
3. Pod가 있지만 Endpoints가 없으면: Pod가 Ready 상태가 아니거나 포트가 다름
4. Endpoints가 있지만 접근 불가: NetworkPolicy가 트래픽을 차단하고 있을 수 있음

### 실습 5: 노드 상태 진단

```bash
# 노드 상태 상세 확인
kubectl describe node dev-worker1 | grep -A5 "Conditions:"

# 노드 리소스 사용량
kubectl top node
```

**예상 출력:**
```
NAME          CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
dev-master    150m         7%     1200Mi          30%
dev-worker1   300m         15%    3500Mi          43%
```

**동작 원리:** 노드 진단 시 확인할 Conditions:
1. `Ready=True`: kubelet이 정상 동작 중
2. `MemoryPressure=True`: 노드 메모리 부족 — kubelet이 Pod eviction 시작
3. `DiskPressure=True`: 디스크 용량 부족 — 이미지, 로그, emptyDir 정리 필요
4. `PIDPressure=True`: 프로세스 수 초과 — 컨테이너 수를 줄이거나 PID 제한 조정
5. kubelet 문제: `systemctl status kubelet`, `journalctl -u kubelet -f`로 확인
