# CKA Day 12: Service 시험 패턴 & 연습 문제

> CKA 도메인: Services & Networking (20%) - Part 1 실전 | 예상 소요 시간: 2시간

---

## 8. 시험에서 이 주제가 어떻게 출제되는가?

### 출제 패턴 분석

```
CKA 시험의 Service & DNS 관련 출제 비중:
Services & Networking 도메인 = 전체의 20%

주요 출제 유형:
1. Service 생성 (ClusterIP, NodePort) — 가장 빈출!
2. DNS 조회 (nslookup) — 자주 출제
3. Service Endpoints 문제 해결 — 트러블슈팅과 연계
4. 멀티 포트 Service — 가끔 출제
5. Headless Service — StatefulSet과 연계
6. CoreDNS 확인/수정 — 가끔 출제
7. externalTrafficPolicy — 드물지만 출제 가능

시험에서의 핵심:
- kubectl expose 명령 숙달이 시간 절약의 핵심
- Service YAML에서 selector, port, targetPort 정확히 구분
- Endpoints가 비어있는 문제 → selector-label 불일치가 99%
- DNS 테스트는 항상 busybox:1.28 이미지 사용
```

---

## 9. 시험 대비 연습 문제 (12문제)

### 문제 1. ClusterIP Service 생성 [4%]

**컨텍스트:** `kubectl config use-context dev`

네임스페이스 `demo`에서 다음 Service를 생성하라:
- 이름: `backend-svc`
- 타입: ClusterIP
- 포트: 8080 → targetPort: 80
- 셀렉터: `app=backend`

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 방법 1: 빠른 생성 (추천)
# 먼저 Pod/Deployment가 있다면:
kubectl expose deployment backend --port=8080 --target-port=80 \
  --name=backend-svc -n demo

# 방법 2: YAML로 생성 (정확한 제어)
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: backend-svc
  namespace: demo
spec:
  type: ClusterIP            # 생략 가능 (기본값)
  selector:
    app: backend
  ports:
  - port: 8080               # Service 포트
    targetPort: 80            # Pod 컨테이너 포트
    protocol: TCP
EOF

# 검증
kubectl get svc backend-svc -n demo
kubectl describe svc backend-svc -n demo
kubectl get endpoints backend-svc -n demo
```

**검증 기대 출력:**

```text
# kubectl get svc backend-svc -n demo
NAME          TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)    AGE
backend-svc   ClusterIP   10.96.x.x      <none>        8080/TCP   5s

# kubectl get endpoints backend-svc -n demo
NAME          ENDPOINTS           AGE
backend-svc   10.244.x.x:80       5s
```

```bash
# 정리
kubectl delete svc backend-svc -n demo
```

**핵심 포인트:**
- `port`는 Service가 노출하는 포트 (클라이언트가 접속하는 포트)
- `targetPort`는 Pod 컨테이너가 실제로 리스닝하는 포트
- `selector`의 레이블이 Pod의 레이블과 정확히 일치해야 한다

</details>

---

### 문제 2. NodePort Service 생성 및 외부 접근 [4%]

**컨텍스트:** `kubectl config use-context prod`

1. Deployment `web-app`을 이미지 `nginx:1.24`, 레플리카 2로 생성하라
2. NodePort Service `web-app-svc`를 생성하라 (포트 80, NodePort 31080)

<details>
<summary>풀이</summary>

```bash
kubectl config use-context prod

# 1. Deployment 생성
kubectl create deployment web-app --image=nginx:1.24 --replicas=2

# 2. NodePort Service 생성
# nodePort를 특정 값으로 지정하려면 YAML 사용
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: web-app-svc
spec:
  type: NodePort
  selector:
    app: web-app             # Deployment가 생성한 Pod의 레이블
  ports:
  - port: 80                 # Service 포트
    targetPort: 80            # Pod 포트
    nodePort: 31080           # 외부 접근 포트 (30000-32767)
EOF

# 검증
kubectl get svc web-app-svc
kubectl get endpoints web-app-svc
kubectl get pods -l app=web-app -o wide
```

**검증 기대 출력:**

```text
# kubectl get svc web-app-svc
NAME          TYPE       CLUSTER-IP     EXTERNAL-IP   PORT(S)        AGE
web-app-svc   NodePort   10.96.x.x      <none>        80:31080/TCP   5s

# kubectl get endpoints web-app-svc
NAME          ENDPOINTS                       AGE
web-app-svc   10.244.x.x:80,10.244.x.x:80    5s
```

```bash
# 접근 테스트 (노드 IP로)
# curl http://<node-ip>:31080

# 정리
kubectl delete deployment web-app
kubectl delete svc web-app-svc
```

**핵심 포인트:**
- `kubectl create deployment`으로 생성한 Pod는 `app=<deployment-name>` 레이블을 가진다
- nodePort를 특정 값으로 지정하려면 YAML을 사용해야 한다
- `kubectl expose` 명령으로는 nodePort를 지정할 수 없다

**트러블슈팅:** NodePort Service를 생성했는데 외부에서 접근이 안 되는 경우:
1. 방화벽에서 30000-32767 포트 범위가 열려 있는지 확인한다
2. `kubectl get endpoints`로 Endpoints가 비어 있지 않은지 확인한다
3. Pod가 Ready 상태인지 확인한다 (`kubectl get pods -l app=web-app`)

</details>

---

### 문제 3. DNS 조회 테스트 [4%]

**컨텍스트:** `kubectl config use-context dev`

다음 작업을 수행하고 결과를 저장하라:
1. `demo` 네임스페이스의 `nginx-web` Service의 FQDN을 nslookup으로 조회하라
2. 결과를 `/tmp/dns-output.txt`에 저장하라
3. `kube-system` 네임스페이스의 `kube-dns` Service IP를 `/tmp/dns-output.txt`에 추가하라

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 1+2. nslookup 결과 저장
kubectl run dns-lookup --image=busybox:1.28 -n demo --rm -it --restart=Never -- \
  nslookup nginx-web.demo.svc.cluster.local > /tmp/dns-output.txt

# 3. kube-dns Service IP 추가
echo "---" >> /tmp/dns-output.txt
kubectl get svc kube-dns -n kube-system \
  -o jsonpath='kube-dns ClusterIP: {.spec.clusterIP}{"\n"}' >> /tmp/dns-output.txt

# 결과 확인
cat /tmp/dns-output.txt
```

**검증 기대 출력:**

```text
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      nginx-web.demo.svc.cluster.local
Address 1: 10.96.x.x nginx-web.demo.svc.cluster.local
---
kube-dns ClusterIP: 10.96.0.10
```

**내부 동작 원리:** DNS 조회가 실행되면 Pod의 `/etc/resolv.conf`에 설정된 nameserver(kube-dns Service의 ClusterIP)로 쿼리가 전달된다. CoreDNS는 Kubernetes API를 Watch하여 Service 객체의 ClusterIP를 A 레코드로 반환한다. `busybox:1.28`을 사용하는 이유는 최신 busybox의 nslookup이 musl libc를 사용하여 search 도메인 처리가 다르기 때문이다.

**핵심 포인트:**
- DNS 테스트에는 항상 `busybox:1.28` 이미지를 사용한다 (최신 버전은 nslookup 동작이 다르다)
- `--rm`은 Pod 자동 삭제, `--restart=Never`는 Job이 아닌 일반 Pod으로 생성한다
- FQDN 형식: `<service>.<namespace>.svc.cluster.local`

</details>

---

### 문제 4. Service Endpoints 문제 해결 [7%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스에 `broken-svc` Service가 있다. 이 Service의 Endpoints가 비어있다. 원인을 찾고 수정하라.

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 문제 시뮬레이션
kubectl run test-app --image=nginx --labels="app=test-app" -n demo
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: broken-svc
  namespace: demo
spec:
  selector:
    app: wrong-label          # Pod 레이블과 불일치!
  ports:
  - port: 80
    targetPort: 80
EOF

# === 진단 시작 ===

# 1. Endpoints 확인 (첫 번째로 확인할 것!)
kubectl get endpoints broken-svc -n demo
# ENDPOINTS: <none> → 연결된 Pod가 없다

# 2. Service의 selector 확인
kubectl get svc broken-svc -n demo -o jsonpath='{.spec.selector}'
# {"app":"wrong-label"}

# 3. 해당 selector로 Pod 검색
kubectl get pods -n demo -l app=wrong-label
# No resources found → 이 레이블을 가진 Pod가 없다!

# 4. 네임스페이스의 모든 Pod 레이블 확인
kubectl get pods -n demo --show-labels | grep test-app
# test-app ... app=test-app

# 5. selector 수정
kubectl patch svc broken-svc -n demo \
  -p '{"spec":{"selector":{"app":"test-app"}}}'

# 6. 검증
kubectl get endpoints broken-svc -n demo
# Endpoints에 Pod IP가 표시됨

# 접근 테스트
kubectl run curl-test --image=curlimages/curl -n demo --rm -it --restart=Never -- \
  curl -s http://broken-svc.demo.svc.cluster.local

# 정리
kubectl delete svc broken-svc -n demo
kubectl delete pod test-app -n demo
```

**진단 체크리스트:**
1. `kubectl get endpoints` → 비어있으면 selector 문제
2. Service의 selector와 Pod의 labels 비교
3. targetPort가 Pod의 containerPort와 일치하는지 확인
4. Pod가 Running 상태이고 readinessProbe를 통과했는지 확인

</details>

---

### 문제 5. 멀티 포트 Service 생성 [4%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스의 `rabbitmq` Pod를 위한 Service를 생성하라:
- 이름: `rabbitmq-svc`
- AMQP 포트: 5672 (targetPort: 5672)
- Management 포트: 15672 (targetPort: 15672)
- 셀렉터: `app=rabbitmq`

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: rabbitmq-svc
  namespace: demo
spec:
  selector:
    app: rabbitmq
  ports:
  - name: amqp               # 멀티 포트일 때 name 필수!
    port: 5672
    targetPort: 5672
    protocol: TCP
  - name: management          # 각 포트에 고유한 이름
    port: 15672
    targetPort: 15672
    protocol: TCP
EOF

# 검증
kubectl get svc rabbitmq-svc -n demo
kubectl describe svc rabbitmq-svc -n demo

# 정리
kubectl delete svc rabbitmq-svc -n demo
```

**핵심 포인트:**
- **멀티 포트 Service에서는 각 포트에 `name` 필드가 필수이다!**
- name이 없으면 `spec.ports: Invalid value: ... must specify a port name` 에러 발생
- 단일 포트 Service에서는 name 생략 가능

</details>

---

### 문제 6. Headless Service 생성 [7%]

**컨텍스트:** `kubectl config use-context dev`

StatefulSet `redis-cluster`를 위한 Headless Service를 생성하고, 각 Pod의 DNS 이름을 확인하라:
- Service 이름: `redis-headless`
- 네임스페이스: `demo`
- 포트: 6379
- selector: `app=redis-cluster`

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# Headless Service 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: redis-headless
  namespace: demo
spec:
  clusterIP: None             # Headless Service의 핵심!
  selector:
    app: redis-cluster
  ports:
  - name: redis
    port: 6379
    targetPort: 6379
EOF

# Service 확인
kubectl get svc redis-headless -n demo
# CLUSTER-IP이 None으로 표시됨

# DNS 테스트 (Headless Service는 모든 Pod IP를 반환)
kubectl run dns-test --image=busybox:1.28 -n demo --rm -it --restart=Never -- \
  nslookup redis-headless.demo.svc.cluster.local

# StatefulSet이 있는 경우 개별 Pod DNS 테스트
# redis-cluster-0.redis-headless.demo.svc.cluster.local
# redis-cluster-1.redis-headless.demo.svc.cluster.local

# 정리
kubectl delete svc redis-headless -n demo
```

**검증 기대 출력:**

```text
# kubectl get svc redis-headless -n demo
NAME             TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)    AGE
redis-headless   ClusterIP   None         <none>        6379/TCP   5s

# nslookup redis-headless.demo.svc.cluster.local
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      redis-headless.demo.svc.cluster.local
Address 1: 10.244.1.x redis-cluster-0.redis-headless.demo.svc.cluster.local
Address 2: 10.244.2.x redis-cluster-1.redis-headless.demo.svc.cluster.local
```

**등장 배경:** 일반 ClusterIP Service는 가상 IP 하나만 반환하므로 클라이언트가 개별 Pod를 구분할 수 없다. 데이터베이스 클러스터(PostgreSQL primary/replica)나 메시지 큐(Kafka broker)처럼 각 인스턴스를 직접 지정해야 하는 경우에는 Pod 개별 DNS가 필요하다. Headless Service는 이 문제를 해결하기 위해 VIP 없이 Pod IP를 직접 A 레코드로 반환하는 메커니즘을 제공한다.

**핵심 포인트:**
- `clusterIP: None`이 Headless Service의 핵심 설정이다
- 일반 Service: DNS 조회 시 ClusterIP(1개)를 반환한다
- Headless Service: DNS 조회 시 모든 Pod IP를 반환한다
- StatefulSet과 함께 사용하면 `<pod-name>.<service-name>` 형태의 DNS를 제공한다

</details>

---

### 문제 7. ExternalName Service 생성 및 DNS 확인 [4%]

**컨텍스트:** `kubectl config use-context dev`

외부 데이터베이스 `database.example.com`을 가리키는 ExternalName Service를 생성하라:
- 이름: `external-db`
- 네임스페이스: `demo`

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# ExternalName Service 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: external-db
  namespace: demo
spec:
  type: ExternalName
  externalName: database.example.com
EOF

# 검증
kubectl get svc external-db -n demo
# TYPE이 ExternalName으로 표시

# DNS 확인 (CNAME 반환)
kubectl run dns-test --image=busybox:1.28 -n demo --rm -it --restart=Never -- \
  nslookup external-db.demo.svc.cluster.local
# database.example.com의 CNAME이 반환됨

# 정리
kubectl delete svc external-db -n demo
```

**핵심 포인트:**
- ExternalName은 CNAME DNS 레코드를 생성한다
- selector와 ports가 필요 없다
- 클러스터 내부에서 외부 서비스를 이름으로 접근할 때 사용

</details>

---

### 문제 8. CoreDNS 상태 확인 및 진단 [7%]

**컨텍스트:** `kubectl config use-context dev`

CoreDNS의 상태를 점검하고 다음 정보를 `/tmp/coredns-info.txt`에 저장하라:
1. CoreDNS Pod 수와 상태
2. CoreDNS Service(kube-dns)의 ClusterIP
3. CoreDNS ConfigMap의 forward 설정

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 1. CoreDNS Pod 상태
echo "=== CoreDNS Pods ===" > /tmp/coredns-info.txt
kubectl -n kube-system get pods -l k8s-app=kube-dns -o wide >> /tmp/coredns-info.txt
echo "" >> /tmp/coredns-info.txt

# 2. kube-dns Service ClusterIP
echo "=== kube-dns Service ===" >> /tmp/coredns-info.txt
kubectl -n kube-system get svc kube-dns >> /tmp/coredns-info.txt
echo "" >> /tmp/coredns-info.txt

# 3. CoreDNS ConfigMap의 forward 설정
echo "=== CoreDNS forward config ===" >> /tmp/coredns-info.txt
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | \
  grep -A2 "forward" >> /tmp/coredns-info.txt

# 결과 확인
cat /tmp/coredns-info.txt

# 추가 진단 명령어
# CoreDNS 로그 확인
kubectl -n kube-system logs -l k8s-app=kube-dns --tail=20

# DNS 해석 테스트
kubectl run dns-test --image=busybox:1.28 -n demo --rm -it --restart=Never -- \
  nslookup kubernetes.default.svc.cluster.local
```

**핵심 포인트:**
- CoreDNS Pod는 `k8s-app=kube-dns` 레이블을 가진다
- CoreDNS Service 이름은 `kube-dns`이다 (Pod는 coredns, Service는 kube-dns)
- ConfigMap 이름은 `coredns`이다

</details>

---

### 문제 9. Service 타입 변경 [4%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스의 기존 ClusterIP Service `web-svc`를 NodePort 타입으로 변경하고, nodePort를 30200으로 설정하라.

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 시뮬레이션: ClusterIP Service 생성
kubectl run web --image=nginx -n demo
kubectl expose pod web --port=80 --name=web-svc -n demo

# 현재 타입 확인
kubectl get svc web-svc -n demo
# TYPE: ClusterIP

# 타입 변경 방법 1: kubectl patch
kubectl patch svc web-svc -n demo \
  -p '{"spec":{"type":"NodePort","ports":[{"port":80,"targetPort":80,"nodePort":30200}]}}'

# 타입 변경 방법 2: kubectl edit
kubectl edit svc web-svc -n demo
# spec.type을 NodePort로, ports[0].nodePort를 30200으로 변경

# 검증
kubectl get svc web-svc -n demo
# TYPE: NodePort, PORT(S): 80:30200/TCP

# 정리
kubectl delete svc web-svc -n demo
kubectl delete pod web -n demo
```

**핵심 포인트:**
- `kubectl patch`로 Service 타입 변경 가능
- ClusterIP → NodePort → LoadBalancer 순서로 변경 가능
- NodePort → ClusterIP로 변경 시 nodePort 필드를 제거해야 한다

</details>

---

### 문제 10. kubectl expose 빠른 사용법 [4%]

**컨텍스트:** `kubectl config use-context prod`

다음 3개의 Service를 가능한 빠르게 생성하라:
1. Pod `api-server`를 ClusterIP Service로 노출 (포트 8080, 이름: `api-svc`)
2. Deployment `web-app`을 NodePort Service로 노출 (포트 80, 이름: `web-svc`)
3. Pod `redis`를 ClusterIP Service로 노출 (포트 6379, 이름: `redis-svc`)

<details>
<summary>풀이</summary>

```bash
kubectl config use-context prod

# 시뮬레이션: 리소스 생성
kubectl run api-server --image=nginx --port=8080
kubectl create deployment web-app --image=nginx --replicas=2
kubectl run redis --image=redis --port=6379

# 1. api-server Pod를 ClusterIP로 노출
kubectl expose pod api-server --port=8080 --name=api-svc

# 2. web-app Deployment를 NodePort로 노출
kubectl expose deployment web-app --port=80 --target-port=80 \
  --type=NodePort --name=web-svc

# 3. redis Pod를 ClusterIP로 노출
kubectl expose pod redis --port=6379 --name=redis-svc

# 검증
kubectl get svc api-svc web-svc redis-svc

# 정리
kubectl delete svc api-svc web-svc redis-svc
kubectl delete pod api-server redis
kubectl delete deployment web-app
```

**시험 팁:**
- `kubectl expose`는 YAML 없이 가장 빠르게 Service를 생성하는 방법
- Pod의 `--port` 옵션은 containerPort를 설정하고, expose의 `--port`는 Service 포트
- target-port를 생략하면 port와 같은 값으로 설정됨

</details>

---

### 문제 11. Service와 Pod 연결 진단 [7%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스에서 `app-service`로 접근이 되지 않는다. 다음 사항을 모두 확인하고 문제를 수정하라:
1. Service의 selector와 Pod의 label이 일치하는지
2. Service의 targetPort와 Pod의 containerPort가 일치하는지
3. Pod가 Ready 상태인지

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 장애 시뮬레이션
kubectl run app-pod --image=nginx --labels="app=myapp" --port=80 -n demo
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: app-service
  namespace: demo
spec:
  selector:
    app: wrong-app            # 문제 1: selector 불일치
  ports:
  - port: 80
    targetPort: 8080          # 문제 2: targetPort 불일치 (Pod는 80)
EOF

# === 체계적 진단 ===

# Step 1: Service 정보 확인
kubectl get svc app-service -n demo -o wide
# SELECTOR 컬럼에서 app=wrong-app 확인

# Step 2: Endpoints 확인 (가장 중요!)
kubectl get endpoints app-service -n demo
# ENDPOINTS: <none> → Pod와 연결 안 됨

# Step 3: Service selector 확인
kubectl get svc app-service -n demo -o jsonpath='{.spec.selector}'
# {"app":"wrong-app"}

# Step 4: Pod 레이블 확인
kubectl get pods -n demo --show-labels | grep app-pod
# app=myapp → 불일치!

# Step 5: Pod의 containerPort 확인
kubectl get pod app-pod -n demo -o jsonpath='{.spec.containers[0].ports[0].containerPort}'
# 80

# Step 6: 수정 — selector와 targetPort 모두 수정
kubectl patch svc app-service -n demo \
  -p '{"spec":{"selector":{"app":"myapp"},"ports":[{"port":80,"targetPort":80}]}}'

# Step 7: 검증
kubectl get endpoints app-service -n demo
# Pod IP가 표시됨

kubectl run curl-test --image=curlimages/curl -n demo --rm -it --restart=Never -- \
  curl -s http://app-service.demo.svc.cluster.local
# nginx 응답 확인

# 정리
kubectl delete svc app-service -n demo
kubectl delete pod app-pod -n demo
```

**Service 연결 진단 순서:**
```
1. kubectl get endpoints → 비어있으면 selector 문제
2. Service selector vs Pod labels 비교
3. Service targetPort vs Pod containerPort 비교
4. Pod Status = Running & Ready 확인
5. NetworkPolicy가 트래픽을 차단하는지 확인
```

</details>

---

### 문제 12. 서비스 디스커버리 종합 [7%]

**컨텍스트:** `kubectl config use-context dev`

다음 작업을 수행하라:
1. `demo` 네임스페이스에 Deployment `web-discovery`를 생성하라 (nginx:1.24, 레플리카 2)
2. ClusterIP Service `web-discovery-svc`를 생성하라 (포트 80)
3. 테스트 Pod에서 다음 3가지 방법으로 Service에 접근하고 결과를 `/tmp/discovery-test.txt`에 저장하라:
   - 서비스 이름만으로 접근: `web-discovery-svc`
   - 네임스페이스 포함: `web-discovery-svc.demo`
   - FQDN: `web-discovery-svc.demo.svc.cluster.local`

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# 1. Deployment 생성
kubectl create deployment web-discovery --image=nginx:1.24 --replicas=2 -n demo

# 2. Service 생성
kubectl expose deployment web-discovery --port=80 --name=web-discovery-svc -n demo

# 3. 접근 테스트
kubectl run discovery-test --image=curlimages/curl -n demo --rm -it --restart=Never -- \
  sh -c '
echo "=== Short name ===" > /tmp/result.txt
curl -s -o /dev/null -w "%{http_code}" http://web-discovery-svc >> /tmp/result.txt
echo "" >> /tmp/result.txt

echo "=== With namespace ===" >> /tmp/result.txt
curl -s -o /dev/null -w "%{http_code}" http://web-discovery-svc.demo >> /tmp/result.txt
echo "" >> /tmp/result.txt

echo "=== FQDN ===" >> /tmp/result.txt
curl -s -o /dev/null -w "%{http_code}" http://web-discovery-svc.demo.svc.cluster.local >> /tmp/result.txt
echo "" >> /tmp/result.txt

cat /tmp/result.txt
'

# 또는 호스트에서 결과 저장
kubectl run discovery-test --image=busybox:1.28 -n demo --rm -it --restart=Never -- sh -c '
echo "=== nslookup short name ==="
nslookup web-discovery-svc
echo ""
echo "=== nslookup with namespace ==="
nslookup web-discovery-svc.demo
echo ""
echo "=== nslookup FQDN ==="
nslookup web-discovery-svc.demo.svc.cluster.local
' > /tmp/discovery-test.txt

cat /tmp/discovery-test.txt

# 정리
kubectl delete deployment web-discovery -n demo
kubectl delete svc web-discovery-svc -n demo
```

**핵심 포인트:**
- 같은 네임스페이스 내에서는 서비스 이름만으로 접근 가능 (`web-discovery-svc`)
- 다른 네임스페이스의 서비스는 최소한 `<svc>.<namespace>`로 접근해야 함
- FQDN은 항상 `<svc>.<ns>.svc.cluster.local`

</details>

---

## 10. 복습 체크리스트

### 개념 확인

- [ ] ClusterIP, NodePort, LoadBalancer, ExternalName 4가지 타입의 차이를 설명할 수 있는가?
- [ ] NodePort 범위(30000-32767)를 기억하는가?
- [ ] Headless Service(`clusterIP: None`)의 DNS 동작을 이해하는가?
- [ ] Service DNS 형식(`<svc>.<ns>.svc.cluster.local`)을 암기했는가?
- [ ] Endpoints가 비어있을 때 진단 순서를 알고 있는가?
- [ ] externalTrafficPolicy의 Cluster와 Local 차이를 이해하는가?
- [ ] 멀티 포트 Service에서 name이 필수인 이유를 아는가?
- [ ] CoreDNS ConfigMap(Corefile)의 핵심 설정을 이해하는가?

### kubectl 명령어 확인

- [ ] `kubectl expose deployment <name> --port=80 --type=NodePort`
- [ ] `kubectl run test --image=busybox:1.28 --rm -it --restart=Never -- nslookup <svc>`
- [ ] `kubectl get endpoints <name>`
- [ ] `kubectl get svc -o wide` (selector 확인)
- [ ] `kubectl patch svc <name> -p '{"spec":{"type":"NodePort"}}'`

### 시험 핵심 팁

1. **Service 빠른 생성** — `kubectl expose`가 가장 빠르다. 특정 nodePort가 필요하면 YAML 사용
2. **DNS 테스트** — `busybox:1.28` 이미지의 `nslookup` 명령 사용
3. **Endpoints 확인** — Service 연결 문제의 첫 번째 진단 포인트는 항상 `kubectl get endpoints`
4. **멀티 포트** — 여러 포트가 있으면 각 포트에 `name` 필드 필수
5. **CoreDNS** — Pod 이름: coredns, Service 이름: kube-dns, ConfigMap 이름: coredns

---

## 내일 예고

**Day 13: NetworkPolicy & Ingress** — NetworkPolicy의 ingress/egress 규칙, OR/AND 조건 구분, Default Deny 패턴, Ingress 리소스 생성, CNI 플러그인 구조를 학습한다.

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속 (demo 앱의 Service 확인)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: Service 타입별 확인

```bash
# demo 네임스페이스의 모든 Service 확인
kubectl get svc -n demo -o wide
```

**예상 출력:**
```
NAME          TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)          AGE   SELECTOR
httpbin       ClusterIP   10.97.x.x       <none>        8000/TCP         5d    app=httpbin
keycloak      NodePort    10.97.x.x       <none>        8080:30888/TCP   5d    app=keycloak
nginx-web     NodePort    10.97.x.x       <none>        80:30080/TCP     5d    app=nginx-web
postgres-svc  ClusterIP   10.97.x.x       <none>        5432/TCP         5d    app=postgres
rabbitmq      ClusterIP   10.97.x.x       <none>        5672/TCP,15672/TCP  5d  app=rabbitmq
redis-svc     ClusterIP   10.97.x.x       <none>        6379/TCP         5d    app=redis
```

**동작 원리:** Service 타입별 차이:
1. **ClusterIP** (postgres, redis, rabbitmq): 클러스터 내부에서만 접근 가능하다. kube-proxy(또는 Cilium)가 iptables/eBPF 규칙으로 Pod에 트래픽을 분배한다
2. **NodePort** (nginx-web:30080, keycloak:30888): 모든 노드의 해당 포트로 외부에서 접근 가능하다. NodePort → ClusterIP → Pod 순으로 라우팅된다
3. Service의 CLUSTER-IP는 가상 IP(VIP)로, 실제 네트워크 인터페이스에 바인딩되지 않는다

### 실습 2: Endpoints 확인

```bash
# Service와 연결된 Endpoints 확인
kubectl get endpoints -n demo
```

**예상 출력:**
```
NAME          ENDPOINTS                         AGE
httpbin       10.20.1.22:8000,10.20.1.23:8000   5d
keycloak      10.20.1.35:8080                   5d
nginx-web     10.20.1.15:80                     5d
postgres-svc  10.20.1.30:5432                   5d
redis-svc     10.20.1.31:6379                   5d
```

**동작 원리:** Endpoints 오브젝트의 생성 과정:
1. Endpoints Controller가 Service의 `selector`와 매칭되는 Pod를 찾는다
2. 매칭된 Pod 중 Ready 상태인 Pod의 IP:Port를 Endpoints에 등록한다
3. httpbin에 2개의 Endpoints가 있는 이유: httpbin-v1과 httpbin-v2 모두 `app=httpbin` 라벨을 가진다
4. Pod가 Not Ready 상태가 되면 Endpoints에서 자동 제거된다 (Readiness Probe 연동)

### 실습 3: DNS 해석 확인

```bash
# 임시 Pod에서 DNS 조회
kubectl run dns-test --image=busybox:1.28 --rm -it --restart=Never -n demo -- nslookup nginx-web.demo.svc.cluster.local
```

**예상 출력:**
```
Server:    10.97.0.10
Address 1: 10.97.0.10 kube-dns.kube-system.svc.cluster.local

Name:      nginx-web.demo.svc.cluster.local
Address 1: 10.97.x.x nginx-web.demo.svc.cluster.local
```

**동작 원리:** CoreDNS 해석 과정:
1. Pod 내부의 `/etc/resolv.conf`에 `nameserver 10.97.0.10` (kube-dns Service IP)이 설정된다
2. `nslookup nginx-web.demo.svc.cluster.local` 쿼리가 CoreDNS로 전달된다
3. CoreDNS가 K8s API를 통해 Service 오브젝트의 ClusterIP를 조회한다
4. 같은 네임스페이스 내에서는 `nginx-web`만으로도 접근 가능하다 (search 도메인에 `demo.svc.cluster.local` 포함)

### 실습 4: NodePort 외부 접근 테스트

```bash
# NodePort로 nginx 접근 (dev-worker1의 IP 사용)
DEV_WORKER_IP=$(kubectl get node dev-worker1 -o jsonpath='{.status.addresses[0].address}')
echo "nginx URL: http://${DEV_WORKER_IP}:30080"

# curl로 접근 테스트
curl -s http://${DEV_WORKER_IP}:30080 | head -5
```

**동작 원리:** NodePort 트래픽 흐름:
1. 외부 클라이언트가 `dev-worker1:30080`으로 요청을 보낸다
2. Cilium(또는 kube-proxy)이 eBPF/iptables 규칙으로 트래픽을 수신한다
3. Service의 ClusterIP를 거쳐 실제 Pod IP(10.20.x.x:80)로 DNAT된다
4. 응답은 역순으로 SNAT되어 클라이언트에 반환된다
