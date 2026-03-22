# 재연 가이드 08. 트러블슈팅

이 문서는 멀티 클러스터 인프라 구축 과정에서 발생하는 문제를 계층별로 정리한다. 각 문제는 증상, 원인, 진단 명령어, 해결 방법 순서로 기술한다.

---

## 1. VM 레이어 문제

### 1.1 VM이 시작되지 않을 때

**증상**
```
Error: Failed to run VM "platform-master": ...
```
`tart run` 실행 시 오류가 발생하고 VM이 기동되지 않는다.

**원인**
- 같은 이름의 VM이 이미 실행 중이다.
- 베이스 이미지가 손상되었다.
- macOS Virtualization.framework 권한이 없다.

**진단 명령어**
```bash
# 현재 VM 목록과 상태 확인
tart list

# 특정 VM이 실행 중인지 확인
tart list | grep platform-master

# macOS 가상화 프레임워크 상태 확인
system_profiler SPSoftwareDataType | grep -i virtual
```

**해결 방법**
```bash
# 이미 실행 중인 VM 정지 후 재시작
tart stop platform-master
sleep 2
tart run platform-master --no-graphics --net-softnet-allow=0.0.0.0/0 &

# 베이스 이미지 재다운로드
tart delete platform-master
tart pull ghcr.io/cirruslabs/ubuntu:latest
tart clone ghcr.io/cirruslabs/ubuntu:latest platform-master
tart set platform-master --cpu 2 --memory 4096

# 시스템 환경설정 > 개인정보 보호 및 보안 > 개발자 도구에서 터미널 허용
```

---

### 1.2 IP가 할당되지 않을 때

**증상**
```
[ERROR] Timeout waiting for IP on 'platform-master'
```
`tart ip <vm-name>` 명령이 빈 값을 반환하거나, `vm_wait_for_ip` 함수에서 180초 타임아웃이 발생한다.

**원인**
- VM 내부 네트워크 서비스가 아직 기동되지 않았다.
- macOS의 vmnet 프레임워크에 문제가 있다.
- 너무 많은 VM을 동시에 시작하여 DHCP 응답이 지연된다.

**진단 명령어**
```bash
# VM 실행 상태 확인
tart list | grep running

# IP 직접 조회 시도
tart ip platform-master

# macOS 네트워크 확인
ifconfig | grep vmnet
```

**해결 방법**
```bash
# VM 재시작
tart stop platform-master
sleep 3
tart run platform-master --no-graphics --net-softnet-allow=0.0.0.0/0 &

# 대기 시간을 늘려서 재시도
# scripts/lib/vm.sh의 vm_wait_for_ip 함수에서 max_attempts 기본값은 60이다.
# 3초 간격이므로 최대 180초 대기한다. 시스템 부하가 높으면 더 필요하다.

# 모든 VM 정지 후 순차적으로 시작 (동시 시작 문제 회피)
for vm in platform-master platform-worker1 platform-worker2; do
  tart run "$vm" --no-graphics --net-softnet-allow=0.0.0.0/0 &
  sleep 10  # VM 간 간격을 둔다
done

# 최후 수단: macOS 재시작 (vmnet 프레임워크 초기화)
```

---

### 1.3 SSH 접속 실패

**증상**
```
Permission denied, please try again.
ssh: connect to host 192.168.64.x port 22: Connection refused
Host key verification failed.
```

**원인**
- sshpass가 설치되지 않았다.
- SSH 서비스가 VM 내부에서 아직 시작되지 않았다.
- known_hosts에 이전 VM의 호스트 키가 남아 있다 (VM 재생성 시).
- SSH 사용자명 또는 비밀번호가 틀렸다.

**진단 명령어**
```bash
# sshpass 설치 여부 확인
which sshpass

# SSH 포트 연결 가능 여부 확인
nc -z -w 5 192.168.64.x 22

# known_hosts 충돌 확인
ssh-keygen -R 192.168.64.x

# SSH 접속 디버그 모드
ssh -vvv -o StrictHostKeyChecking=no admin@192.168.64.x
```

**해결 방법**
```bash
# sshpass 설치
brew install sshpass  # 또는 brew install esolitos/ipa/sshpass

# known_hosts에서 기존 키 제거
ssh-keygen -R 192.168.64.x

# 프로젝트의 SSH 옵션은 자동으로 known_hosts 검증을 비활성화한다.
# scripts/lib/ssh.sh에 정의된 SSH_OPTS 참고:
# SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10"

# SSH 서비스가 준비될 때까지 대기
source scripts/lib/ssh.sh
ssh_wait_ready 192.168.64.x

# 기본 자격 증명: admin/admin (config/clusters.json에서 설정)
```

---

### 1.4 디스크 부족

**증상**
```
Error: not enough disk space
No space left on device
```
VM 복제 또는 실행 중에 호스트 디스크 공간이 부족하다.

**원인**
- Tart VM 이미지가 `~/.tart/vms/`에 저장된다. VM 10개의 디스크 이미지가 누적되면 상당한 공간을 차지한다.
- 이전에 삭제하지 않은 VM 이미지가 남아 있다.

**진단 명령어**
```bash
# 호스트 디스크 사용량 확인
df -h /

# Tart VM 디스크 사용량 확인
du -sh ~/.tart/vms/*

# 전체 VM 목록 확인
tart list
```

**해결 방법**
```bash
# 사용하지 않는 VM 삭제
tart stop old-vm-name 2>/dev/null
tart delete old-vm-name

# 전체 VM 삭제 후 재구축
bash scripts/destroy.sh

# macOS 시스템 캐시 정리
# Xcode 캐시, Docker 이미지 등 불필요한 파일 정리

# 각 VM의 디스크 크기는 terraform.tfvars에서 20GB로 설정되어 있다.
# 10개 VM = 약 200GB 필요하다.
```

---

## 2. Kubernetes 레이어 문제

### 2.1 kubeadm init 실패

**증상**
```
[ERROR Port-6443]: Port 6443 is in use
[ERROR FileAvailable--etc-kubernetes-manifests-kube-apiserver.yaml]: /etc/kubernetes/manifests/kube-apiserver.yaml already exists
error execution phase preflight
```

**원인**
- 이전 kubeadm init이 완료되지 않은 상태에서 재시도했다.
- 포트 6443을 다른 프로세스가 점유하고 있다.
- 이전 클러스터 초기화 잔여물이 남아 있다.

**진단 명령어**
```bash
# VM에 SSH 접속하여 확인
IP=$(tart ip platform-master)
sshpass -p admin ssh -o StrictHostKeyChecking=no admin@$IP

# 포트 사용 확인
sudo ss -tlnp | grep 6443

# kubeadm 상태 확인
sudo kubeadm config view 2>/dev/null

# 기존 설정 파일 확인
ls -la /etc/kubernetes/manifests/
```

**해결 방법**
```bash
# VM 내부에서 kubeadm reset 실행
sudo kubeadm reset -f

# 잔여 설정 정리
sudo rm -rf /etc/kubernetes/manifests/*
sudo rm -rf /var/lib/etcd/*
sudo rm -rf /etc/cni/net.d/*
sudo rm -f /etc/kubernetes/admin.conf

# iptables 규칙 초기화
sudo iptables -F
sudo iptables -t nat -F

# 이후 다시 init 실행
# 또는 install.sh를 Phase 5부터 재실행
```

---

### 2.2 노드가 NotReady 상태

**증상**
```bash
$ kubectl get nodes
NAME                STATUS     ROLES           AGE   VERSION
platform-master     NotReady   control-plane   5m    v1.29.x
platform-worker1    NotReady   <none>          3m    v1.29.x
```

**원인**
- CNI 플러그인(Cilium)이 설치되지 않았거나 아직 준비되지 않았다.
- kubelet이 비정상 종료되었다.
- 노드의 메모리가 부족하다.

**진단 명령어**
```bash
KUBECONFIG=kubeconfig/platform.yaml

# 노드 상태 상세 확인
kubectl --kubeconfig=$KUBECONFIG describe node platform-master

# kubelet 로그 확인 (VM 내부)
IP=$(tart ip platform-master)
sshpass -p admin ssh -o StrictHostKeyChecking=no admin@$IP "sudo journalctl -u kubelet --no-pager -n 50"

# Cilium 상태 확인
kubectl --kubeconfig=$KUBECONFIG -n kube-system get pods | grep cilium

# 노드 조건(Conditions) 확인
kubectl --kubeconfig=$KUBECONFIG get nodes -o wide
```

**해결 방법**
```bash
# Cilium이 설치되지 않은 경우 설치
bash scripts/install/06-install-cilium.sh

# kubelet 재시작 (VM 내부)
sudo systemctl restart kubelet

# Cilium Pod가 Pending이면 리소스 확인
kubectl --kubeconfig=$KUBECONFIG -n kube-system describe pod cilium-xxxxx

# 메모리 부족 시 VM 메모리 증가
tart stop platform-master
tart set platform-master --memory 6144
tart run platform-master --no-graphics --net-softnet-allow=0.0.0.0/0 &
```

---

### 2.3 Pod가 Pending 상태

**증상**
```
NAME                          READY   STATUS    RESTARTS   AGE
prometheus-server-xxxxx       0/1     Pending   0          10m
```

**원인**
- 노드에 요청된 CPU 또는 메모리 리소스가 부족하다.
- nodeSelector 또는 toleration이 맞지 않아 스케줄링이 불가능하다.
- PersistentVolumeClaim이 Bound되지 않았다.

**진단 명령어**
```bash
# Pod 이벤트 확인
kubectl --kubeconfig=$KUBECONFIG describe pod <pod-name> -n <namespace>

# 노드 리소스 현황 확인
kubectl --kubeconfig=$KUBECONFIG top nodes

# 노드별 할당 가능 리소스 확인
kubectl --kubeconfig=$KUBECONFIG describe nodes | grep -A 5 "Allocated resources"

# PVC 상태 확인
kubectl --kubeconfig=$KUBECONFIG get pvc -A
```

**해결 방법**
```bash
# 리소스 부족 시: 불필요한 Pod 정리 또는 VM 리소스 증가
# 이 프로젝트에서는 platform 클러스터가 가장 무거운데,
# worker1에 12GB, worker2에 8GB를 할당하고 있다.

# Helm 차트의 리소스 요청 값을 줄인다
# manifests/monitoring-values.yaml에서 requests 값 조정

# PVC 문제 시: StorageClass 확인
kubectl --kubeconfig=$KUBECONFIG get storageclass
```

---

### 2.4 Pod가 CrashLoopBackOff

**증상**
```
NAME                          READY   STATUS             RESTARTS   AGE
jenkins-0                     0/1     CrashLoopBackOff   5          15m
```

**원인**
- 컨테이너 설정 오류 (환경 변수, ConfigMap 누락).
- 컨테이너 내부 프로세스가 시작 직후 종료된다.
- 리소스 제한(limits)에 의해 OOM Kill이 발생한다.
- 헬스체크(liveness probe)가 반복적으로 실패한다.

**진단 명령어**
```bash
# Pod 로그 확인
kubectl --kubeconfig=$KUBECONFIG logs <pod-name> -n <namespace>

# 이전 컨테이너 로그 확인
kubectl --kubeconfig=$KUBECONFIG logs <pod-name> -n <namespace> --previous

# Pod 상세 정보 (이벤트 포함)
kubectl --kubeconfig=$KUBECONFIG describe pod <pod-name> -n <namespace>

# OOM Kill 확인
kubectl --kubeconfig=$KUBECONFIG get pod <pod-name> -n <namespace> -o jsonpath='{.status.containerStatuses[0].lastState}'
```

**해결 방법**
```bash
# 로그에서 오류 메시지를 확인하고 원인에 따라 조치한다.

# OOM Kill인 경우 메모리 limit 증가
# Helm values 파일에서 resources.limits.memory 값 수정 후 upgrade

# ConfigMap 누락인 경우
kubectl --kubeconfig=$KUBECONFIG get configmap -n <namespace>

# liveness probe 실패인 경우 initialDelaySeconds 값 증가
```

---

### 2.5 Pod가 ImagePullBackOff

**증상**
```
NAME                          READY   STATUS             RESTARTS   AGE
argocd-server-xxxxx           0/1     ImagePullBackOff   0          5m
```

**원인**
- 이미지 이름 또는 태그에 오타가 있다.
- 이미지 레지스트리에 접근할 수 없다 (네트워크 문제).
- Private 레지스트리에 인증이 필요하다.

**진단 명령어**
```bash
# Pod 이벤트에서 정확한 오류 메시지 확인
kubectl --kubeconfig=$KUBECONFIG describe pod <pod-name> -n <namespace> | grep -A 10 Events

# VM에서 직접 이미지 풀 테스트
IP=$(tart ip platform-worker1)
sshpass -p admin ssh -o StrictHostKeyChecking=no admin@$IP \
  "sudo crictl pull <image-name>"

# DNS 확인 (레지스트리 도메인 해석 가능 여부)
sshpass -p admin ssh -o StrictHostKeyChecking=no admin@$IP \
  "nslookup ghcr.io"
```

**해결 방법**
```bash
# 이미지 이름 오타 수정 후 Pod 재생성
kubectl --kubeconfig=$KUBECONFIG delete pod <pod-name> -n <namespace>

# 네트워크 문제 시 VM의 DNS 설정 확인
sshpass -p admin ssh -o StrictHostKeyChecking=no admin@$IP \
  "cat /etc/resolv.conf"

# 레지스트리 인증 문제 시 Secret 생성
kubectl --kubeconfig=$KUBECONFIG create secret docker-registry regcred \
  --docker-server=<registry> \
  --docker-username=<user> \
  --docker-password=<password> \
  -n <namespace>
```

---

## 3. 네트워크 문제

### 3.1 Pod 간 통신 불가

**증상**
```bash
# Pod A에서 Pod B로 ping 또는 curl 실패
kubectl exec -it pod-a -- curl http://<pod-b-ip>:8080
# 응답 없음 또는 Connection refused
```

**원인**
- Cilium Agent가 정상 동작하지 않는다.
- Pod CIDR이 클러스터 간 충돌한다.
- VM 간 네트워크 라우팅 문제가 있다.

**진단 명령어**
```bash
# Cilium 상태 확인
kubectl --kubeconfig=$KUBECONFIG -n kube-system exec ds/cilium -- cilium status

# Cilium Agent 로그 확인
kubectl --kubeconfig=$KUBECONFIG -n kube-system logs ds/cilium

# 엔드포인트 목록 확인
kubectl --kubeconfig=$KUBECONFIG -n kube-system exec ds/cilium -- cilium endpoint list

# Pod CIDR 확인 (클러스터별로 고유해야 한다)
# platform: 10.10.0.0/16, dev: 10.20.0.0/16, staging: 10.30.0.0/16, prod: 10.40.0.0/16
kubectl --kubeconfig=$KUBECONFIG get nodes -o jsonpath='{.items[*].spec.podCIDR}'
```

**해결 방법**
```bash
# Cilium Agent 재시작
kubectl --kubeconfig=$KUBECONFIG -n kube-system rollout restart daemonset/cilium

# Cilium 재설치
helm uninstall cilium -n kube-system --kubeconfig=$KUBECONFIG
bash scripts/install/06-install-cilium.sh

# BPF 맵 초기화 (VM 내부)
sshpass -p admin ssh -o StrictHostKeyChecking=no admin@$IP \
  "sudo rm -rf /sys/fs/bpf/tc/globals/cilium_*"
```

---

### 3.2 Service 접속 불가

**증상**
```bash
# NodePort로 외부에서 접속 실패
curl http://192.168.64.x:30300  # Grafana 접속 시도
# Connection refused 또는 타임아웃
```

**원인**
- Service의 NodePort가 잘못 설정되었다.
- 방화벽 규칙이 포트를 차단하고 있다.
- 대상 Pod가 정상 동작하지 않는다.
- VM 네트워크에서 해당 포트로의 접근이 차단되었다.

**진단 명령어**
```bash
# Service 목록 및 포트 확인
kubectl --kubeconfig=$KUBECONFIG get svc -A | grep NodePort

# 특정 Service의 엔드포인트 확인
kubectl --kubeconfig=$KUBECONFIG get endpoints -n monitoring

# Pod 상태 확인
kubectl --kubeconfig=$KUBECONFIG get pods -n monitoring

# VM 내부에서 직접 포트 확인
sshpass -p admin ssh -o StrictHostKeyChecking=no admin@$IP \
  "sudo ss -tlnp | grep 30300"
```

**해결 방법**
```bash
# Grafana 접속 URL 확인 (terraform outputs 참고)
# grafana: http://<platform-worker1-ip>:30300
# argocd:  http://<platform-worker1-ip>:30800
# jenkins: http://<platform-worker1-ip>:30900

# kube-proxy 상태 확인
kubectl --kubeconfig=$KUBECONFIG -n kube-system get pods | grep kube-proxy

# Service 재생성
kubectl --kubeconfig=$KUBECONFIG delete svc <service-name> -n <namespace>
# Helm upgrade로 Service 재생성
helm upgrade <release-name> <chart> --kubeconfig=$KUBECONFIG -n <namespace>
```

---

### 3.3 DNS 해석 실패

**증상**
```bash
kubectl exec -it <pod> -- nslookup kubernetes.default
# server can't find kubernetes.default: NXDOMAIN
```

**원인**
- CoreDNS Pod가 정상 동작하지 않는다.
- CoreDNS의 ConfigMap이 잘못 설정되었다.
- 네트워크 정책(NetworkPolicy)이 DNS 트래픽을 차단한다.

**진단 명령어**
```bash
# CoreDNS Pod 상태 확인
kubectl --kubeconfig=$KUBECONFIG -n kube-system get pods -l k8s-app=kube-dns

# CoreDNS 로그 확인
kubectl --kubeconfig=$KUBECONFIG -n kube-system logs -l k8s-app=kube-dns

# DNS Service 엔드포인트 확인
kubectl --kubeconfig=$KUBECONFIG -n kube-system get endpoints kube-dns

# CoreDNS ConfigMap 확인
kubectl --kubeconfig=$KUBECONFIG -n kube-system get configmap coredns -o yaml
```

**해결 방법**
```bash
# CoreDNS Pod 재시작
kubectl --kubeconfig=$KUBECONFIG -n kube-system rollout restart deployment/coredns

# DNS 해석 테스트
kubectl --kubeconfig=$KUBECONFIG run dnstest --image=busybox --rm -it --restart=Never -- nslookup kubernetes.default

# CoreDNS ConfigMap이 손상된 경우 kubeadm으로 재생성
# VM 내부에서:
sudo kubeadm init phase addon coredns --kubeconfig /etc/kubernetes/admin.conf
```

---

### 3.4 NetworkPolicy로 인한 차단

**증상**

특정 Pod 간 통신이 갑자기 불가능해졌다. 다른 Pod에서는 정상 동작한다.

**원인**
- `scripts/install/10-install-network-policies.sh`에서 적용한 NetworkPolicy가 의도하지 않은 트래픽을 차단한다.

**진단 명령어**
```bash
# 적용된 NetworkPolicy 확인
kubectl --kubeconfig=$KUBECONFIG get networkpolicy -A

# 특정 네임스페이스의 NetworkPolicy 상세 확인
kubectl --kubeconfig=$KUBECONFIG describe networkpolicy -n <namespace>

# Cilium 모니터로 실시간 트래픽 확인
kubectl --kubeconfig=$KUBECONFIG -n kube-system exec ds/cilium -- cilium monitor --type drop

# Hubble로 플로우 관찰 (Hubble이 설치된 경우)
kubectl --kubeconfig=$KUBECONFIG -n kube-system exec deploy/hubble-relay -- \
  hubble observe --namespace <namespace> --verdict DROPPED
```

**해결 방법**
```bash
# 문제가 되는 NetworkPolicy 일시적으로 삭제하여 원인 확인
kubectl --kubeconfig=$KUBECONFIG delete networkpolicy <policy-name> -n <namespace>

# NetworkPolicy에 필요한 라벨 추가
# ingress/egress 규칙에서 허용할 Pod의 라벨 확인
kubectl --kubeconfig=$KUBECONFIG get pods -n <namespace> --show-labels

# NetworkPolicy 수정 후 재적용
kubectl --kubeconfig=$KUBECONFIG apply -f <policy-file>.yaml
```

---

## 4. 모니터링/서비스 문제

### 4.1 Prometheus OOM

**증상**
```
prometheus-server Pod가 반복적으로 재시작된다.
OOMKilled 상태가 표시된다.
```

**원인**
- 모니터링 대상(scrape target)이 너무 많아 메모리 사용량이 급증한다.
- retention 기간이 길어 TSDB 블록이 누적된다.
- platform 클러스터의 worker 노드 메모리가 부족하다.

**진단 명령어**
```bash
KUBECONFIG=kubeconfig/platform.yaml

# Pod 상태 및 재시작 횟수 확인
kubectl --kubeconfig=$KUBECONFIG get pods -n monitoring -l app.kubernetes.io/name=prometheus

# OOM Kill 확인
kubectl --kubeconfig=$KUBECONFIG describe pod -n monitoring -l app.kubernetes.io/name=prometheus | grep -A 3 "Last State"

# 현재 메모리 사용량 확인
kubectl --kubeconfig=$KUBECONFIG top pods -n monitoring

# 노드 메모리 확인
kubectl --kubeconfig=$KUBECONFIG top nodes
```

**해결 방법**
```bash
# 1. Prometheus 메모리 limit 증가
# manifests/monitoring-values.yaml 수정:
# prometheus:
#   server:
#     resources:
#       limits:
#         memory: 2Gi  # 기존 1Gi에서 증가
#       requests:
#         memory: 1Gi

# 2. scrape interval 증가 (15s -> 30s)
# 3. retention 기간 축소 (15d -> 7d)
# 4. 불필요한 메트릭 drop

# Helm upgrade로 적용
helm upgrade kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --kubeconfig=$KUBECONFIG \
  -n monitoring \
  -f manifests/monitoring-values.yaml

# VM 메모리 증가 (최후 수단)
tart stop platform-worker1
tart set platform-worker1 --memory 16384
tart run platform-worker1 --no-graphics --net-softnet-allow=0.0.0.0/0 &
```

---

### 4.2 Grafana 접속 불가

**증상**
```
브라우저에서 http://<worker-ip>:30300 접속 시 응답이 없다.
```

**원인**
- Grafana Pod가 정상 실행되지 않는다.
- NodePort Service가 올바르게 생성되지 않았다.
- Grafana가 다른 Pod에 의해 OOM Kill 되었다.

**진단 명령어**
```bash
# Grafana Pod 상태 확인
kubectl --kubeconfig=$KUBECONFIG get pods -n monitoring -l app.kubernetes.io/name=grafana

# Grafana 로그 확인
kubectl --kubeconfig=$KUBECONFIG logs -n monitoring -l app.kubernetes.io/name=grafana

# Service 확인
kubectl --kubeconfig=$KUBECONFIG get svc -n monitoring | grep grafana

# worker 노드 IP 확인
tart ip platform-worker1
```

**해결 방법**
```bash
# Grafana Pod 재시작
kubectl --kubeconfig=$KUBECONFIG -n monitoring rollout restart deployment/kube-prometheus-stack-grafana

# Service가 없는 경우 Helm upgrade
helm upgrade kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --kubeconfig=$KUBECONFIG \
  -n monitoring \
  -f manifests/monitoring-values.yaml

# 기본 Grafana 자격 증명: admin / prom-operator (Helm 차트 기본값)
```

---

### 4.3 Jenkins 플러그인 오류

**증상**
```
Jenkins UI에서 플러그인 설치 실패.
Jenkins Pod가 시작 시 오류를 출력한다.
```

**원인**
- Jenkins Pod에서 인터넷 접근이 불가능하다.
- 플러그인 버전 호환성 문제이다.
- PersistentVolume에 이전 설정이 남아 충돌한다.

**진단 명령어**
```bash
# Jenkins Pod 로그 확인
kubectl --kubeconfig=$KUBECONFIG logs -n jenkins -l app.kubernetes.io/name=jenkins

# Jenkins Pod 내부에서 네트워크 확인
kubectl --kubeconfig=$KUBECONFIG exec -n jenkins -it jenkins-0 -- \
  curl -s https://updates.jenkins.io/update-center.json | head -c 100

# PVC 상태 확인
kubectl --kubeconfig=$KUBECONFIG get pvc -n jenkins
```

**해결 방법**
```bash
# Jenkins Pod 재시작
kubectl --kubeconfig=$KUBECONFIG -n jenkins rollout restart statefulset/jenkins

# 플러그인 캐시 초기화 (PVC 삭제 후 재생성)
kubectl --kubeconfig=$KUBECONFIG delete pvc -n jenkins --all
helm upgrade jenkins jenkins/jenkins \
  --kubeconfig=$KUBECONFIG \
  -n jenkins \
  -f manifests/jenkins-values.yaml

# Jenkins 접속: http://<worker-ip>:30900
# 초기 비밀번호 확인:
kubectl --kubeconfig=$KUBECONFIG exec -n jenkins jenkins-0 -- \
  cat /var/jenkins_home/secrets/initialAdminPassword
```

---

### 4.4 ArgoCD sync 실패

**증상**
```
ArgoCD UI에서 Application이 OutOfSync 또는 Degraded 상태이다.
Sync 버튼을 눌러도 실패한다.
```

**원인**
- Git 저장소에 접근할 수 없다.
- 매니페스트에 문법 오류가 있다.
- 대상 클러스터의 kubeconfig가 만료되었다.
- 네임스페이스가 존재하지 않는다.

**진단 명령어**
```bash
# ArgoCD Application 상태 확인
kubectl --kubeconfig=$KUBECONFIG get applications -n argocd

# Application 상세 확인
kubectl --kubeconfig=$KUBECONFIG describe application <app-name> -n argocd

# ArgoCD 서버 로그 확인
kubectl --kubeconfig=$KUBECONFIG logs -n argocd -l app.kubernetes.io/name=argocd-server

# repo-server 로그 확인 (Git 접근 문제)
kubectl --kubeconfig=$KUBECONFIG logs -n argocd -l app.kubernetes.io/name=argocd-repo-server
```

**해결 방법**
```bash
# ArgoCD CLI로 sync 재시도
kubectl --kubeconfig=$KUBECONFIG -n argocd exec deploy/argocd-server -- \
  argocd app sync <app-name> --insecure

# Git 저장소 연결 확인 및 재설정
kubectl --kubeconfig=$KUBECONFIG -n argocd get secrets -l argocd.argoproj.io/secret-type=repository

# 강제 sync (리소스 삭제 후 재생성)
kubectl --kubeconfig=$KUBECONFIG -n argocd exec deploy/argocd-server -- \
  argocd app sync <app-name> --force --insecure

# ArgoCD 접속: http://<worker-ip>:30800
# 초기 비밀번호:
kubectl --kubeconfig=$KUBECONFIG -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d
```

---

### 4.5 Istio sidecar injection 안됨

**증상**

dev 클러스터에 배포한 Pod에 Envoy sidecar 컨테이너가 주입되지 않는다. Pod에 컨테이너가 1개만 실행된다.

**원인**
- 네임스페이스에 `istio-injection=enabled` 라벨이 없다.
- Istio가 설치되지 않았거나 istiod Pod가 비정상이다.
- Pod의 annotation으로 injection이 비활성화되어 있다.

**진단 명령어**
```bash
KUBECONFIG=kubeconfig/dev.yaml

# 네임스페이스 라벨 확인
kubectl --kubeconfig=$KUBECONFIG get namespace <namespace> --show-labels

# Istio 시스템 Pod 확인
kubectl --kubeconfig=$KUBECONFIG get pods -n istio-system

# istiod 로그 확인
kubectl --kubeconfig=$KUBECONFIG logs -n istio-system -l app=istiod

# Webhook 설정 확인
kubectl --kubeconfig=$KUBECONFIG get mutatingwebhookconfiguration
```

**해결 방법**
```bash
# 네임스페이스에 라벨 추가
kubectl --kubeconfig=$KUBECONFIG label namespace <namespace> istio-injection=enabled --overwrite

# 기존 Pod 재시작 (라벨 추가 후 새로 생성되는 Pod부터 적용)
kubectl --kubeconfig=$KUBECONFIG rollout restart deployment -n <namespace>

# Istio가 설치되지 않은 경우
bash scripts/install/12-install-istio.sh

# istiod가 비정상인 경우 재시작
kubectl --kubeconfig=$KUBECONFIG -n istio-system rollout restart deployment/istiod
```

---

## 5. 대시보드 문제

### 5.1 npm install 실패

**증상**
```bash
cd dashboard
npm install
# npm ERR! code ERESOLVE
# npm ERR! ERESOLVE unable to resolve dependency tree
```

**원인**
- Node.js 버전이 호환되지 않는다.
- npm 캐시가 손상되었다.
- peer dependency 충돌이 있다.

**진단 명령어**
```bash
# Node.js 버전 확인
node --version
npm --version

# 캐시 상태 확인
npm cache verify
```

**해결 방법**
```bash
# Node.js 버전 확인 (18.x 이상 권장)
node --version

# npm 캐시 초기화
npm cache clean --force

# node_modules 삭제 후 재설치
rm -rf dashboard/node_modules dashboard/package-lock.json
cd dashboard && npm install

# peer dependency 충돌 시
npm install --legacy-peer-deps
```

---

### 5.2 SSH 연결 풀 오류

**증상**
```
대시보드에서 VM 상태 조회 시 "SSH connection failed" 오류가 표시된다.
```

**원인**
- VM이 실행 중이 아니다.
- SSH 연결 수가 제한을 초과했다.
- VM의 IP가 변경되었다 (VM 재시작 시).

**진단 명령어**
```bash
# VM 실행 상태 확인
tart list | grep running

# 각 VM의 현재 IP 확인
for vm in platform-master platform-worker1 platform-worker2 dev-master dev-worker1 staging-master staging-worker1 prod-master prod-worker1 prod-worker2; do
  echo "$vm: $(tart ip $vm 2>/dev/null || echo 'N/A')"
done

# SSH 접속 테스트
sshpass -p admin ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 admin@<ip> "echo ok"
```

**해결 방법**
```bash
# VM이 꺼져 있으면 시작
bash scripts/boot.sh

# 대시보드 서버 재시작 (SSH 연결 풀 재초기화)
cd dashboard
npm run dev  # 개발 모드 재시작

# status.sh로 전체 상태 확인
bash scripts/status.sh
```

---

### 5.3 API 타임아웃

**증상**
```
대시보드에서 클러스터 정보 로딩 시 "Request timeout" 오류가 표시된다.
```

**원인**
- kubectl 명령이 느리다 (API 서버 부하 또는 네트워크 지연).
- kubeconfig 파일이 잘못되었거나 만료되었다.
- API 서버 Pod가 비정상이다.

**진단 명령어**
```bash
# kubeconfig 파일 존재 여부 확인
ls -la kubeconfig/

# API 서버 응답 시간 확인
time kubectl --kubeconfig=kubeconfig/platform.yaml get nodes

# API 서버 Pod 확인 (VM 내부에서)
IP=$(tart ip platform-master)
sshpass -p admin ssh -o StrictHostKeyChecking=no admin@$IP \
  "sudo crictl ps | grep kube-apiserver"
```

**해결 방법**
```bash
# kubeconfig 재생성 (VM 내부에서 복사)
IP=$(tart ip platform-master)
mkdir -p kubeconfig
sshpass -p admin scp -o StrictHostKeyChecking=no admin@$IP:/etc/kubernetes/admin.conf kubeconfig/platform.yaml

# 복사한 kubeconfig의 서버 주소를 VM IP로 변경
sed -i '' "s|https://.*:6443|https://$IP:6443|g" kubeconfig/platform.yaml

# API 서버 재시작 (마스터 노드 내부에서)
# static Pod이므로 매니페스트 파일을 touch하면 kubelet이 재시작한다
sshpass -p admin ssh -o StrictHostKeyChecking=no admin@$IP \
  "sudo mv /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/ && sleep 5 && sudo mv /tmp/kube-apiserver.yaml /etc/kubernetes/manifests/"
```

---

## 6. 일반적인 디버깅 워크플로우

문제가 발생했을 때 다음 순서로 진단한다.

### 단계 1: 전체 상태 확인
```bash
# 프로젝트의 status.sh로 전체 상태를 한 번에 확인
bash scripts/status.sh
```

### 단계 2: 계층별 확인
```bash
# VM 레이어
tart list

# Kubernetes 레이어
for cluster in platform dev staging prod; do
  echo "=== $cluster ==="
  kubectl --kubeconfig=kubeconfig/$cluster.yaml get nodes
  kubectl --kubeconfig=kubeconfig/$cluster.yaml get pods -A | grep -v Running | grep -v Completed
done

# 서비스 레이어
kubectl --kubeconfig=kubeconfig/platform.yaml get svc -A | grep NodePort
```

### 단계 3: 로그 수집
```bash
# 특정 Pod의 로그
kubectl --kubeconfig=$KUBECONFIG logs <pod-name> -n <namespace> --tail=100

# 이벤트 확인 (최근 문제 파악에 유용)
kubectl --kubeconfig=$KUBECONFIG get events -A --sort-by='.lastTimestamp' | tail -20

# VM 내부 시스템 로그
sshpass -p admin ssh -o StrictHostKeyChecking=no admin@<ip> \
  "sudo journalctl --no-pager -n 50"
```

### 단계 4: 전체 재구축 (최후 수단)
```bash
# 모든 것을 삭제하고 처음부터 재구축
bash scripts/destroy.sh
bash scripts/demo.sh
```

---

## 7. 자주 묻는 질문

**Q: VM 10개를 동시에 실행하면 호스트가 느려진다.**
A: 이 프로젝트의 전체 VM은 약 66GB 메모리를 사용한다. 64GB RAM에서는 메모리가 부족하므로, Activity Monitor에서 메모리 압력을 확인하고, 사용하지 않는 클러스터의 VM을 정지한다.

**Q: demo.sh 실행 중 중간에 실패했다. 이어서 실행할 수 있는가?**
A: install.sh는 각 Phase를 개별 스크립트(`01-create-vms.sh` ~ `17-install-harbor.sh`)로 분리하고 있다. 실패한 Phase의 스크립트부터 개별 실행하면 된다.

**Q: Golden Image를 사용하면 무엇이 달라지는가?**
A: `build-golden-image.sh`로 생성한 이미지에는 containerd, kubeadm, kubelet, kubectl이 사전 설치되어 있다. Phase 2~4 (prepare, runtime, kubeadm 설치)를 건너뛸 수 있어 구축 시간이 45분에서 15~20분으로 단축된다.

**Q: 클러스터를 하나만 구축할 수 있는가?**
A: `config/clusters.json`에서 필요한 클러스터만 남기고 나머지를 제거하면 된다. 단, platform 클러스터는 모니터링과 CI/CD를 호스팅하므로 유지하는 것을 권장한다.
