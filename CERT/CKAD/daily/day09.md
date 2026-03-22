# CKAD Day 9: Probe, 로깅, 디버깅 이론

> CKAD 도메인: Application Observability and Maintenance (15%) - Part 1a | 예상 소요 시간: 1시간

---

## 오늘의 학습 목표

- [ ] Liveness, Readiness, Startup Probe의 차이와 용도를 이해한다
- [ ] httpGet, tcpSocket, exec 3가지 체크 방식을 숙지한다
- [ ] Probe 파라미터(initialDelaySeconds, periodSeconds, failureThreshold)를 설정할 수 있다
- [ ] kubectl logs와 Sidecar 로깅 패턴을 학습한다
- [ ] kubectl exec, kubectl debug로 컨테이너를 디버깅할 수 있다

---

## 1. Probe (프로브) - 컨테이너 상태 감시

### 1.1 Probe란?

**공학적 정의:**
Probe는 kubelet이 컨테이너의 상태를 주기적으로 진단하는 메커니즘이다. kubelet은 컨테이너에 대해 3가지 프로브를 독립적으로 실행하며, 각 프로브는 httpGet/tcpSocket/exec 중 하나의 핸들러(handler)로 상태를 확인한다. Probe 결과는 Success(200-399), Failure, Unknown 중 하나이며, 결과에 따라 kubelet이 컨테이너 재시작(Liveness), Endpoints 제거/등록(Readiness), 또는 다른 프로브 시작 지연(Startup)을 수행한다.

**3가지 Probe:**

| Probe | 목적 | 실패 시 동작 | 언제 사용? |
|-------|------|------------|----------|
| **Startup** | 앱 초기화 완료 확인 | 컨테이너 재시작 | 시작이 느린 앱 |
| **Liveness** | 앱이 살아있는지 확인 | 컨테이너 재시작 | 교착 상태 감지 |
| **Readiness** | 트래픽 받을 준비 확인 | Endpoints에서 제거 | 트래픽 제어 |

### 1.2 Probe 실행 순서

```
[컨테이너 시작]
    |
    v
[Startup Probe 실행] (설정된 경우)
    |
    ├── 성공할 때까지 반복
    |   └── 실패 횟수 > failureThreshold -> 컨테이너 재시작
    |
    ├── 성공 -> Startup Probe 비활성화
    |
    v
[Liveness Probe + Readiness Probe 동시 시작]
    |
    ├── Liveness: 주기적 실행
    |   └── 실패 횟수 > failureThreshold -> 컨테이너 재시작
    |
    └── Readiness: 주기적 실행
        ├── 성공 -> Endpoints에 Pod IP 추가 (트래픽 수신)
        └── 실패 -> Endpoints에서 Pod IP 제거 (트래픽 차단)
```

### 1.3 httpGet 체크

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: http-probe-pod
spec:
  containers:
    - name: app
      image: nginx:1.25
      ports:
        - containerPort: 80

      # Startup Probe: 앱 초기화 완료 대기
      startupProbe:
        httpGet:
          path: /                    # HTTP GET 요청 경로
          port: 80                   # 요청 포트
        failureThreshold: 30         # 최대 실패 횟수
        periodSeconds: 2             # 체크 주기 (초)
        # 최대 대기 시간: 30 * 2 = 60초

      # Liveness Probe: 앱이 살아있는지 확인
      livenessProbe:
        httpGet:
          path: /healthz             # 헬스체크 전용 경로
          port: 80
        initialDelaySeconds: 5       # 첫 체크 전 대기 시간
        periodSeconds: 10            # 10초마다 체크
        timeoutSeconds: 3            # 응답 대기 시간 (기본: 1초)
        failureThreshold: 3          # 3번 연속 실패 시 재시작
        successThreshold: 1          # 1번 성공하면 건강 (기본값)

      # Readiness Probe: 트래픽 수신 준비 확인
      readinessProbe:
        httpGet:
          path: /ready               # 준비 상태 확인 경로
          port: 80
        initialDelaySeconds: 5
        periodSeconds: 5             # 5초마다 체크
        failureThreshold: 3          # 3번 실패 시 Endpoints에서 제거
        successThreshold: 1
```

**httpGet 응답 코드:**
- **200-399**: Success (건강)
- **400 이상**: Failure (비정상)

### 1.4 tcpSocket 체크

```yaml
# TCP 연결만 확인 (HTTP 서버가 아닌 경우)
livenessProbe:
  tcpSocket:
    port: 5432                     # TCP 포트에 연결 시도
  initialDelaySeconds: 15
  periodSeconds: 20

readinessProbe:
  tcpSocket:
    port: 5432
  initialDelaySeconds: 5
  periodSeconds: 10
```

**용도:** 데이터베이스(PostgreSQL, MySQL, Redis), 메시지 큐(RabbitMQ) 등 HTTP가 아닌 서비스

### 1.5 exec 체크

```yaml
# 컨테이너 내부에서 명령 실행
livenessProbe:
  exec:
    command:                       # 종료 코드 0 = 성공
      - cat
      - /tmp/healthy               # 파일 존재 여부로 상태 확인
  initialDelaySeconds: 5
  periodSeconds: 5

# 복잡한 헬스체크 스크립트
livenessProbe:
  exec:
    command:
      - /bin/sh
      - -c
      - pg_isready -U postgres     # PostgreSQL 상태 확인
  periodSeconds: 10
```

**용도:** 커스텀 헬스체크 스크립트, 파일 기반 상태 확인, CLI 도구로 상태 확인

### 1.6 Probe 파라미터 상세

```
initialDelaySeconds: 0     # 컨테이너 시작 후 첫 프로브까지 대기 (기본: 0)
periodSeconds: 10          # 프로브 실행 주기 (기본: 10)
timeoutSeconds: 1          # 응답 대기 시간 (기본: 1)
failureThreshold: 3        # 연속 실패 횟수 (기본: 3)
successThreshold: 1        # 연속 성공 횟수 (기본: 1, Liveness/Startup은 1만 가능)

Startup Probe 최대 대기 시간 = failureThreshold * periodSeconds
예: failureThreshold=30, periodSeconds=2 -> 최대 60초

Liveness Probe가 재시작을 트리거하기까지:
initialDelaySeconds + (failureThreshold * periodSeconds)
예: 5 + (3 * 10) = 35초
```

### 1.7 Liveness vs Readiness 차이 시각화

```
[Liveness Probe 실패 시]
Pod 상태: Running -> Container 재시작 -> Running
Endpoints: 변화 없음 (재시작 중 잠깐 제거될 수 있음)
효과: 컨테이너가 재시작되어 문제 해결 시도

[Readiness Probe 실패 시]
Pod 상태: Running (변화 없음)
Endpoints: Pod IP 제거 -> 트래픽 수신 중단
효과: 문제가 해결될 때까지 트래픽만 차단, 재시작 안 함

시나리오:
  Liveness: "앱이 죽었다 -> 재시작해야 한다"
  Readiness: "앱이 바쁘다/아직 준비 안됨 -> 트래픽만 빼자"
```

---

## 2. Container Logging (컨테이너 로깅)

### 2.1 kubectl logs 기본

```bash
# 단일 컨테이너 Pod 로그
kubectl logs <pod-name>
kubectl logs <pod-name> -n <namespace>

# 특정 컨테이너 로그 (Multi-container Pod)
kubectl logs <pod-name> -c <container-name>

# 실시간 로그 스트리밍 (-f: follow)
kubectl logs -f <pod-name>

# 마지막 N줄만
kubectl logs <pod-name> --tail=100

# 최근 시간 기준 로그
kubectl logs <pod-name> --since=1h       # 최근 1시간
kubectl logs <pod-name> --since=5m       # 최근 5분

# 이전 컨테이너 로그 (CrashLoopBackOff 디버깅)
kubectl logs <pod-name> --previous

# 타임스탬프 포함
kubectl logs <pod-name> --timestamps

# Label selector로 여러 Pod 로그
kubectl logs -l app=web --tail=10
kubectl logs -l app=web --all-containers
```

### 2.2 Sidecar Logging 패턴

메인 앱이 파일로 로그를 출력하고, Sidecar 컨테이너가 이를 stdout으로 전달하는 패턴이다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: sidecar-logging
spec:
  containers:
    # 메인 앱: 파일에 로그 기록
    - name: app
      image: busybox:1.36
      command: ["sh", "-c"]
      args:
        - |
          while true; do
            echo "$(date) [INFO] Processing request..." >> /var/log/app/app.log
            sleep 5
          done
      volumeMounts:
        - name: log-vol
          mountPath: /var/log/app

    # Sidecar: 로그 파일을 stdout으로 스트리밍
    - name: log-streamer
      image: busybox:1.36
      command: ["sh", "-c", "tail -f /var/log/app/app.log"]
      volumeMounts:
        - name: log-vol
          mountPath: /var/log/app
          readOnly: true

  volumes:
    - name: log-vol
      emptyDir: {}
```

**Sidecar Logging이 필요한 이유:**
- `kubectl logs`는 stdout/stderr만 수집한다
- 앱이 파일에 로그를 기록하면 `kubectl logs`로 볼 수 없다
- Sidecar가 파일 로그를 stdout으로 변환한다

---

## 3. Debugging (디버깅)

### 3.1 kubectl exec

```bash
# 실행 중인 컨테이너에서 명령 실행
kubectl exec <pod-name> -- <command>

# 인터랙티브 셸
kubectl exec -it <pod-name> -- /bin/sh

# 실용적인 디버깅 명령
kubectl exec <pod> -- env               # 환경 변수 확인
kubectl exec <pod> -- cat /etc/resolv.conf   # DNS 설정 확인
kubectl exec <pod> -- curl -s localhost:8080  # 로컬 접근 테스트
kubectl exec <pod> -- nslookup svc-name       # DNS 해석 확인
```

### 3.2 kubectl debug (Ephemeral Container)

```bash
# Ephemeral container를 추가하여 디버깅
kubectl debug -it <pod-name> \
  --image=busybox:1.36 \
  --target=<container-name>

# 디버깅용 Pod를 Node에 생성
kubectl debug node/<node-name> -it --image=busybox:1.36

# 기존 Pod를 복사하여 디버깅 (원본에 영향 없음)
kubectl debug <pod-name> -it \
  --copy-to=debug-pod \
  --image=busybox:1.36 \
  --share-processes
```

### 3.3 kubectl top (리소스 사용량)

```bash
# Pod 리소스 사용량 (metrics-server 필요)
kubectl top pods -n demo
kubectl top pods --sort-by=cpu -n demo
kubectl top pods --sort-by=memory -n demo

# Node 리소스 사용량
kubectl top nodes
```

### 3.4 Pod 상태별 트러블슈팅

```
[Pending]
├── 원인: 스케줄링 실패
│   ├── 노드 리소스 부족 (Insufficient cpu/memory)
│   ├── nodeSelector/nodeAffinity 매칭 실패
│   ├── PVC가 바운드되지 않음
│   └── Taint/Toleration 불일치
├── 진단: kubectl describe pod <name> -> Events
└── 해결: 리소스 확인, 노드 추가, selector 수정

[ImagePullBackOff / ErrImagePull]
├── 원인: 이미지 가져오기 실패
│   ├── 이미지 이름/태그 오타
│   ├── 프라이빗 레지스트리 인증 실패
│   └── 이미지가 존재하지 않음
├── 진단: kubectl describe pod <name> -> Events
└── 해결: 이미지 이름 확인, imagePullSecrets 설정

[CrashLoopBackOff]
├── 원인: 컨테이너가 반복적으로 실패
│   ├── 앱 실행 오류 (코드 버그)
│   ├── 잘못된 command/args
│   ├── 필요한 파일/설정 누락
│   └── OOMKilled (메모리 초과)
├── 진단: kubectl logs <name> --previous
└── 해결: 로그 분석, 리소스 limits 조정

[Running but Not Ready]
├── 원인: Readiness Probe 실패
│   ├── 앱이 아직 초기화 중
│   ├── 의존 서비스 연결 실패
│   └── Probe 설정 오류 (경로, 포트)
├── 진단: kubectl describe pod -> Conditions, Events
└── 해결: Probe 파라미터 조정, 의존 서비스 확인
```

### 3.5 체계적 디버깅 절차

```bash
# 1. Pod 상태 확인
kubectl get pods -n <ns> -o wide

# 2. 상세 정보 확인 (Events가 가장 중요!)
kubectl describe pod <pod-name> -n <ns>

# 3. 로그 확인
kubectl logs <pod-name> -n <ns>
kubectl logs <pod-name> -n <ns> --previous  # 이전 컨테이너

# 4. 이벤트 확인 (시간순 정렬)
kubectl get events -n <ns> --sort-by='.lastTimestamp'

# 5. 컨테이너 내부 확인
kubectl exec -it <pod-name> -n <ns> -- /bin/sh

# 6. 리소스 사용량 확인
kubectl top pods -n <ns>
```

---

## 4. 쿠버네티스 내부 동작

### 4.1 Kubelet의 Probe 실행 과정

```
[Kubelet - Probe Manager]
    |
    ├── [컨테이너 시작됨]
    |
    ├── [Startup Probe 실행] (설정된 경우)
    |   ├── kubelet이 컨테이너에 직접 프로브 실행
    |   |   ├── httpGet: kubelet이 HTTP GET 요청
    |   |   ├── tcpSocket: kubelet이 TCP 연결 시도
    |   |   └── exec: kubelet이 컨테이너 내부에서 명령 실행
    |   |
    |   ├── 실패: failureThreshold 초과 시
    |   |   └── kubelet이 컨테이너 재시작
    |   |
    |   └── 성공: Startup Probe 비활성화
    |       └── Liveness/Readiness Probe 시작
    |
    ├── [Liveness Probe 실행]
    |   ├── periodSeconds마다 실행
    |   ├── 실패: failureThreshold 연속 실패
    |   |   └── kubelet이 컨테이너 재시작
    |   └── 성공: 정상 상태 유지
    |
    └── [Readiness Probe 실행]
        ├── periodSeconds마다 실행
        ├── 실패: Endpoints Controller에 Not Ready 보고
        |   └── Endpoints에서 Pod IP 제거
        └── 성공: Endpoints에 Pod IP 등록
```

### 4.2 Service Endpoints와 Readiness Probe의 관계

```
[Readiness Probe 결과]    [Endpoints 변화]           [트래픽 흐름]

Pod Ready                 Endpoints에 추가            Service -> Pod (O)
  └── Probe 성공          10.244.1.5:8080 추가

Pod Not Ready             Endpoints에서 제거           Service -> Pod (X)
  └── Probe 실패          10.244.1.5:8080 제거
```

---

## 5. 복습 체크리스트

- [ ] Liveness, Readiness, Startup Probe의 차이를 설명할 수 있다
- [ ] httpGet, tcpSocket, exec 3가지 체크 방식의 차이를 안다
- [ ] Startup Probe가 왜 필요한지 설명할 수 있다
- [ ] initialDelaySeconds, periodSeconds, failureThreshold를 설정할 수 있다
- [ ] Startup Probe 최대 대기 시간을 계산할 수 있다 (failureThreshold * periodSeconds)
- [ ] Liveness 실패 시 재시작, Readiness 실패 시 Endpoints 제거를 이해한다
- [ ] `kubectl logs -c <container>`, `--previous`, `--tail` 옵션을 사용할 수 있다
- [ ] Sidecar 로깅 패턴의 YAML을 작성할 수 있다
- [ ] `kubectl exec`으로 컨테이너 내부 명령을 실행할 수 있다
- [ ] Pod 상태(Pending, CrashLoopBackOff, ImagePullBackOff)별 원인을 알고 있다

---

## tart-infra 실습

### 실습 환경 설정

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get pods -n demo
```

### 실습 1: 기존 서비스의 Probe 설정 분석

dev 클러스터에서 실행 중인 서비스들의 Probe 설정을 확인한다.

```bash
# nginx Pod의 Probe 설정 확인
kubectl get deploy -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}'

# 각 Deployment의 Probe 확인
kubectl get deploy nginx -n demo -o jsonpath='{.spec.template.spec.containers[0].livenessProbe}' | python3 -m json.tool 2>/dev/null || echo "livenessProbe 미설정"
kubectl get deploy nginx -n demo -o jsonpath='{.spec.template.spec.containers[0].readinessProbe}' | python3 -m json.tool 2>/dev/null || echo "readinessProbe 미설정"
```

**동작 원리:** 프로덕션 워크로드에서 Probe 누락은 장애 시 자동 복구 불가(Liveness) 또는 준비 안 된 Pod에 트래픽 유입(Readiness)을 의미한다. 기존 서비스의 Probe 설정을 분석하여 개선점을 파악하는 것이 중요하다.

### 실습 2: Probe가 포함된 Pod 생성과 동작 확인

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: probe-demo
  namespace: demo
spec:
  containers:
    - name: app
      image: nginx:1.25
      ports:
        - containerPort: 80
      startupProbe:
        httpGet:
          path: /
          port: 80
        failureThreshold: 3
        periodSeconds: 5
      livenessProbe:
        httpGet:
          path: /
          port: 80
        periodSeconds: 10
        failureThreshold: 3
      readinessProbe:
        httpGet:
          path: /
          port: 80
        periodSeconds: 5
        failureThreshold: 2
EOF

# Probe 이벤트 확인
kubectl describe pod probe-demo -n demo | grep -A 5 "Events:"

# Readiness 실패 시뮬레이션 (index.html 삭제)
kubectl exec probe-demo -n demo -- rm /usr/share/nginx/html/index.html

# 상태 변화 관찰
kubectl get pod probe-demo -n demo -w
```

**예상 출력 (Readiness 실패 후):**
```
NAME         READY   STATUS    RESTARTS   AGE
probe-demo   1/1     Running   0          30s
probe-demo   0/1     Running   0          35s
```

**동작 원리:** index.html을 삭제하면 httpGet Probe가 404를 반환하여 Readiness 실패(0/1)가 된다. Readiness 실패 시 Endpoints에서 제거되어 트래픽이 차단되지만, Liveness도 같은 경로이므로 `failureThreshold`(3) 도달 시 컨테이너가 재시작된다. 재시작 후 nginx 기본 이미지에 index.html이 복원되어 다시 Ready 상태가 된다.

### 실습 3: Pod 로그 디버깅 실습

```bash
# 컨테이너 로그 확인
kubectl logs probe-demo -n demo --tail=10

# 이전 컨테이너(재시작 전) 로그 확인
kubectl logs probe-demo -n demo --previous 2>/dev/null || echo "이전 컨테이너 없음"

# Pod 이벤트로 Probe 실패 원인 파악
kubectl describe pod probe-demo -n demo | tail -20
```

**동작 원리:** `--previous` 플래그는 재시작 이전 컨테이너의 로그를 조회한다. CrashLoopBackOff 상태의 Pod를 디버깅할 때 핵심 명령이다. `kubectl describe`의 Events 섹션에서 Probe 실패 메시지와 재시작 기록을 확인할 수 있다.

### 정리

```bash
kubectl delete pod probe-demo -n demo
```
