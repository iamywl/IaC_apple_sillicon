# 트러블슈팅 가이드(Troubleshooting Guide) — 실전 디버깅 방법론(Practical Debugging Methodology)

## 1. 트러블슈팅 프레임워크(Troubleshooting Framework)

모든 장애(Incident)는 다음 단계로 접근한다:

```
1. 증상 확인(Symptom)    → 무엇이 동작하지 않는가?(What is not working?)
2. 범위 축소(Scope)      → 어느 레이어/컴포넌트인가?(Which layer/component?)
3. 가설 수립(Hypothesis) → 왜 그런가?(Why?)
4. 검증(Verify)          → 가설이 맞는지 확인(Confirm hypothesis)
5. 해결(Fix)             → 수정 적용(Apply fix)
6. 회고(Retrospect)      → 재발 방지(Prevent recurrence)
```

---

## 2. 레이어별 디버깅 체크리스트(Debugging Checklist by Layer)

### Layer 0: VM이 시작되지 않을 때(VM Won't Start)

```bash
# 1. VM 목록 확인(Check VM List)
tart list

# 2. VM 시작 시도 — 에러 메시지 확인(Check Error Message)
tart run prod-master --no-graphics

# 3. 리소스 확인(Check Resources) — CPU/메모리가 물리 한계 초과?
# 현재 사용(Current): 21 vCPU / 71.5GB RAM
# 물리 한계(Physical Limit): 16 CPU / 128GB RAM

# 4. 디스크 공간 확인(Check Disk Space)
df -h ~/.tart/

# 5. VM 삭제 후 재생성(Delete and Recreate)
tart delete prod-master
tart clone ghcr.io/cirruslabs/ubuntu:latest prod-master
tart set prod-master --cpu 2 --memory 3072
```

**흔한 원인(Common Causes)**:
- 디스크 부족(Insufficient Disk) — VM당 20GB
- 이미지 손상(Image Corruption) → 삭제 후 재클론(Delete and Reclone)
- macOS 업데이트 후 Hypervisor 권한 변경(Permission Change)

### Layer 1: SSH 접속이 안 될 때(SSH Connection Failure)

```bash
# 1. VM이 실행 중인지 확인(Check VM Running)
tart list | grep prod-master

# 2. IP가 할당되었는지 확인(Check IP Assignment)
tart ip prod-master

# 3. ping 테스트(Ping Test)
ping -c 3 $(tart ip prod-master)

# 4. SSH 직접 시도 — 상세 로그(Verbose Log)
ssh -vvv admin@$(tart ip prod-master)

# 5. sshd 상태 확인 — 콘솔 접속(Console Access)
tart run prod-master  # GUI 콘솔로 접속
# 콘솔에서: systemctl status sshd
```

**흔한 원인(Common Causes)**:
- VM 부팅(Boot) 완료 전 SSH 시도 → `ssh_wait_ready` 사용
- IP 변경(IP Change, DHCP) → `tart ip`로 재확인
- known_hosts 충돌(Conflict) → `-o StrictHostKeyChecking=no` 사용

### Layer 2: K8s 노드가 NotReady일 때(Node NotReady)

```bash
# 1. 노드 상태 확인(Check Node Status)
kubectl --kubeconfig kubeconfig/prod.yaml get nodes

# 2. 노드 상세 정보 — 조건, 이벤트(Conditions, Events)
kubectl --kubeconfig kubeconfig/prod.yaml describe node prod-worker1

# 3. kubelet 상태 확인(Check kubelet Status) — SSH 접속 후
ssh admin@$(tart ip prod-worker1) "sudo systemctl status kubelet"
ssh admin@$(tart ip prod-worker1) "sudo journalctl -u kubelet --no-pager -n 50"

# 4. containerd 상태 확인(Check containerd Status)
ssh admin@$(tart ip prod-worker1) "sudo systemctl status containerd"

# 5. CNI 상태 확인(Check CNI Status)
kubectl --kubeconfig kubeconfig/prod.yaml get pods -n kube-system | grep cilium
```

**흔한 원인(Common Causes)**:
- CNI(Cilium) 미설치 또는 크래시(Crash) → Cilium Pod 상태 확인
- kubelet이 API 서버에 접근 불가(Cannot Access API Server) → 마스터 노드 IP/방화벽(Firewall) 확인
- 리소스 부족(Resource Shortage) → `free -m`, `df -h` 확인

### Layer 3: Pod가 시작되지 않을 때(Pod Won't Start)

```bash
# 1. Pod 상태 확인(Check Pod Status)
kubectl get pods -n demo

# 2. Pod 이벤트 확인(Check Pod Events)
kubectl describe pod <pod-name> -n demo

# 3. 상태별 디버깅(Debugging by Status)
```

| Pod 상태(Status) | 의미(Meaning) | 확인 방법(How to Check) |
|----------|------|-----------|
| Pending | 스케줄링 안 됨(Not Scheduled) | `describe pod` → Events — 리소스 부족? 노드 taint? |
| ContainerCreating | 이미지 풀링 중(Image Pulling) | `describe pod` → Events — 이미지 풀 에러(Pull Error)? |
| CrashLoopBackOff | 반복 크래시(Repeated Crash) | `kubectl logs <pod>` → 앱 에러(App Error) 확인 |
| ImagePullBackOff | 이미지 다운로드 실패(Image Download Failed) | 이미지명 오타(Typo)? 레지스트리(Registry) 접근 불가? |
| OOMKilled | 메모리 초과(Out of Memory) | `limits.memory` 늘리기(Increase) |
| Error | 컨테이너 실행 에러(Container Run Error) | `kubectl logs <pod> --previous` |

```bash
# CrashLoopBackOff 디버깅
kubectl logs <pod-name> -n demo              # 현재 로그(Current Logs)
kubectl logs <pod-name> -n demo --previous   # 이전 크래시 로그(Previous Crash Logs)

# OOMKilled 확인
kubectl get pod <pod-name> -n demo -o jsonpath='{.status.containerStatuses[0].lastState}'
```

### Layer 4: 서비스 접속이 안 될 때(Service Connection Failure)

```bash
# 1. Service 확인(Check Service)
kubectl get svc -n demo

# 2. Endpoints 확인 — Pod가 연결되어 있는지(Check Pod Connection)
kubectl get endpoints -n demo

# 3. Pod에서 내부 접근 테스트(Internal Access Test)
kubectl exec -it deploy/nginx-web -n demo -- curl -s http://httpbin/get

# 4. 외부에서 NodePort 접근 테스트(External NodePort Test)
curl http://$(tart ip dev-worker1):30080

# 5. NetworkPolicy 확인(Check NetworkPolicy)
kubectl get cnp -n demo

# 6. Hubble로 차단된 트래픽 확인(Check Dropped Traffic)
hubble observe --namespace demo --verdict DROPPED
```

**흔한 원인(Common Causes)**:
- NetworkPolicy가 트래픽 차단(Traffic Blocked) → Hubble로 확인
- Service selector가 Pod label과 불일치(Mismatch)
- NodePort 범위(Range, 30000-32767) 외 포트 사용

---

## 3. 이 프로젝트에서 발생한 실제 버그와 해결(Actual Bugs and Fixes)

### BUG-001: SSH heredoc 따옴표 깨짐(Quote Breaking)

**증상(Symptom)**: `sed` 명령이 SSH를 통해 실행 시 깨짐
```
sed: -e expression #1, char 15: unterminated `s' command
```

**원인 분석(Root Cause Analysis)**:
```bash
# 문제 코드(Problem Code) — bash -c '...' 안에서 작은따옴표 충돌(Quote Conflict)
ssh user@ip "echo 'password' | sudo -S bash -c 'sed -i s/foo/bar/ file'"
#                                              ^                       ^
#                                   이 따옴표들이 서로 충돌(These quotes conflict)
```

**해결(Fix)**: heredoc 패턴으로 전환(Switch to Heredoc Pattern)
```bash
ssh user@ip sudo bash -s <<EOF
sed -i 's/foo/bar/' file
EOF
# heredoc 내부에서는 따옴표가 안전하게 전달됨(Quotes safely passed inside heredoc)
```

**교훈(Lesson)**: SSH를 통한 원격 명령 실행(Remote Command Execution) 시 **quoting 레벨이 중첩(Nesting)**된다. heredoc은 이를 해결하는 가장 안전한 패턴이다.

---

### BUG-003: VM 간 통신 불가(Inter-VM Communication Failure)

**증상(Symptom)**: `kubeadm join`이 타임아웃(Timeout)
```
rate: Wait(n=1) would exceed context deadline
```

**디버깅 과정(Debugging Process)**:
```bash
# 1. worker에서 master로 ping
ssh admin@192.168.66.3 "ping -c 2 192.168.66.2"
# → Destination Host Unreachable

# 2. 호스트(Host)에서 VM으로 ping — 성공
ping -c 2 192.168.66.2
# → OK

# 3. 결론(Conclusion): Host→VM은 가능하지만 VM→VM은 불가
# → NAT 모드의 한계(NAT Mode Limitation)
```

**해결(Fix)**: `--net-softnet-allow=0.0.0.0/0` 옵션으로 소프트웨어 브릿지(Software Bridge) 네트워크 사용

**교훈(Lesson)**: VM 네트워크 모드(Network Mode)를 이해하는 것이 K8s 클러스터링의 전제조건이다. NAT는 격리(Isolation)에 좋지만 클러스터링에는 부적합하다.

---

### BUG-004: Cilium이 K8s API 접근 실패(API Access Failure)

**증상(Symptom)**: Cilium Pod이 CrashLoopBackOff
```
level=error msg="Unable to contact k8s api-server"
ipAddr=https://10.96.0.1:443
error="dial tcp 10.96.0.1:443: i/o timeout"
```

**디버깅 과정(Debugging Process)**:
```bash
# 1. 10.96.0.1은 kubernetes Service의 ClusterIP
kubectl get svc kubernetes
# → ClusterIP: 10.96.0.1

# 2. kube-proxy가 없으므로 ClusterIP 라우팅 불가(No ClusterIP Routing)
# (kubeadm init에서 --skip-phases=addon/kube-proxy 사용)

# 3. Cilium 자체가 kube-proxy를 대체(Replace)해야 하는데,
# Cilium이 아직 시작 전이므로 ClusterIP를 해석 불가
# → 부트스트랩 순환 의존성(Bootstrap Circular Dependency)!
```

**해결(Fix)**: Cilium에게 실제 마스터 IP(Actual Master IP)를 직접 알려줌
```bash
helm install cilium cilium/cilium \
  --set k8sServiceHost="192.168.65.2" \   # ClusterIP 대신 실제 IP(Actual IP)
  --set k8sServicePort=6443
```

**교훈(Lesson)**: kubeProxyReplacement 모드에서는 **부트스트랩 순환 의존성(Bootstrap Circular Dependency)**이 발생한다. CNI가 시작되기 전에는 Service 라우팅(Routing)이 불가능하므로, CNI 설정에 실제 IP를 하드코딩(Hardcode)해야 한다.

---

### BUG-006: Grafana CrashLoopBackOff — 데이터소스 충돌(Data Source Conflict)

**증상(Symptom)**: AlertManager 활성화 후 Grafana 크래시(Crash)
```
err="Only one datasource per organization can be marked as default"
```

**디버깅 과정(Debugging Process)**:
```bash
# 1. Grafana 로그 확인(Check Grafana Logs)
kubectl logs -n monitoring deploy/kube-prometheus-stack-grafana | grep error

# 2. 데이터소스 ConfigMap 확인(Check Data Source ConfigMap)
kubectl get configmap -n monitoring -l grafana_datasource=1 -o yaml

# 3. 원인 발견(Root Cause Found): Loki와 Prometheus 모두 isDefault: true
#    Prometheus (kube-prometheus-stack 기본) + Loki (loki-stack 기본)
```

**해결(Fix)**:
```yaml
# loki-values.yaml
grafana:
  sidecar:
    datasources:
      isDefaultDatasource: false  # Prometheus가 기본(Default)이 되도록
```

**교훈(Lesson)**: 여러 Helm 차트(Charts)가 같은 Grafana 인스턴스(Instance)에 데이터소스를 등록할 때 **기본 충돌(Default Conflict)**이 발생할 수 있다. 하나만 기본으로 설정해야 한다.

---

### BUG-007: kubeadm CPU 최소 요구사항(Minimum CPU Requirement)

**증상(Symptom)**: `kubeadm init` 실패(Failure)
```
[ERROR NumCPU]: the number of available CPUs 1 is less than the required 2
```

**원인(Cause)**: prod-master에 1 CPU만 할당 — 리소스 절약(Resource Saving) 목적

**해결(Fix)**: CPU를 2로 변경(Change CPU to 2)
```bash
tart stop prod-master
tart set prod-master --cpu 2
tart run prod-master --no-graphics --net-softnet-allow=0.0.0.0/0 &
```

**교훈(Lesson)**: kubeadm은 **최소 2 CPU, 2GB RAM(Minimum 2 CPU, 2GB RAM)**을 요구한다. 이것은 etcd, kube-apiserver, kube-scheduler가 동시에 실행되어야 하기 때문이다.

---

## 4. 일반적인 K8s 트러블슈팅 명령어(Common K8s Troubleshooting Commands)

### 기본 진단(Basic Diagnostics)

```bash
# 클러스터 전체 상태(Cluster-wide Status)
kubectl cluster-info
kubectl get componentstatuses

# 노드 상태(Node Status)
kubectl get nodes -o wide
kubectl top nodes     # (metrics-server 필요, Required)

# 이벤트 — 최근 장애 확인(Recent Events Check)
kubectl get events --sort-by='.lastTimestamp' -A

# 리소스 사용량(Resource Usage)
kubectl top pods -n demo
kubectl top nodes
```

### Pod 디버깅(Pod Debugging)

```bash
# Pod 내부 접속(Enter Pod Shell)
kubectl exec -it deploy/nginx-web -n demo -- /bin/sh

# DNS 확인(DNS Check)
kubectl exec -it deploy/nginx-web -n demo -- nslookup httpbin.demo.svc.cluster.local

# 네트워크 연결 테스트(Network Connection Test)
kubectl exec -it deploy/nginx-web -n demo -- curl -v http://httpbin/get

# 임시 디버깅 Pod(Temporary Debug Pod)
kubectl run debug --rm -it --image=nicolaka/netshoot -- bash
```

### Helm 디버깅(Helm Debugging)

```bash
# 배포 히스토리(Deployment History)
helm list -A
helm history cilium -n kube-system

# 차트 값 확인(Check Chart Values)
helm get values cilium -n kube-system

# 드라이런 — 실제 적용 없이 결과 확인(Dry Run — Preview Without Applying)
helm upgrade --install cilium cilium/cilium --dry-run --debug

# 롤백(Rollback)
helm rollback cilium 1 -n kube-system
```

### Cilium 디버깅(Cilium Debugging)

```bash
# Cilium 상태(Status)
kubectl exec -n kube-system ds/cilium -- cilium status

# Cilium 연결 테스트(Connectivity Test)
kubectl exec -n kube-system ds/cilium -- cilium connectivity test

# BPF 맵 확인(BPF Map Check)
kubectl exec -n kube-system ds/cilium -- cilium bpf endpoint list

# NetworkPolicy 상태(Policy Status)
kubectl exec -n kube-system ds/cilium -- cilium policy get
```

---

## 5. 성능 트러블슈팅(Performance Troubleshooting)

### 높은 CPU 사용률(High CPU Utilization)

```bash
# 1. 어떤 Pod가 CPU를 많이 쓰는지(Which Pod Uses Most CPU)
kubectl top pods -n demo --sort-by=cpu

# 2. 노드 레벨 확인(Node Level Check)
kubectl top nodes

# 3. SSH로 VM 프로세스 확인(Check VM Processes via SSH)
ssh admin@$(tart ip dev-worker1) "top -bn1 | head -20"

# 4. HPA가 동작하는지 확인(Check HPA Is Working)
kubectl get hpa -n demo
```

### 높은 메모리 사용률(High Memory Utilization)

```bash
# 1. OOMKilled Pod 확인(Check OOMKilled Pods)
kubectl get pods -A -o json | jq '.items[] | select(.status.containerStatuses[0].lastState.terminated.reason=="OOMKilled") | .metadata.name'

# 2. 메모리 사용량 순위(Memory Usage Ranking)
kubectl top pods -n demo --sort-by=memory

# 3. 리소스 limits 확인(Check Resource Limits)
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[*].resources.limits.memory}{"\n"}{end}'
```

### 네트워크 지연(Network Latency)

```bash
# 1. Pod 간 지연 측정(Measure Inter-Pod Latency)
kubectl exec -it deploy/nginx-web -n demo -- curl -o /dev/null -s -w 'Total: %{time_total}s\n' http://httpbin/get

# 2. DNS 해석 시간(DNS Resolution Time)
kubectl exec -it deploy/nginx-web -n demo -- curl -o /dev/null -s -w 'DNS: %{time_namelookup}s\n' http://httpbin/get

# 3. Hubble로 네트워크 흐름 확인(Check Network Flow via Hubble)
hubble observe --namespace demo --type l7

# 4. Istio 사이드카 지연 확인(Check Istio Sidecar Latency)
kubectl exec -it deploy/nginx-web -n demo -c istio-proxy -- curl localhost:15000/stats | grep upstream_rq_time
```

---

## 6. 재해 복구 절차(Disaster Recovery Procedure)

### 전체 VM 재시작(Full VM Restart) — 노트북 재부팅(Laptop Reboot) 후

```bash
# 1. 모든 VM 시작(Start All VMs)
./scripts/boot.sh

# 2. 상태 확인(Status Check)
./scripts/status.sh

# 3. 문제가 있으면 개별 확인(Check Individual Clusters if Issues)
kubectl --kubeconfig kubeconfig/<cluster>.yaml get nodes
kubectl --kubeconfig kubeconfig/<cluster>.yaml get pods -A
```

### 특정 클러스터 완전 재구축(Full Cluster Rebuild)

```bash
# 1. VM 삭제(Delete VMs)
for vm in prod-master prod-worker1 prod-worker2; do
  tart stop $vm 2>/dev/null
  tart delete $vm
done

# 2. VM 재생성 + K8s 재구축(Recreate VMs + Rebuild K8s)
bash -c 'source scripts/lib/k8s.sh
  vm_clone prod-master
  vm_set_resources prod-master 2 3072
  # ... (각 노드 반복, Repeat for Each Node)
  vm_start prod-master
  vm_wait_for_ip prod-master
  prepare_node prod-master
  install_containerd prod-master
  install_kubeadm prod-master
  init_cluster prod
  install_cilium prod
'
```

### kubeconfig 분실/손상(Lost/Corrupted kubeconfig)

```bash
# 마스터 노드에서 재복사(Recopy from Master Node)
sshpass -p admin scp -o StrictHostKeyChecking=no \
  admin@$(tart ip prod-master):.kube/config kubeconfig/prod.yaml
```
