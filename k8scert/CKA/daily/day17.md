# CKA Day 17: Troubleshooting 방법론 & 장애 시나리오

> CKA 도메인: **Troubleshooting (30%)** | 예상 소요 시간: 3시간

---

## 학습 목표

- [ ] Pod 상태별 진단 방법(CrashLoopBackOff, ImagePullBackOff, Pending, OOMKilled)을 숙지한다
- [ ] Node 장애 복구와 kubelet 문제 해결 절차를 익힌다
- [ ] Control Plane 컴포넌트(apiserver, scheduler, controller-manager, etcd) 장애를 진단한다
- [ ] DNS 장애와 네트워크 문제 해결 능력을 갖춘다
- [ ] Service 연결 문제를 체계적으로 해결한다
- [ ] 로그 분석 도구(kubectl logs, journalctl, crictl)를 능숙하게 사용한다
- [ ] 시험 패턴 12개 이상을 시간 내에 해결한다

---

## 1. 트러블슈팅이 왜 가장 중요한가?

### 1.1 등장 배경: 왜 체계적 트러블슈팅이 필요한가?

Kubernetes 클러스터는 다수의 분산 컴포넌트(API Server, etcd, kubelet, kube-proxy, CNI, CSI 등)로 구성된다. 장애 증상 하나가 여러 원인에 의해 발생할 수 있다. 예를 들어 Pod가 Pending인 이유는 리소스 부족, Taint 불일치, PVC 미바인딩, 노드 SchedulingDisabled 등 다양하다. 경험 기반으로 "이것 아닐까?" 하고 추측하면 시간을 낭비하게 된다. 계층별로 상태를 확인하고 증거를 수집하는 체계적 접근법이 필수적이다.

### 1.2 체계적 장애 분석 프레임워크

> **트러블슈팅 = 계층적 상태 검증 및 근본 원인 분석(RCA) 프로세스**
>
> Kubernetes 장애 대응은 다음 단계를 순차적으로 수행한다:
> 1. **상태 수집**: `kubectl get`, `kubectl describe`로 리소스 Status/Conditions 필드와 Events를 확인
> 2. **로그 분석**: `kubectl logs`, `journalctl`로 컨테이너 및 시스템 컴포넌트의 에러 로그를 추적
> 3. **근본 원인 식별**: 수집된 데이터를 기반으로 장애 원인을 분류 (설정 오류, 리소스 부족, 네트워크 단절, 인증 실패 등)
> 4. **수정 적용**: 매니페스트 수정, 서비스 재시작, 인증서 갱신 등 원인에 맞는 조치 수행
> 5. **검증**: 수정 후 정상 동작 확인 및 동일 장애 재발 방지를 위한 모니터링 설정

### 1.3 CKA에서 트러블슈팅은 30%

```
CKA 시험 도메인별 비중:
├── Cluster Architecture    25% ███████████████
├── Workloads & Scheduling  15% █████████
├── Services & Networking   20% ████████████
├── Storage                 10% ██████
└── Troubleshooting         30% ██████████████████  ← 가장 큰 비중!

트러블슈팅이 30%라는 것은:
- 17문제 중 약 5~6문제가 트러블슈팅
- 합격선(66%)을 넘으려면 트러블슈팅을 잘해야 함
- 다른 도메인(Storage, Service 등)의 문제도 트러블슈팅 요소 포함
```

---

## 2. 체계적 트러블슈팅 방법론

### 2.1 5단계 접근법

```
1단계: 문제 파악 (What's wrong?)
   └→ kubectl get pods/nodes/svc → 비정상 상태 확인

2단계: 증상 분석 (Why is it wrong?)
   └→ kubectl describe → Events 섹션 확인
   └→ kubectl logs → 에러 메시지 확인

3단계: 원인 파악 (Root cause)
   └→ 설정 오류? 리소스 부족? 네트워크 문제? 인증서 만료?

4단계: 해결 (Fix)
   └→ 설정 수정, Pod 재생성, 서비스 재시작

5단계: 검증 (Verify)
   └→ 문제가 해결되었는지 최종 확인
```

### 2.2 핵심 진단 명령어 총정리

```bash
# ===== Pod 진단 =====
kubectl get pods -o wide                    # Pod 상태, 노드, IP 확인
kubectl get pods -A                         # 모든 네임스페이스
kubectl describe pod <name>                 # 상세 정보 (Events가 핵심!)
kubectl logs <name>                         # 현재 컨테이너 로그
kubectl logs <name> --previous              # 이전(재시작 전) 컨테이너 로그
kubectl logs <name> -c <container>          # 특정 컨테이너 로그
kubectl logs <name> --tail=50               # 마지막 50줄만
kubectl logs <name> -f                      # 실시간 로그 스트리밍
kubectl exec <name> -- <command>            # Pod 내에서 명령 실행
kubectl exec -it <name> -- sh              # Pod 셸 접속

# ===== 이벤트 확인 =====
kubectl get events --sort-by='.lastTimestamp'          # 시간순 정렬
kubectl get events -A --sort-by='.lastTimestamp'       # 모든 네임스페이스
kubectl get events --field-selector type=Warning       # Warning만

# ===== Node 진단 =====
kubectl get nodes                           # 노드 상태
kubectl describe node <name>               # 노드 상세 (Conditions 핵심!)
kubectl top nodes                          # 리소스 사용량
kubectl top pods [-A]                      # Pod 리소스 사용량

# ===== 노드 SSH 후 진단 =====
systemctl status kubelet                   # kubelet 상태
journalctl -u kubelet -f                   # kubelet 실시간 로그
journalctl -u kubelet --since "10 min ago" --no-pager  # 최근 10분 로그
systemctl status containerd                # containerd 상태
crictl ps [-a]                             # 컨테이너 목록
crictl logs <container-id>                 # 컨테이너 로그
crictl inspect <container-id>              # 컨테이너 상세

# ===== 네트워크 진단 =====
kubectl get svc,endpoints                  # Service와 Endpoints
kubectl get svc -o wide                    # selector 포함
kubectl run debug --image=nicolaka/netshoot --rm -it --restart=Never -- bash
# → nslookup, curl, dig, traceroute 등 네트워크 도구 사용 가능

# ===== Control Plane 진단 =====
kubectl get pods -n kube-system            # Control Plane Pod 상태
kubectl logs -n kube-system <component>    # 컴포넌트 로그
# SSH 접속 후:
ls /etc/kubernetes/manifests/              # Static Pod 매니페스트
crictl ps | grep -E "apiserver|scheduler|controller|etcd"
```

---

## 3. Pod 상태별 진단 가이드

### 3.1 Pod 상태 전체 비교표

| 상태 | 원인 | 핵심 진단 | 해결 방법 |
|---|---|---|---|
| **Pending** | 스케줄링 실패 | `describe pod` Events | 리소스/노드/PV 확인 |
| **ContainerCreating** | 이미지 풀링 중/CNI 문제 | `describe pod` Events | 이미지/CNI/Secret 확인 |
| **Running** | 정상 | - | - |
| **CrashLoopBackOff** | 컨테이너 반복 크래시 | `logs --previous` | 명령어/설정 수정 |
| **ImagePullBackOff** | 이미지 풀 실패 | `describe pod` Events | 이미지명/레지스트리 수정 |
| **Error** | 컨테이너 비정상 종료 | `logs`, Exit Code | 코드/설정 확인 |
| **OOMKilled** | 메모리 초과 | `describe pod` | limits.memory 증가 |
| **Terminating** | 삭제 진행 중 | `describe pod` | 강제 삭제 필요시 |
| **Unknown** | 노드 통신 불가 | 노드 상태 확인 | kubelet/네트워크 복구 |
| **Completed** | Job 정상 완료 | - | 정상 상태 |

### 3.2 Pending Pod 진단

```
Pending 원인 흐름도:

kubectl describe pod <name>
       │
       ├→ "0/3 nodes are available: insufficient cpu/memory"
       │   → 원인: 리소스 부족
       │   → 해결: requests 줄이기 또는 노드 추가
       │
       ├→ "0/3 nodes are available: node(s) had taint ... that the pod didn't tolerate"
       │   → 원인: Taint/Toleration 불일치
       │   → 해결: toleration 추가 또는 taint 제거
       │
       ├→ "0/3 nodes are available: node(s) didn't match node selector"
       │   → 원인: nodeSelector/nodeAffinity 불일치
       │   → 해결: 레이블 확인/수정 또는 nodeSelector 수정
       │
       ├→ "persistentvolumeclaim ... not found" 또는 "unbound"
       │   → 원인: PVC 없거나 Pending
       │   → 해결: PVC 생성 또는 PV/StorageClass 확인
       │
       └→ "no nodes available to schedule pods"
           → 원인: 모든 노드가 SchedulingDisabled
           → 해결: kubectl uncordon <node>
```

```yaml
# Pending Pod 진단 예시
# 1. Pod 상태 확인
# kubectl get pod pending-pod -n demo
# NAME          READY   STATUS    RESTARTS   AGE
# pending-pod   0/1     Pending   0          5m

# 2. 이벤트 확인
# kubectl describe pod pending-pod -n demo
# Events:
#   Type     Reason            Message
#   ----     ------            -------
#   Warning  FailedScheduling  0/3 nodes are available:
#            1 node(s) had taint, 2 Insufficient cpu

# 3. 노드 리소스 확인
# kubectl describe node <name> | grep -A5 "Allocated resources"
# kubectl top nodes
```

### 3.3 CrashLoopBackOff 진단

```
CrashLoopBackOff 진단 흐름:

kubectl get pod → CrashLoopBackOff
       │
       ▼
kubectl logs <pod> --previous        ← 이전 컨테이너의 로그 확인
       │
       ├→ "exec format error"
       │   → 원인: 잘못된 아키텍처 이미지 (ARM vs x86)
       │
       ├→ "No such file or directory"
       │   → 원인: 잘못된 command/args
       │   → 해결: command 수정 또는 파일 확인
       │
       ├→ 에러 메시지 없이 즉시 종료
       │   → 원인: 프로세스가 포그라운드로 실행되지 않음
       │   → 해결: command에 sleep이나 데몬 프로세스 추가
       │
       └→ 애플리케이션 에러 로그
           → 원인: 앱 설정 오류 (DB 연결 실패 등)
           → 해결: 환경변수/ConfigMap/Secret 확인

Exit Code 해석:
  0: 정상 종료 (CronJob에서는 정상)
  1: 애플리케이션 오류 (가장 흔함)
  126: 권한 문제 (실행 불가)
  127: 명령어 없음 (command not found)
  128+N: 시그널 N으로 종료
  137: SIGKILL (OOMKilled 또는 kill -9)
  139: SIGSEGV (세그멘테이션 폴트)
  143: SIGTERM (정상 종료 요청)
```

### 3.4 ImagePullBackOff 진단

**내부 동작 원리:** kubelet이 컨테이너 런타임(containerd)에 이미지 풀을 요청한다. 풀이 실패하면 kubelet은 exponential backoff(10초, 20초, 40초... 최대 5분)로 재시도한다. 이 재시도 대기 상태가 ImagePullBackOff이다. ErrImagePull은 최초 실패 직후 상태이고, ImagePullBackOff는 backoff 대기 중인 상태이다.

```
ImagePullBackOff 원인:

kubectl describe pod → Events 확인
       │
       ├→ "repository does not exist" 또는 "not found"
       │   → 원인: 이미지 이름/태그 오타
       │   → 해결: 정확한 이미지:태그 확인
       │
       ├→ "unauthorized" 또는 "access denied"
       │   → 원인: 프라이빗 레지스트리 인증 실패
       │   → 해결: imagePullSecrets 설정
       │
       ├→ "dial tcp: lookup ... no such host"
       │   → 원인: 레지스트리 DNS 해석 실패
       │   → 해결: 네트워크/DNS 확인
       │
       └→ "timeout"
           → 원인: 네트워크 문제/레지스트리 다운
           → 해결: 네트워크 연결 확인
```

**검증 명령어:**

```bash
kubectl describe pod broken-image -n demo | grep -A10 Events
```

```text
Events:
  Type     Reason     Age                From               Message
  ----     ------     ----               ----               -------
  Normal   Scheduled  2m                 default-scheduler  Successfully assigned demo/broken-image to worker1
  Normal   Pulling    30s (x4 over 2m)   kubelet            Pulling image "nginx:nonexistent"
  Warning  Failed     30s (x4 over 2m)   kubelet            Failed to pull image "nginx:nonexistent": rpc error: code = NotFound
  Warning  Failed     30s (x4 over 2m)   kubelet            Error: ImagePullBackOff
```

### 3.5 OOMKilled 진단

```yaml
# OOMKilled 확인
# kubectl describe pod <name>
#   State:       Terminated
#     Reason:    OOMKilled
#     Exit Code: 137

# 해결: memory limits 증가
apiVersion: v1
kind: Pod
metadata:
  name: oom-fix
spec:
  containers:
  - name: app
    image: my-app
    resources:
      requests:
        memory: "256Mi"         # 기본 요청량
      limits:
        memory: "512Mi"         # 최대 사용량 (이전보다 증가)
```

---

## 4. Node 문제 진단

### 4.1 Node 상태 확인

```
Node 장애 진단 흐름:

kubectl get nodes
       │
       ├→ Ready: 정상
       ├→ NotReady: kubelet/containerd 문제
       ├→ SchedulingDisabled: cordon 상태
       └→ Unknown: 노드와 통신 불가

kubectl describe node <name>
  → Conditions 섹션 확인:
  ┌─────────────────────┬──────────────────────────┐
  │ Condition           │ 의미                      │
  ├─────────────────────┼──────────────────────────┤
  │ Ready=True          │ 정상                      │
  │ Ready=False         │ kubelet 문제              │
  │ Ready=Unknown       │ 노드 통신 불가            │
  │ MemoryPressure=True │ 메모리 부족               │
  │ DiskPressure=True   │ 디스크 부족               │
  │ PIDPressure=True    │ 프로세스 수 초과          │
  │ NetworkUnavailable  │ 네트워크/CNI 문제         │
  └─────────────────────┴──────────────────────────┘
```

### 4.2 kubelet 장애 복구

**내부 동작 원리:** kubelet은 각 노드에서 실행되는 에이전트로, API Server에 주기적으로 하트비트(NodeLease)를 보낸다. 기본 40초(node-status-update-frequency 10초 x lease-duration-seconds 40초) 동안 하트비트가 없으면 Node Controller가 노드를 NotReady로 표시한다. 5분 이상 NotReady가 지속되면 해당 노드의 Pod에 Taint가 추가되어 퇴거(eviction)가 시작된다.

```bash
# SSH로 노드 접속
ssh admin@<node-ip>

# 1. kubelet 상태 확인
sudo systemctl status kubelet
# Active: inactive (dead) → kubelet 중지됨
# Active: failed → kubelet 오류

# 2. kubelet 로그 확인
sudo journalctl -u kubelet --no-pager -n 50
sudo journalctl -u kubelet --since "5 min ago"

# 일반적인 kubelet 에러:
# - "failed to load kubelet config file" → config.yaml 문제
# - "unable to load bootstrap kubeconfig" → kubeconfig 문제
# - "failed to run Kubelet: unable to determine runtime API" → containerd 문제
# - "certificate has expired" → 인증서 만료

# 3. 복구
sudo systemctl restart kubelet
# 또는
sudo systemctl enable --now kubelet

# 4. containerd 확인 (kubelet이 의존)
sudo systemctl status containerd
sudo systemctl restart containerd  # 필요시
sudo systemctl restart kubelet     # containerd 재시작 후 kubelet도 재시작

# 5. 상태 확인
sudo systemctl status kubelet
# Active: active (running)
```

### 4.3 디스크/메모리/인증서 문제

```bash
# 디스크 확인
df -h
# /dev/sda1  20G  19G  1G  95% /  → 디스크 거의 꽉 참!
# 해결: 불필요한 이미지/컨테이너 정리
sudo crictl rmi --prune
sudo journalctl --vacuum-size=100M

# 메모리 확인
free -m
# total  used  free  shared  buff/cache  available
# 4096   3900  100   50      96          96  → 메모리 부족!

# 인증서 만료 확인
sudo kubeadm certs check-expiration
# 또는
sudo openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -dates
# notAfter=Mar 15 00:00:00 2025 GMT → 만료일 확인

# 인증서 갱신
sudo kubeadm certs renew all
sudo systemctl restart kubelet
```

---

## 5. Control Plane 컴포넌트 장애

### 5.1 컴포넌트별 장애 증상

```
Control Plane 장애 매핑:

┌──────────────────┬──────────────────────────┬────────────────────────┐
│ 컴포넌트          │ 장애 증상                │ 진단 방법              │
├──────────────────┼──────────────────────────┼────────────────────────┤
│ kube-apiserver   │ kubectl 응답 없음        │ crictl ps | grep api   │
│                  │ "connection refused"     │ crictl logs <id>       │
│                  │                          │ /etc/kubernetes/       │
│                  │                          │   manifests/kube-      │
│                  │                          │   apiserver.yaml       │
├──────────────────┼──────────────────────────┼────────────────────────┤
│ kube-scheduler   │ 새 Pod가 Pending        │ crictl ps | grep sched │
│                  │ "no nodes available"     │ kubectl logs -n kube-  │
│                  │                          │   system kube-scheduler│
├──────────────────┼──────────────────────────┼────────────────────────┤
│ controller-mgr   │ Deployment 업데이트 안됨 │ crictl ps | grep ctrl  │
│                  │ ReplicaSet 미생성        │ kubectl logs -n kube-  │
│                  │ Endpoints 업데이트 안됨  │   system kube-         │
│                  │                          │   controller-manager   │
├──────────────────┼──────────────────────────┼────────────────────────┤
│ etcd             │ 데이터 접근 불가         │ crictl ps | grep etcd  │
│                  │ apiserver 장애 발생      │ etcdctl endpoint       │
│                  │                          │   health               │
└──────────────────┴──────────────────────────┴────────────────────────┘
```

### 5.2 Static Pod 매니페스트 문제

```bash
# Control Plane 컴포넌트는 Static Pod로 실행된다
# 매니페스트 위치: /etc/kubernetes/manifests/

ls /etc/kubernetes/manifests/
# etcd.yaml
# kube-apiserver.yaml
# kube-controller-manager.yaml
# kube-scheduler.yaml

# 파일을 수정하면 kubelet이 자동으로 Pod를 재시작한다

# 일반적인 Static Pod 문제:
# 1. YAML 문법 오류 (들여쓰기, 오타)
# 2. 잘못된 인증서 경로
# 3. 잘못된 포트 번호
# 4. 잘못된 etcd 엔드포인트
# 5. 잘못된 플래그/옵션

# 진단 예시:
sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml | grep -E "cert|key|port|etcd"

# crictl로 컨테이너 상태 확인
sudo crictl ps -a | grep -E "apiserver|scheduler|controller|etcd"
# Exited 상태면 → crictl logs <container-id>로 에러 확인
```

### 5.3 kube-apiserver 장애 복구 예시

**등장 배경:** Control Plane 컴포넌트(apiserver, scheduler, controller-manager, etcd)는 kubeadm으로 설치한 클러스터에서 Static Pod로 실행된다. Static Pod는 kubelet이 `/etc/kubernetes/manifests/` 디렉터리를 감시하여 YAML 파일을 직접 관리한다. 따라서 매니페스트 파일에 오타가 있으면 컴포넌트가 시작되지 않고, API Server가 멈추면 kubectl 자체가 동작하지 않으므로 SSH로 직접 노드에 접속하여 디버깅해야 한다.

```bash
# 증상: kubectl 명령이 응답하지 않음
# The connection to the server was refused

# SSH 접속
ssh admin@<master-ip>

# 1. apiserver 컨테이너 확인
sudo crictl ps -a | grep apiserver
# 상태가 Exited면 장애

# 2. 로그 확인
APISERVER_ID=$(sudo crictl ps -a | grep apiserver | head -1 | awk '{print $1}')
sudo crictl logs $APISERVER_ID 2>&1 | tail -20

# 3. 일반적인 에러 메시지와 해결:
# "open /etc/kubernetes/pki/apiserver.crt: no such file" → 인증서 경로 오류
# "bind: address already in use" → 포트 충돌
# "dial tcp 127.0.0.1:2379: connect: connection refused" → etcd 연결 실패

# 4. 매니페스트 확인 및 수정
sudo cat /etc/kubernetes/manifests/kube-apiserver.yaml
# 오류 찾기
sudo vi /etc/kubernetes/manifests/kube-apiserver.yaml
# 수정 후 저장 → kubelet이 자동 재시작

# 5. 복구 확인 (30초 정도 대기)
sleep 30
sudo crictl ps | grep apiserver
# Running 상태 확인

# SSH 종료 후
kubectl get nodes
# 정상 응답
```

---

## 6. DNS 문제 진단

### 6.1 DNS 진단 흐름

```
DNS 장애 진단 흐름:

증상: Pod에서 서비스 이름으로 접근 불가
       │
       ▼
1. CoreDNS Pod 상태 확인
   kubectl -n kube-system get pods -l k8s-app=kube-dns
       │
       ├→ Running이 아님 → CoreDNS Pod 문제
       │   └→ describe/logs로 원인 파악
       │
       └→ Running → 다음 단계
              │
              ▼
2. kube-dns Service/Endpoints 확인
   kubectl -n kube-system get svc kube-dns
   kubectl -n kube-system get endpoints kube-dns
       │
       ├→ Endpoints 비어있음 → Service selector 문제
       │
       └→ 정상 → 다음 단계
              │
              ▼
3. DNS 쿼리 테스트
   kubectl run dns-test --image=busybox:1.28 --rm -it --restart=Never -- \
     nslookup kubernetes.default.svc.cluster.local
       │
       ├→ 성공 → 특정 서비스 DNS 문제
       │   └→ Service가 존재하는지, 네임스페이스 맞는지 확인
       │
       └→ 실패 → CoreDNS ConfigMap 확인
           └→ kubectl -n kube-system get cm coredns -o yaml
```

### 6.2 CoreDNS 문제 해결

```bash
# CoreDNS Pod 상태 확인
kubectl -n kube-system get pods -l k8s-app=kube-dns
# CrashLoopBackOff → ConfigMap 오류 가능성

# CoreDNS 로그 확인
kubectl -n kube-system logs -l k8s-app=kube-dns --tail=30

# CoreDNS ConfigMap 확인
kubectl -n kube-system get configmap coredns -o yaml
# Corefile 문법 오류가 있는지 확인

# CoreDNS 재시작
kubectl -n kube-system rollout restart deployment coredns

# DNS 테스트
kubectl run dns-test --image=busybox:1.28 --rm -it --restart=Never -- \
  nslookup kubernetes.default.svc.cluster.local

# Pod의 /etc/resolv.conf 확인
kubectl exec <pod> -- cat /etc/resolv.conf
# nameserver 10.96.0.10 ← kube-dns ClusterIP와 일치해야 함
```

---

## 7. Service 연결 문제 진단

### 7.1 Service 연결 진단 체크리스트

```
Service 접근 불가 진단 순서:

1. Service 존재 확인
   kubectl get svc <name> -n <ns>
       │
       └→ 없으면 → 생성하라는 문제일 수 있음

2. Endpoints 확인 (가장 중요!)
   kubectl get endpoints <name> -n <ns>
       │
       ├→ <none> 또는 비어있음
       │   → Service selector와 Pod label 불일치
       │   → Pod가 Running 상태가 아님
       │   → Pod의 readinessProbe 실패
       │
       └→ IP가 있음 → 다음 단계

3. targetPort 확인
   Service의 targetPort == Pod의 containerPort인지
   kubectl get svc <name> -o jsonpath='{.spec.ports[0].targetPort}'
   kubectl get pod <name> -o jsonpath='{.spec.containers[0].ports[0].containerPort}'

4. Pod 상태 확인
   kubectl get pods -l <selector-labels>
   → Running이고 Ready인지

5. 네트워크 접근 테스트
   kubectl run curl --image=curlimages/curl --rm -it --restart=Never -- \
     curl -s http://<service-name>.<namespace>.svc.cluster.local

6. NetworkPolicy 확인
   kubectl get networkpolicy -n <ns>
   → 트래픽을 차단하는 정책이 있는지
```

### 7.2 Endpoints 디버깅

```bash
# Endpoints가 비어있는 원인 찾기

# 1. Service의 selector 확인
kubectl get svc <name> -o jsonpath='{.spec.selector}'
# {"app":"web"} → app=web인 Pod를 찾음

# 2. 해당 selector로 Pod 검색
kubectl get pods -l app=web
# → Pod가 없거나 Running이 아니면 Endpoints가 비어있음

# 3. Pod의 label 확인
kubectl get pods --show-labels
# → selector와 일치하지 않으면 수정

# 4. Pod의 Ready 상태 확인
kubectl get pods -l app=web -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}'
# → Ready=False면 readinessProbe 확인
```

---

## 8. 실전 장애 시나리오 (15개)

### 시나리오 1: ImagePullBackOff

```yaml
# 장애 생성
apiVersion: v1
kind: Pod
metadata:
  name: broken-image
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx:nonexistent-tag-12345    # 존재하지 않는 태그

# 진단
# kubectl get pod broken-image -n demo
# STATUS: ImagePullBackOff
# kubectl describe pod broken-image -n demo | grep -A5 Events
# "Failed to pull image"

# 복구
# kubectl set image pod/broken-image app=nginx:1.24 -n demo
# 또는 Pod 재생성
```

### 시나리오 2: CrashLoopBackOff (잘못된 명령어)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: crash-cmd
  namespace: demo
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "exit 1"]       # 항상 실패

# 진단: kubectl logs crash-cmd --previous
# 복구: command를 정상 명령으로 변경
```

### 시나리오 3: CrashLoopBackOff (파일 없음)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: crash-file
  namespace: demo
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "cat /config/app.conf"]  # 파일 없음

# 진단: kubectl logs crash-file --previous
# "cat: can't open '/config/app.conf': No such file or directory"
# 복구: ConfigMap 볼륨 추가 또는 command 수정
```

### 시나리오 4: Pending (리소스 부족)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: resource-heavy
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx
    resources:
      requests:
        cpu: "100"                        # 100 CPU 요청 (불가능!)
        memory: "100Gi"                    # 100Gi 메모리 요청

# 진단: kubectl describe pod resource-heavy
# "0/3 nodes are available: insufficient cpu"
# 복구: requests를 적절한 값으로 수정
```

### 시나리오 5: Pending (nodeSelector 불일치)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: wrong-selector
  namespace: demo
spec:
  nodeSelector:
    gpu: "true"                           # 이 레이블을 가진 노드가 없음
  containers:
  - name: app
    image: nginx

# 진단: kubectl describe pod wrong-selector
# "node(s) didn't match Pod's node affinity/selector"
# 복구: nodeSelector 제거 또는 노드에 레이블 추가
```

### 시나리오 6: Pending (PVC 미바인딩)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: pvc-pending
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: data
      mountPath: /data
  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: nonexistent-pvc          # 존재하지 않는 PVC

# 진단: kubectl describe pod pvc-pending
# "persistentvolumeclaim "nonexistent-pvc" not found"
# 복구: PVC 생성
```

### 시나리오 7: OOMKilled

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: oom-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: progrium/stress
    command: ["stress", "--vm", "1", "--vm-bytes", "256M"]
    resources:
      limits:
        memory: "128Mi"                   # 128Mi 제한에 256Mi 사용 시도

# 진단: kubectl describe pod oom-pod
# "OOMKilled", Exit Code: 137
# 복구: limits.memory 증가
```

### 시나리오 8: Service Endpoints 비어있음

```bash
# 장애 생성
kubectl run web --image=nginx --labels="app=web" -n demo
kubectl expose pod web --port=80 --name=broken-svc -n demo

# selector 수정하여 불일치 생성
kubectl patch svc broken-svc -n demo -p '{"spec":{"selector":{"app":"wrong"}}}'

# 진단
kubectl get endpoints broken-svc -n demo  # <none>
kubectl get svc broken-svc -n demo -o jsonpath='{.spec.selector}'
kubectl get pods -n demo --show-labels

# 복구
kubectl patch svc broken-svc -n demo -p '{"spec":{"selector":{"app":"web"}}}'
```

### 시나리오 9: kubelet 중지

```bash
# SSH 접속 후
sudo systemctl stop kubelet

# 다른 터미널에서
kubectl get nodes  # NotReady 상태

# 복구
sudo systemctl start kubelet
# 40초 후 Ready 상태로 복귀
```

### 시나리오 10: kube-apiserver 매니페스트 오류

```bash
# SSH 접속 후
# 매니페스트에 오타 삽입
sudo sed -i 's/--secure-port=6443/--secure-port=6444/' \
  /etc/kubernetes/manifests/kube-apiserver.yaml

# kubectl 명령 실패
# "The connection to the server was refused"

# 복구
sudo sed -i 's/--secure-port=6444/--secure-port=6443/' \
  /etc/kubernetes/manifests/kube-apiserver.yaml
# kubelet이 자동으로 apiserver 재시작
```

### 시나리오 11: CoreDNS CrashLoopBackOff

```bash
# CoreDNS ConfigMap에 오타 삽입
kubectl -n kube-system edit configmap coredns
# Corefile에 문법 오류 추가

# CoreDNS Pod가 CrashLoopBackOff
kubectl -n kube-system get pods -l k8s-app=kube-dns

# 복구: ConfigMap 수정
kubectl -n kube-system edit configmap coredns
# 문법 오류 수정 후 CoreDNS 재시작
kubectl -n kube-system rollout restart deployment coredns
```

### 시나리오 12: containerd 장애

```bash
# SSH 접속 후
sudo systemctl stop containerd

# kubectl에서 노드 NotReady, Pod 상태 Unknown

# 복구
sudo systemctl start containerd
sudo systemctl restart kubelet
```

### 시나리오 13: NetworkPolicy에 의한 차단

```bash
# 모든 인바운드 차단
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all
  namespace: demo
spec:
  podSelector: {}
  policyTypes:
  - Ingress
EOF

# 서비스 접근 불가 → NetworkPolicy 확인
kubectl get networkpolicy -n demo
kubectl describe networkpolicy deny-all -n demo

# 해결: 정책 삭제 또는 허용 규칙 추가
```

### 시나리오 14: Taint에 의한 Pending

```bash
# 모든 노드에 Taint 추가
kubectl taint nodes --all special=true:NoSchedule

# 새 Pod가 Pending
# 진단: kubectl describe pod → taint toleration 관련 메시지

# 해결: Taint 제거
kubectl taint nodes --all special=true:NoSchedule-
```

### 시나리오 15: readinessProbe 실패로 Endpoints 제외

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: unready-pod
  namespace: demo
  labels:
    app: unready
spec:
  containers:
  - name: app
    image: nginx
    readinessProbe:
      httpGet:
        path: /healthz              # 이 경로가 없으면 503
        port: 80
      initialDelaySeconds: 5
      periodSeconds: 5

# Pod는 Running이지만 Ready=0/1
# Service Endpoints에서 제외됨
# 진단: kubectl describe pod → Readiness probe failed
```

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터 접속 (실제 워크로드가 실행 중인 환경에서 트러블슈팅)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl config use-context dev
```

### 실습 1: Pod 상태 체계적 진단

```bash
# 모든 네임스페이스에서 비정상 Pod 확인
kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded

# demo 네임스페이스 Pod 상태 상세 확인
kubectl get pods -n demo -o custom-columns='NAME:.metadata.name,STATUS:.status.phase,READY:.status.containerStatuses[0].ready,RESTARTS:.status.containerStatuses[0].restartCount'

# 특정 Pod의 이벤트 확인 (장애 원인 파악의 핵심)
kubectl describe pod -n demo $(kubectl get pods -n demo -o name | head -1) | tail -20
```

**예상 출력:**
```
NAME              STATUS    READY   RESTARTS
nginx-xxxxx       Running   true    0
postgresql-0      Running   true    0
redis-0           Running   true    0
httpbin-v1-xxxxx  Running   true    0
```

**동작 원리:**
1. `--field-selector`로 서버 측 필터링을 수행하여 비정상 Pod만 빠르게 찾는다
2. `RESTARTS` 수치가 높으면 CrashLoopBackOff를 의심한다
3. `kubectl describe`의 Events 섹션이 가장 중요한 진단 정보를 제공한다
4. Events는 시간순으로 정렬되며, Warning 타입에 장애 원인이 기록된다

### 실습 2: 로그 분석과 컨테이너 디버깅

```bash
# nginx Pod 로그 확인
kubectl logs -n demo -l app=nginx --tail=10

# Istio sidecar 로그 확인 (멀티 컨테이너 Pod)
kubectl logs -n demo -l app=nginx -c istio-proxy --tail=5

# Pod 내부 접속하여 네트워크 상태 확인
kubectl exec -n demo -it $(kubectl get pod -n demo -l app=nginx -o name | head -1) -- \
  sh -c "curl -s localhost:80 > /dev/null && echo 'nginx OK' || echo 'nginx FAIL'"
```

**예상 출력:**
```
nginx OK
```

**동작 원리:**
1. `-c` 플래그로 멀티 컨테이너 Pod에서 특정 컨테이너의 로그를 선택한다
2. `--tail=N`으로 최근 N줄만 출력하여 로그 양을 제한한다
3. `kubectl exec`로 Pod 내부에서 직접 연결을 테스트하여 네트워크 문제를 분리한다
4. localhost 접근이 성공하면 컨테이너 자체는 정상이고 네트워크/Service 설정을 확인해야 한다

### 실습 3: platform 클러스터 Control Plane 건강 확인

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml

# Control Plane 컴포넌트 상태 확인
kubectl get componentstatuses 2>/dev/null || echo "componentstatuses deprecated, checking pods..."
kubectl get pods -n kube-system -o custom-columns='COMPONENT:.metadata.name,STATUS:.status.phase,RESTARTS:.status.containerStatuses[0].restartCount'

# API Server 응답 시간 측정
kubectl get --raw /healthz
kubectl get --raw /readyz
```

**예상 출력:**
```
COMPONENT                                   STATUS    RESTARTS
etcd-platform-master                        Running   0
kube-apiserver-platform-master              Running   0
kube-controller-manager-platform-master     Running   0
kube-scheduler-platform-master              Running   0

ok
ok
```

**동작 원리:**
1. `/healthz`와 `/readyz` 엔드포인트로 API Server의 건강 상태를 빠르게 확인한다
2. Control Plane Pod의 RESTARTS가 0이 아니면 장애 이력이 있으므로 로그를 확인해야 한다
3. `kubectl logs -n kube-system kube-apiserver-platform-master`로 API Server 에러 로그를 추적한다
4. etcd 장애 시 API Server 응답이 느려지거나 실패하므로 etcd 상태를 우선 점검한다

