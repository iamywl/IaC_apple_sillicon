# 14. 트러블슈팅 — 문제가 생겼을 때 어떻게 해결하는가

> Apple Silicon 맥에서 구축하는 멀티 클러스터 Kubernetes 인프라

## 이번 글에서 배울 것

인프라를 운영하다 보면 **반드시** 문제가 생긴다. VM이 시작되지 않거나, Pod가 CrashLoopBackOff에 빠지거나, 서비스에 접속이 안 되거나. 이런 상황에서 당황하지 않고 **체계적으로 문제를 찾아 해결하는 방법**을 다룬다.

왜 체계적 트러블슈팅이 필요한가? 무작위로 설정을 바꿔보는 디버깅("이거 바꿔볼까? 저거 바꿔볼까?")은 두 가지 문제를 일으킨다. 첫째, 원인과 해결의 인과관계를 파악할 수 없어 같은 문제가 재발하면 또 시간을 낭비한다. 둘째, 무작위 변경이 다른 컴포넌트에 부작용을 만들어 문제를 확대시킬 수 있다. 체계적 접근은 가설-검증 루프를 통해 **최소한의 변경으로 정확한 원인을 격리**하는 것이 핵심이다.

이번 글은 이 프로젝트의 `doc/learning/troubleshooting.md`와 `doc/bug-reports/`에 기록된 실제 경험을 바탕으로 한다.

---

## 6단계 디버깅 프레임워크

인프라 트러블슈팅은 다음 6단계 프레임워크를 따른다. 증상을 먼저 정확히 식별하고, 범위를 좁힌 뒤 가설을 세우고 검증하는 체계적 접근 방식이다.

```
1. 증상 확인(Symptom)    → 무엇이 동작하지 않는가?
2. 범위 축소(Scope)      → 어느 레이어/컴포넌트인가?
3. 가설 수립(Hypothesis) → 왜 그런가?
4. 검증(Verify)          → 가설이 맞는지 확인
5. 해결(Fix)             → 수정 적용
6. 회고(Retrospect)      → 재발 방지
```

초보자가 가장 많이 하는 실수는 **"문제가 뭔지 정확히 모른 채 이것저것 바꿔보는 것"**이다. 이렇게 하면 문제가 해결되더라도 **왜 해결되었는지 모르고**, 더 나쁜 경우 **새로운 문제를 만들 수 있다**.

6단계를 따르면:
- 문제의 원인을 **정확히** 파악할 수 있다
- 같은 문제가 다시 발생했을 때 빠르게 해결할 수 있다
- 해결 과정을 문서로 남겨 팀원들과 공유할 수 있다

### 실제 프로젝트에서는

Google SRE 팀은 이 프레임워크를 **Postmortem(사후 분석)**이라고 부른다. 장애가 발생하면 반드시 문서를 작성하고, "누가 잘못했나"가 아니라 "시스템을 어떻게 개선할 수 있나"에 초점을 맞춘다. 이 프로젝트의 `doc/bug-reports/` 디렉토리가 바로 이 Postmortem의 축소판이다.

---

## 레이어별 디버깅 체크리스트

이 프로젝트는 여러 레이어로 구성되어 있다. 문제가 발생하면 **아래 레이어부터 위로** 확인해야 한다.

왜 레이어 기반으로 아래에서 위로 접근하는가? 인프라는 의존성 스택이다. VM이 꺼져 있으면 그 위의 K8s, Pod, 서비스, 네트워크 정책은 전부 동작하지 않는다. 상위 레이어 문제의 근본 원인(root cause)이 하위 레이어에 있는 경우가 빈번하다. 예를 들어 "서비스 접속 불가"의 원인이 Pod 장애이고, Pod 장애의 원인이 노드 메모리 부족이고, 노드 메모리 부족의 원인이 VM 메모리 할당 오류일 수 있다. 아래부터 확인하면 하위 레이어를 정상으로 확인한 후 상위 레이어로 범위를 좁혀갈 수 있어, 불필요한 조사를 줄인다.

```
Layer 5: 네트워크 정책 (Hubble, DROPPED)
Layer 4: 서비스 접속 (kubectl get svc, endpoints)
Layer 3: Pod 상태 (kubectl describe pod, CrashLoopBackOff)
Layer 2: K8s 클러스터 (kubectl get nodes, NotReady)
Layer 1: SSH 접속 (sshpass, connectivity)
Layer 0: VM 실행 (tart list, tart ip)
```

---

### Layer 0: VM이 시작되지 않을 때

**증상**: `tart run` 명령이 실패하거나, VM이 목록에 보이지 않음

```bash
# 1단계: VM 목록 확인
tart list
# 출력 예시:
#   platform-master  local  running
#   platform-worker1 local  stopped   ← 문제!
#   dev-master       local  running

# 2단계: VM IP 확인 — IP가 없으면 네트워크 문제
tart ip platform-worker1
# "No IP found" → VM이 완전히 부팅되지 않았음

# 3단계: VM 직접 실행 — 에러 메시지 확인
tart run platform-worker1 --no-graphics
# 에러가 나오면 메시지를 정확히 읽기

# 4단계: 디스크 공간 확인 — VM당 20GB 필요
df -h ~/.tart/

# 5단계: 최후의 수단 — VM 삭제 후 재생성
tart delete platform-worker1
tart clone ghcr.io/cirruslabs/ubuntu:latest platform-worker1
tart set platform-worker1 --cpu 3 --memory 12288
```

**흔한 원인과 해결법:**

| 원인 | 증상 | 해결법 |
|------|------|--------|
| 디스크 공간 부족 | VM 생성/시작 실패 | `df -h`로 확인, 불필요한 파일 삭제 |
| 이미지 손상 | 부팅 중 멈춤 | `tart delete` 후 `tart clone`으로 재생성 |
| macOS 업데이트 후 | Hypervisor 권한 변경 | Mac 재시작 또는 `tart` 재설치 |
| CPU/메모리 초과 할당 | VM 시작 실패 | `clusters.json`의 리소스 합계 확인 (총 21 vCPU / 71.5GB) |

---

### Layer 1: SSH 접속이 안 될 때

**증상**: `ssh admin@<ip>` 명령이 타임아웃되거나 거부됨

```bash
# 1단계: VM이 실행 중인지 확인
tart list | grep platform-worker1
# "running" 상태여야 함

# 2단계: IP 할당 확인
tart ip platform-worker1
# IP가 나오는지 확인

# 3단계: ping 테스트 — 네트워크 연결 확인
ping -c 3 $(tart ip platform-worker1)
# 응답이 오는지 확인

# 4단계: SSH 상세 로그로 접속 시도
ssh -vvv admin@$(tart ip platform-worker1)
# 어느 단계에서 실패하는지 확인
# "Connection refused" → sshd가 안 돌고 있음
# "Connection timed out" → 네트워크 문제
# "Permission denied" → 비밀번호 오류

# 5단계: 콘솔로 직접 접속 (SSH 없이)
tart run platform-worker1
# GUI 콘솔이 열리면 직접 로그인 후:
# systemctl status sshd
```

**흔한 원인과 해결법:**

| 원인 | 증상 | 해결법 |
|------|------|--------|
| VM 부팅 완료 전 접속 시도 | Connection refused | `ssh_wait_ready` 함수 사용 (최대 60초 대기) |
| IP 변경 (DHCP) | 이전 IP로 접속 실패 | `tart ip <vm>`으로 현재 IP 재확인 |
| known_hosts 충돌 | SSH fingerprint 경고 | `-o StrictHostKeyChecking=no` 옵션 사용 |
| sshd 미실행 | Connection refused | 콘솔로 접속 후 `sudo systemctl start sshd` |

#### "VM IP가 변경되는 문제" 심화

이 프로젝트의 VM은 **DHCP**로 IP를 받는다. Mac을 재부팅하거나 VM을 재시작하면 IP가 바뀔 수 있다.

```bash
# 재부팅 전
tart ip dev-worker1  → 192.168.64.5

# 재부팅 후
tart ip dev-worker1  → 192.168.64.8  ← 변경됨!
```

이 프로젝트의 자동화 스크립트(`scripts/lib/vm.sh`)는 `vm_wait_for_ip()` 함수로 이 문제를 해결한다. 3초 간격으로 최대 60회 IP를 확인하여, IP가 할당될 때까지 대기한다.

---

### Layer 2: K8s 클러스터에 문제가 있을 때

**증상**: `kubectl get nodes`에서 노드가 NotReady이거나, 명령이 실패함

```bash
# 1단계: 노드 상태 확인
kubectl --kubeconfig kubeconfig/prod.yaml get nodes
# 출력 예시:
# NAME           STATUS     ROLES          AGE   VERSION
# prod-master    Ready      control-plane  5d    v1.31.0
# prod-worker1   NotReady   <none>         5d    v1.31.0  ← 문제!
# prod-worker2   Ready      <none>         5d    v1.31.0

# 2단계: 노드 상세 정보 — 조건(Conditions)과 이벤트(Events)
kubectl --kubeconfig kubeconfig/prod.yaml describe node prod-worker1
# Conditions 섹션에서:
#   MemoryPressure: True   ← 메모리 부족
#   DiskPressure: True     ← 디스크 부족
#   PIDPressure: True      ← 프로세스 너무 많음
#   Ready: False           ← 노드 비정상

# 3단계: kubelet 상태 확인 (SSH로 VM에 접속)
ssh admin@$(tart ip prod-worker1) "sudo systemctl status kubelet"
ssh admin@$(tart ip prod-worker1) "sudo journalctl -u kubelet --no-pager -n 50"

# 4단계: containerd 상태 확인
ssh admin@$(tart ip prod-worker1) "sudo systemctl status containerd"

# 5단계: CNI(Cilium) 상태 확인
kubectl --kubeconfig kubeconfig/prod.yaml get pods -n kube-system | grep cilium
```

**흔한 원인과 해결법:**

| 원인 | 증상 | 해결법 |
|------|------|--------|
| Cilium 미설치/크래시 | 모든 노드 NotReady | Cilium Pod 상태 확인, 재설치 |
| kubelet이 API 서버에 접근 불가 | worker만 NotReady | 마스터 IP 변경 확인, kubeadm join 재실행 |
| 리소스 부족 | MemoryPressure | `free -m`으로 메모리 확인, VM 메모리 증가 |
| kubelet 비정상 | Ready: False | `sudo systemctl restart kubelet` |

---

### Layer 3: Pod에 문제가 있을 때

**증상**: Pod가 Running이 아닌 다른 상태에 머물러 있음

```bash
# 1단계: Pod 상태 확인
kubectl --kubeconfig kubeconfig/dev.yaml get pods -n demo
# 출력 예시:
# NAME                        READY   STATUS             RESTARTS   AGE
# nginx-web-5d4f7b8c9-abc12  1/1     Running            0          5d
# httpbin-7f8d9c6b5-def34    0/1     CrashLoopBackOff   15         5d   ← 문제!
# redis-8e7f6d5c4-ghi56      0/1     Pending            0          2m   ← 문제!

# 2단계: 문제 Pod 상세 정보 확인
kubectl --kubeconfig kubeconfig/dev.yaml describe pod httpbin-7f8d9c6b5-def34 -n demo
# Events 섹션이 핵심!
```

#### CrashLoopBackOff 해결하기

CrashLoopBackOff는 "Pod가 시작 → 크래시 → 재시작 → 크래시를 반복"하는 상태이다. 컨테이너가 기동 직후 비정상 종료되어 kubelet이 재시작을 반복하되, 백오프 간격을 점점 늘리는 상태를 뜻한다.

왜 Pod 상태를 구분하는 것이 중요한가? Pending, CrashLoopBackOff, ImagePullBackOff, OOMKilled는 각각 원인이 완전히 다르다. Pending은 스케줄러가 노드를 찾지 못한 것(리소스 부족 또는 taint)이고, CrashLoopBackOff는 애플리케이션이 시작 직후 비정상 종료되는 것이고, ImagePullBackOff는 컨테이너 이미지를 가져오지 못한 것이고, OOMKilled는 메모리 limits를 초과한 것이다. 상태를 정확히 식별해야 올바른 디버깅 경로를 선택할 수 있다.

```bash
# 현재 로그 확인
kubectl --kubeconfig kubeconfig/dev.yaml logs httpbin-7f8d9c6b5-def34 -n demo

# 이전 크래시의 로그 확인 (더 유용한 경우가 많음)
kubectl --kubeconfig kubeconfig/dev.yaml logs httpbin-7f8d9c6b5-def34 -n demo --previous
```

#### OOMKilled 해결하기

OOMKilled는 "메모리를 너무 많이 사용해서 강제 종료"된 상태이다.

```bash
# OOMKilled 확인
kubectl --kubeconfig kubeconfig/dev.yaml get pod httpbin-7f8d9c6b5-def34 -n demo \
  -o jsonpath='{.status.containerStatuses[0].lastState}'
# → {"terminated":{"reason":"OOMKilled", ...}}
```

**해결법**: Pod의 `resources.limits.memory`를 늘린다.

```yaml
resources:
  requests:
    memory: 64Mi
  limits:
    memory: 256Mi    # ← 이 값을 512Mi로 올리기
```

#### Pending 상태 해결하기

Pending은 스케줄러가 Pod를 배치할 노드를 찾지 못한 상태이다. 노드의 가용 리소스가 Pod의 requests를 충족하지 못하거나, taint/toleration 조건이 맞지 않을 때 발생한다.

```bash
# describe에서 Events 확인
kubectl describe pod redis-8e7f6d5c4-ghi56 -n demo
# 흔한 이벤트 메시지:
# "0/2 nodes are available: insufficient cpu"     ← CPU 부족
# "0/2 nodes are available: insufficient memory"  ← 메모리 부족
# "0/2 nodes are available: 1 node(s) had taint"  ← 마스터 노드만 있음
```

#### ImagePullBackOff 해결하기

ImagePullBackOff는 "컨테이너 이미지를 다운로드하지 못한 상태"이다.

```bash
# describe에서 Events 확인
# 흔한 원인:
# 1. 이미지 이름 오타: "ngiinx:alpine" → "nginx:alpine"
# 2. 프라이빗 레지스트리 인증 없음
# 3. 인터넷 연결 문제

# 이미지가 존재하는지 확인 (Mac에서)
docker pull nginx:alpine  # 또는 해당 이미지
```

---

### Layer 4: 서비스에 접속이 안 될 때

**증상**: NodePort URL로 접속하면 응답이 없음

```bash
# 1단계: Service 확인
kubectl --kubeconfig kubeconfig/dev.yaml get svc -n demo
# 출력 예시:
# NAME        TYPE       CLUSTER-IP     PORT(S)          AGE
# nginx-web   NodePort   10.97.45.123   80:30080/TCP     5d
# httpbin     ClusterIP  10.97.67.234   80/TCP           5d

# 2단계: Endpoints 확인 — Pod가 연결되어 있는지
kubectl --kubeconfig kubeconfig/dev.yaml get endpoints -n demo
# 출력 예시:
# NAME        ENDPOINTS                          AGE
# nginx-web   10.20.1.5:80,10.20.1.6:80         5d
# httpbin     <none>                             5d  ← Pod가 연결 안 됨!

# Endpoints가 <none>이면 → Service selector와 Pod label이 불일치

# 3단계: Pod에서 내부 접근 테스트
kubectl --kubeconfig kubeconfig/dev.yaml exec -it deploy/nginx-web -n demo \
  -- curl -s http://httpbin/get
# 클러스터 내부에서는 되는데 외부에서 안 되면 → NodePort/방화벽 문제

# 4단계: 외부에서 NodePort 접근 테스트
curl http://$(tart ip dev-worker1):30080
# 응답이 없으면 → VM 네트워크 또는 NodePort 문제
```

**흔한 원인과 해결법:**

| 원인 | 확인 방법 | 해결법 |
|------|----------|--------|
| Service selector 불일치 | `get endpoints` → `<none>` | Service YAML의 selector를 Pod label과 맞추기 |
| Pod가 없음 | `get pods` → 0개 | Deployment replica 확인 |
| NodePort 범위 밖 | Service 생성 실패 | 30000-32767 범위 내 포트 사용 |
| VM IP 변경 | `tart ip`로 확인 | 새 IP로 접속 |

---

### Layer 5: 네트워크 정책으로 트래픽이 차단될 때

**증상**: Pod 간 통신이 안 되지만, 서비스 자체는 정상

이 프로젝트에서는 10편에서 설정한 **제로 트러스트 네트워크 정책**(기본 차단 + 화이트리스트)이 적용되어 있다.

왜 제로 트러스트 환경의 디버깅이 다른가? 일반 Kubernetes 클러스터에서는 모든 Pod 간 통신이 기본적으로 허용된다. 그러나 제로 트러스트 모델에서는 명시적으로 허용하지 않은 트래픽은 전부 차단된다. 따라서 "정상 동작하는 코드인데 통신이 안 된다"는 상황이 빈번하게 발생한다. 이때 애플리케이션 코드에는 문제가 없으므로, 로그만 보면 원인을 찾을 수 없다. 네트워크 정책 레이어를 별도로 확인해야 하며, Hubble로 DROPPED 트래픽을 조회하는 것이 핵심 디버깅 수단이 된다.

새로운 서비스를 추가했는데 통신이 안 되면, 네트워크 정책이 원인일 가능성이 높다.

```bash
# 1단계: 현재 네트워크 정책 확인
kubectl --kubeconfig kubeconfig/dev.yaml get cnp -n demo
# CiliumNetworkPolicy 목록이 표시됨

# 2단계: Hubble로 차단된 트래픽 확인
# (hubble-relay 포트포워드가 필요)
kubectl --kubeconfig kubeconfig/dev.yaml -n kube-system \
  port-forward svc/hubble-relay 4245:80 &

hubble observe --namespace demo --verdict DROPPED
# 출력 예시:
# DROPPED: demo/nginx-web → demo/redis:6379 (Policy denied)
#                                              ↑ 정책이 차단!

# 3단계: 특정 Pod의 트래픽 상세 확인
hubble observe --namespace demo --pod demo/nginx-web-5d4f7b8c9-abc12
```

제로 트러스트 모델에서는 모든 트래픽이 기본적으로 차단된다. 특정 Pod가 특정 서비스에 접근하려면 해당 통신을 명시적으로 허용하는 CiliumNetworkPolicy가 존재해야 한다. Hubble은 네트워크 관측성 도구로, 어떤 트래픽이 어디서 차단되었는지 실시간으로 확인할 수 있다.

---

## 자주 발생하는 에러와 해결법 모음

### 에러 1: VM IP가 재부팅 후 바뀜 (DHCP)

```
증상: 기존 IP로 SSH 접속 불가, kubectl 명령 타임아웃
원인: Tart VM은 DHCP로 IP를 받아서, 재부팅 시 변경될 수 있음
```

**해결법:**
```bash
# 모든 VM의 현재 IP 확인
for vm in platform-master platform-worker1 platform-worker2 \
          dev-master dev-worker1 staging-master staging-worker1 \
          prod-master prod-worker1 prod-worker2; do
  echo "$vm: $(tart ip $vm 2>/dev/null || echo 'not running')"
done

# kubeconfig 파일은 마스터 IP를 참조하므로,
# 마스터 IP가 바뀌면 kubeconfig를 다시 복사해야 함
sshpass -p admin scp -o StrictHostKeyChecking=no \
  admin@$(tart ip prod-master):.kube/config kubeconfig/prod.yaml
```

**예방법**: `scripts/boot.sh`를 사용하면 IP 변경을 자동으로 처리한다.

### 에러 2: Pod가 Pending에 머무름 (리소스 부족)

```
증상: kubectl get pods → Pending 상태 지속
원인: 노드에 요청된 CPU/메모리를 할당할 여유가 없음
```

**해결법:**
```bash
# 1. 현재 리소스 사용량 확인
kubectl --kubeconfig kubeconfig/dev.yaml top nodes
kubectl --kubeconfig kubeconfig/dev.yaml top pods -n demo

# 2. 불필요한 Pod 삭제
kubectl --kubeconfig kubeconfig/dev.yaml delete pod <불필요한-pod> -n demo

# 3. Pod의 리소스 요청(request) 줄이기
# manifests/demo/ 안의 해당 Deployment YAML 수정
```

### 에러 3: ImagePullBackOff

```
증상: kubectl get pods → ImagePullBackOff
원인: 컨테이너 이미지 다운로드 실패
```

**해결법:**
```bash
# 1. 이미지 이름 확인 — 오타가 가장 흔한 원인
kubectl --kubeconfig kubeconfig/dev.yaml describe pod <pod-name> -n demo | grep Image
# Image: ngiinx:alpine  ← 오타!

# 2. VM에서 직접 이미지 풀 시도
ssh admin@$(tart ip dev-worker1) "sudo crictl pull nginx:alpine"

# 3. 인터넷 연결 확인
ssh admin@$(tart ip dev-worker1) "ping -c 3 registry-1.docker.io"
```

### 에러 4: CrashLoopBackOff

```
증상: Pod가 계속 재시작됨 (RESTARTS 수치가 계속 증가)
원인: 애플리케이션 자체의 에러, 설정 오류, 의존 서비스 미기동
```

**해결법:**
```bash
# 1. 로그 확인 — 가장 중요!
kubectl --kubeconfig kubeconfig/dev.yaml logs <pod-name> -n demo
kubectl --kubeconfig kubeconfig/dev.yaml logs <pod-name> -n demo --previous

# 2. 흔한 원인별 해결
# a) 설정 파일 오류 → ConfigMap/Secret 확인
# b) 포트 충돌 → 다른 컨테이너가 같은 포트 사용
# c) 의존 서비스 미기동 → 데이터베이스나 캐시가 아직 안 올라옴
# d) 메모리 부족 → resources.limits.memory 늘리기
```

**실제 사례 — 이 프로젝트의 BUG-006:**

Grafana가 CrashLoopBackOff에 빠진 적이 있었다. 원인은 Prometheus와 Loki가 모두 `isDefault: true`로 설정되어 "기본 데이터소스 충돌"이 발생한 것이었다.

```yaml
# 해결: loki-values.yaml에서 기본 데이터소스 해제
grafana:
  sidecar:
    datasources:
      isDefaultDatasource: false  # Prometheus가 기본이 되도록
```

### 에러 5: Service에 접속이 안 됨 (NodePort)

```
증상: curl http://<vm-ip>:30080 → 응답 없음
원인: 다양함 — VM IP 변경, Pod 미실행, NetworkPolicy 차단
```

**해결법 — 순서대로 확인:**
```bash
# 1. VM IP가 맞는지 확인
tart ip dev-worker1

# 2. Service가 존재하는지 확인
kubectl --kubeconfig kubeconfig/dev.yaml get svc -n demo

# 3. Pod가 Running인지 확인
kubectl --kubeconfig kubeconfig/dev.yaml get pods -n demo

# 4. Endpoints가 있는지 확인
kubectl --kubeconfig kubeconfig/dev.yaml get endpoints nginx-web -n demo

# 5. Pod 내부에서 접근 가능한지 확인
kubectl --kubeconfig kubeconfig/dev.yaml exec -it deploy/nginx-web -n demo \
  -- curl -s localhost:80
```

---

## 이 프로젝트에서 발생한 실제 버그들

### BUG-001: SSH heredoc 따옴표 깨짐

SSH를 통해 원격 서버에서 `sed` 명령을 실행했는데, 따옴표가 꼬였다.

```bash
# 문제 코드 — bash -c '...' 안에서 작은따옴표 충돌
ssh user@ip "echo 'password' | sudo -S bash -c 'sed -i s/foo/bar/ file'"
#                                              ^                       ^
#                                   이 따옴표들이 서로 충돌!
```

**해결법 — heredoc 패턴 사용:**
```bash
ssh user@ip sudo bash -s <<EOF
sed -i 's/foo/bar/' file
EOF
```

**교훈**: SSH를 통한 원격 명령에서는 따옴표가 **중첩**된다. heredoc으로 이 문제를 피할 수 있다.

### BUG-003: VM 간 통신 불가 — NAT 모드의 한계

`kubeadm join`이 타임아웃되었다. Worker VM에서 Master VM으로 ping이 안 갔다.

```bash
# Host → VM: 가능
ping -c 2 192.168.66.2  → OK

# VM → VM: 불가
ssh admin@192.168.66.3 "ping -c 2 192.168.66.2"  → Destination Host Unreachable
```

**원인**: NAT 모드에서는 Host→VM은 가능하지만 VM→VM은 불가하다.

**해결법**: `--net-softnet-allow=0.0.0.0/0` 옵션으로 소프트웨어 브릿지 네트워크를 사용한다.

### BUG-004: Cilium 부트스트랩 순환 의존성

Cilium이 CrashLoopBackOff에 빠졌다. 순환 의존성(circular dependency) 문제였다.

```
Cilium이 시작되려면 → K8s API 서버에 접근 필요 (ClusterIP: 10.96.0.1)
ClusterIP가 작동하려면 → kube-proxy 또는 Cilium이 필요
하지만 kube-proxy를 설치하지 않았음 (Cilium이 대체)
→ Cilium이 시작되지 않으면 ClusterIP 접근 불가
→ ClusterIP 접근이 안 되면 Cilium 시작 불가
→ 무한 루프!
```

**해결법**: Cilium에게 ClusterIP 대신 **마스터 노드의 실제 IP**를 알려준다.

```bash
helm install cilium cilium/cilium \
  --set k8sServiceHost="192.168.65.2" \   # ClusterIP(10.96.0.1) 대신 실제 IP
  --set k8sServicePort=6443
```

### BUG-007: kubeadm CPU 최소 요구사항

리소스를 아끼려고 master에 CPU 1개만 할당했더니 `kubeadm init`이 실패했다.

```
[ERROR NumCPU]: the number of available CPUs 1 is less than the required 2
```

**교훈**: kubeadm은 **최소 2 CPU, 2GB RAM**을 요구한다. etcd, kube-apiserver, kube-scheduler가 동시에 실행되어야 하기 때문이다.

---

## 유용한 진단 명령어 모음

### 기본 클러스터 진단

```bash
# 클러스터 전체 상태
kubectl cluster-info
kubectl get nodes -o wide

# 모든 네임스페이스의 이벤트 (최근 순)
kubectl get events --sort-by='.lastTimestamp' -A

# 리소스 사용량 (metrics-server 필요)
kubectl top pods -n demo
kubectl top nodes
```

### Pod 디버깅

```bash
# Pod 내부 쉘 접속
kubectl exec -it deploy/nginx-web -n demo -- /bin/sh

# DNS 확인
kubectl exec -it deploy/nginx-web -n demo -- nslookup httpbin.demo.svc.cluster.local

# 네트워크 연결 테스트
kubectl exec -it deploy/nginx-web -n demo -- curl -v http://httpbin/get

# 임시 디버깅 Pod 생성
kubectl run debug --rm -it --image=nicolaka/netshoot -- bash
```

### Helm 디버깅

```bash
# 설치된 차트 목록
helm list -A

# 차트 배포 히스토리
helm history cilium -n kube-system

# 현재 적용된 values 확인
helm get values cilium -n kube-system

# 문제 시 롤백
helm rollback cilium 1 -n kube-system
```

### Cilium 디버깅

```bash
# Cilium 상태
kubectl exec -n kube-system ds/cilium -- cilium status

# BPF 엔드포인트 확인
kubectl exec -n kube-system ds/cilium -- cilium bpf endpoint list

# 네트워크 정책 상태
kubectl exec -n kube-system ds/cilium -- cilium policy get
```

### 성능 진단

```bash
# CPU 많이 쓰는 Pod 확인
kubectl top pods -n demo --sort-by=cpu

# 메모리 많이 쓰는 Pod 확인
kubectl top pods -n demo --sort-by=memory

# VM 내부 프로세스 확인 (SSH)
ssh admin@$(tart ip dev-worker1) "top -bn1 | head -20"

# HPA 상태 확인
kubectl get hpa -n demo
```

---

## 재해 복구 절차

### Mac 재부팅 후 전체 복구

```bash
# 1. 모든 VM 시작
./scripts/boot.sh

# 2. 상태 확인
./scripts/status.sh

# 3. 문제가 있으면 개별 클러스터 확인
kubectl --kubeconfig kubeconfig/dev.yaml get nodes
kubectl --kubeconfig kubeconfig/dev.yaml get pods -A
```

### kubeconfig 분실/손상

```bash
# 마스터 노드에서 다시 복사
sshpass -p admin scp -o StrictHostKeyChecking=no \
  admin@$(tart ip prod-master):.kube/config kubeconfig/prod.yaml
```

### 특정 클러스터 완전 재구축

최후의 수단이다. VM을 삭제하고 처음부터 다시 만든다.

```bash
# VM 삭제
for vm in prod-master prod-worker1 prod-worker2; do
  tart stop $vm 2>/dev/null
  tart delete $vm
done

# 전체 재설치
./scripts/install.sh
```

---

## 트러블슈팅 마인드맵

```
문제 발생!
    │
    ├─ 1. VM 관련? ─────── tart list / tart ip / tart run
    │
    ├─ 2. SSH 관련? ────── ping / ssh -vvv / systemctl status sshd
    │
    ├─ 3. 노드 관련? ───── kubectl get nodes / describe node / kubelet 로그
    │
    ├─ 4. Pod 관련?
    │     ├─ Pending ────── describe pod → 리소스 부족? taint?
    │     ├─ CrashLoop ─── logs / logs --previous → 앱 에러?
    │     ├─ ImagePull ─── 이미지 이름 오타? 인터넷 연결?
    │     └─ OOMKilled ─── limits.memory 늘리기
    │
    ├─ 5. 서비스 관련? ─── get svc / get endpoints / curl 테스트
    │
    └─ 6. 네트워크 관련? ── hubble observe --verdict DROPPED / get cnp
```

### 실제 프로젝트에서는

실제 기업 환경에서는 이런 트러블슈팅 패턴을 **런북(Runbook)**으로 문서화한다. "알림 X가 울리면 → A 확인 → B 확인 → C로 해결"의 형태로 정리하여, **새벽 3시에 알림을 받은 온콜 엔지니어**도 빠르게 대응할 수 있게 한다.

이 프로젝트의 `doc/learning/troubleshooting.md`가 바로 이 런북의 역할을 한다.

다음 편에서는 지금까지 배운 모든 것을 **하나로 통합**하여, 처음부터 끝까지 전체 프로젝트를 정리한다.
