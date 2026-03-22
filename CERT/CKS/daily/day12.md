# CKS Day 12: Monitoring, Logging & Runtime Security (2/2) - 시험 패턴, 실전 문제, 심화 학습

> 학습 목표 | CKS 도메인: Monitoring, Logging & Runtime Security (20%) | 예상 소요 시간: 2시간

---

## 오늘의 학습 목표

- Monitoring, Logging & Runtime Security 도메인의 CKS 시험 출제 패턴을 분석한다
- Falco 룰, Audit Log 분석, 인시던트 대응 관련 실전 문제 10개를 풀어본다
- tart-infra 환경에서 런타임 보안 실습을 수행한다
- 심화 주제를 학습하여 이해를 깊게 한다

---


## 6. 이 주제가 시험에서 어떻게 나오는가

### 6.1 출제 패턴

```
Monitoring, Logging & Runtime Security 출제 패턴 (20%)
═══════════════════════════════════════════════════════

1. Falco 커스텀 룰 작성 (매우 빈출)
   - "falco_rules.local.yaml에 룰을 추가하라"
   - "셸 실행/파일 읽기/패키지 설치를 탐지하라"
   의도: Falco 룰 문법 (condition, output, priority)

2. Falco 기존 룰 수정 (빈출)
   - "기본 룰의 우선순위를 변경하라"
   - "local.yaml에서 오버라이드하라"
   의도: 룰 오버라이드 방법

3. Audit Log 분석 (빈출)
   - "Audit Log에서 특정 사용자/리소스를 찾아라"
   - "jq를 사용하여 필터링하라"
   의도: jq 명령어와 Audit Log 구조 이해

4. 이상 행위 대응 (가끔 출제)
   - "의심 Pod를 격리하고 증거를 수집하라"
   의도: 보안 사고 대응 절차

5. 컨테이너 불변성 (가끔 출제)
   - "readOnlyRootFilesystem + emptyDir 설정"
   → Day 7-8의 SecurityContext와 겹침
```

### 6.2 실전 문제 (10개 이상)

### 문제 1. Falco 커스텀 룰 - 셸 탐지

`/etc/falco/falco_rules.local.yaml`에 다음 Falco 룰을 추가하라: 컨테이너 내에서 셸(bash, sh, zsh)이 실행되면 WARNING 우선순위로 탐지하라. 룰 이름: `Detect Shell in Container`

<details>
<summary>풀이</summary>

```yaml
- rule: Detect Shell in Container
  desc: 컨테이너에서 셸이 실행되면 탐지
  condition: >
    spawned_process and container and
    proc.name in (bash, sh, zsh)
  output: >
    Shell in container (user=%user.name container=%container.name
    shell=%proc.name parent=%proc.pname cmdline=%proc.cmdline
    image=%container.image.repository pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: WARNING
  tags: [container, shell]
```

```bash
sudo systemctl restart falco
kubectl exec -n demo deploy/nginx -- /bin/sh -c "echo test"
sudo journalctl -u falco --since "1 minute ago" | grep "Shell"
```

</details>

### 문제 2. Falco 룰 - 민감 파일 읽기

컨테이너에서 `/etc/shadow`를 읽으면 CRITICAL 우선순위로 탐지하는 룰을 추가하라.

<details>
<summary>풀이</summary>

```yaml
- rule: Detect Sensitive File Read
  desc: /etc/shadow 읽기 탐지
  condition: >
    open_read and container and
    fd.name = /etc/shadow
  output: >
    Sensitive file read (user=%user.name file=%fd.name
    container=%container.name image=%container.image.repository
    pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: CRITICAL
  tags: [filesystem, sensitive_file]
```

</details>

### 문제 3. Falco 룰 오버라이드

기본 Falco 룰 `Terminal shell in container`의 우선순위를 WARNING에서 ALERT로 변경하라. 기본 룰 파일을 직접 수정하지 않고 `falco_rules.local.yaml`에서 오버라이드하라.

<details>
<summary>풀이</summary>

```yaml
# /etc/falco/falco_rules.local.yaml에 추가
- rule: Terminal shell in container
  desc: A shell was used as the entrypoint/exec point into a container
  condition: >
    spawned_process and container and shell_procs and
    proc.tty != 0 and container_entrypoint
  output: >
    Terminal shell in container
    (user=%user.name %container.info shell=%proc.name
    parent=%proc.pname cmdline=%proc.cmdline
    container_id=%container.id image=%container.image.repository)
  priority: ALERT
  tags: [container, shell, mitre_execution]
```

```bash
sudo systemctl restart falco
```

</details>

### 문제 4. Audit Log 분석 - Secret 삭제

Audit Log에서 지난 1시간 동안 `production` 네임스페이스의 Secret을 삭제한 사용자를 찾아라.

<details>
<summary>풀이</summary>

```bash
cat /var/log/kubernetes/audit/audit.log | \
  jq 'select(
    .objectRef.resource == "secrets" and
    .objectRef.namespace == "production" and
    .verb == "delete"
  ) | {
    user: .user.username,
    secret: .objectRef.name,
    timestamp: .requestReceivedTimestamp,
    sourceIP: .sourceIPs[0]
  }'
```

</details>

### 문제 5. 이상 행위 대응

Falco가 `demo` 네임스페이스의 `suspicious-pod`에서 `/etc/shadow` 읽기와 외부 네트워크 연결을 탐지했다. 증거를 수집하고 Pod를 격리하라.

<details>
<summary>풀이</summary>

```bash
# 1. 증거 수집
kubectl logs suspicious-pod -n demo > /tmp/suspicious-logs.txt
kubectl describe pod suspicious-pod -n demo > /tmp/suspicious-describe.txt
kubectl get pod suspicious-pod -n demo -o yaml > /tmp/suspicious-yaml.txt

# 2. 네트워크 격리
cat <<'EOF' | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: isolate-suspicious
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: suspicious
  policyTypes:
  - Ingress
  - Egress
EOF

# 3. 프로세스 확인
kubectl exec suspicious-pod -n demo -- ps aux 2>/dev/null
kubectl exec suspicious-pod -n demo -- netstat -tlnp 2>/dev/null

# 4. Pod 삭제
kubectl delete pod suspicious-pod -n demo

# 5. Falco 로그 보존
sudo journalctl -u falco --since "1 hour ago" > /tmp/falco-evidence.txt
```

</details>

### 문제 6. Falco 룰 - /etc 디렉토리 수정

컨테이너에서 `/etc` 디렉토리 하위의 파일이 수정되면 ERROR 우선순위로 탐지하는 룰을 추가하라.

<details>
<summary>풀이</summary>

```yaml
- rule: Write to etc Directory in Container
  desc: /etc 파일 수정 탐지
  condition: >
    open_write and container and
    fd.name startswith /etc/
  output: >
    /etc 파일 수정 (user=%user.name file=%fd.name
    container=%container.name image=%container.image.repository
    pod=%k8s.pod.name ns=%k8s.ns.name cmdline=%proc.cmdline)
  priority: ERROR
  tags: [filesystem, container, mitre_persistence]
```

</details>

### 문제 7. Sysdig 분석

sysdig를 사용하여 `nginx` 컨테이너에서 실행된 모든 프로세스를 기록하고, 셸 프로세스가 있는지 확인하라.

<details>
<summary>풀이</summary>

```bash
# 캡처 (10초)
sudo sysdig -w /tmp/nginx-capture.scap container.name=nginx &
sleep 10
kill %1

# 프로세스 실행 이벤트
sudo sysdig -r /tmp/nginx-capture.scap evt.type=execve

# 셸 프로세스 필터링
sudo sysdig -r /tmp/nginx-capture.scap \
  "evt.type=execve and proc.name in (bash,sh,zsh)"

# 파일 접근
sudo sysdig -r /tmp/nginx-capture.scap \
  "evt.type in (open,openat) and fd.name contains /etc/"
```

</details>

### 문제 8. Audit Log 분석 - 403 응답

Audit Log에서 403 Forbidden 응답이 가장 많은 사용자를 찾아라.

<details>
<summary>풀이</summary>

```bash
cat /var/log/kubernetes/audit/audit.log | \
  jq -r 'select(.responseStatus.code == 403) | .user.username' | \
  sort | uniq -c | sort -rn | head -5
# 결과: 가장 많은 403을 받은 사용자 상위 5명
```

</details>

### 문제 9. Falco 룰 - 패키지 매니저 + 바이너리 쓰기

다음 두 가지 룰을 `falco_rules.local.yaml`에 추가하라:
1. 패키지 매니저(apt, pip, npm) 실행 → ERROR
2. /usr/bin에 파일 쓰기 → ERROR

<details>
<summary>풀이</summary>

```yaml
- rule: Package Manager in Container
  desc: 패키지 매니저 실행 (불변성 위반)
  condition: >
    spawned_process and container and
    proc.name in (apt, apt-get, dpkg, yum, pip, pip3, npm, apk)
  output: >
    패키지 매니저 (user=%user.name pkg=%proc.name cmdline=%proc.cmdline
    container=%container.name pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: ERROR
  tags: [container, package_management]

- rule: Write to Bin Directory
  desc: 바이너리 디렉토리에 파일 쓰기
  condition: >
    open_write and container and
    (fd.directory = /usr/bin or fd.directory = /usr/local/bin or
     fd.directory = /bin or fd.directory = /sbin)
  output: >
    바이너리 쓰기 (user=%user.name file=%fd.name
    container=%container.name pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: ERROR
  tags: [filesystem, container]
```

</details>

### 문제 10. Audit Log 분석 - 결과 파일 저장

Audit Log에서 다음 정보를 `/tmp/audit-report.txt`에 저장하라:
1. Secret에 접근한 비시스템 사용자 목록
2. kubectl exec 사용 기록

<details>
<summary>풀이</summary>

```bash
# 1. Secret 접근 비시스템 사용자
echo "=== Secret 접근 비시스템 사용자 ===" > /tmp/audit-report.txt
cat /var/log/kubernetes/audit/audit.log | \
  jq 'select(
    .objectRef.resource == "secrets" and
    (.user.username | startswith("system:") | not)
  ) | {
    user: .user.username,
    verb: .verb,
    secret: .objectRef.name,
    ns: .objectRef.namespace
  }' >> /tmp/audit-report.txt

# 2. kubectl exec 기록
echo "" >> /tmp/audit-report.txt
echo "=== kubectl exec 기록 ===" >> /tmp/audit-report.txt
cat /var/log/kubernetes/audit/audit.log | \
  jq 'select(.objectRef.subresource == "exec") | {
    user: .user.username,
    pod: .objectRef.name,
    ns: .objectRef.namespace,
    time: .requestReceivedTimestamp
  }' >> /tmp/audit-report.txt

cat /tmp/audit-report.txt
```

</details>

---

## 7. 복습 체크리스트

- [ ] Falco의 아키텍처를 설명할 수 있는가?
- [ ] Falco 룰의 구성 요소(rule, desc, condition, output, priority)를 아는가?
- [ ] `spawned_process`, `container`, `open_write`, `open_read` 매크로를 이해하는가?
- [ ] 커스텀 Falco 룰을 `/etc/falco/falco_rules.local.yaml`에 작성할 수 있는가?
- [ ] 기본 룰을 수정하지 않고 local.yaml에서 오버라이드하는 방법을 아는가?
- [ ] Audit Log에서 jq를 사용하여 필터링할 수 있는가?
- [ ] Secret 접근, 403 응답, exec 기록을 분석할 수 있는가?
- [ ] 이상 행위 탐지 후 대응 절차(증거 수집 → 격리 → 삭제)를 수행할 수 있는가?
- [ ] sysdig 기본 사용법(캡처, 필터, 재생)을 아는가?
- [ ] 컨테이너 불변성을 SecurityContext + Falco로 구현할 수 있는가?

---

> **내일 예고:** Day 13에서는 CKS 종합 모의시험(전반부)으로 시험 구조, 전략, 문제 1~12를 풀어본다.

---

## tart-infra 실습

### 실습 환경 설정

```bash
# platform 클러스터에 접속 (모니터링 스택이 설치된 클러스터)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/platform.yaml
kubectl get nodes
```

### 실습 1: 감사 로그 분석 시뮬레이션

```bash
# API Server의 audit 설정 확인
kubectl get pod kube-apiserver-platform-master -n kube-system -o yaml | grep -E "audit" || echo "Audit 설정 확인"

# Secret 접근 이벤트 시뮬레이션 — 이런 접근을 감사 로그에서 추적
kubectl get secrets -A --no-headers | wc -l
echo "위 명령은 모든 네임스페이스의 Secret을 조회했다. Audit 로그가 활성화되어 있다면 이 요청이 기록된다."
```

**동작 원리:** Audit Log 분석 방법:
1. Audit 로그는 JSON Lines 형식으로 저장된다 (`/var/log/kubernetes/audit.log`)
2. `jq` 명령으로 필터링: `jq 'select(.objectRef.resource=="secrets")' audit.log`
3. 주요 필드: `user.username`(누가), `verb`(무엇을), `objectRef`(어떤 리소스에), `responseStatus.code`(결과)
4. Secret 조회, 403 응답, exec 요청 등을 모니터링하여 보안 위협을 탐지한다

### 실습 2: Prometheus Alert Rules 확인

```bash
# platform 클러스터의 PrometheusRule 확인
kubectl get prometheusrules -n monitoring 2>/dev/null || kubectl get prometheusrules -A 2>/dev/null || echo "PrometheusRule CRD 확인"
```

**동작 원리:** Prometheus 기반 보안 모니터링:
1. PrometheusRule이 메트릭 기반 알림 규칙을 정의한다
2. tart-infra에는 8개의 알림 규칙이 설정되어 있다 (`/manifests/alerting/`)
3. AlertManager(platform:30903)가 알림을 수신하고 라우팅한다
4. 예시 알림: Pod CrashLoopBackOff, 높은 CPU 사용률, 디스크 부족 등

### 실습 3: 이상 행위 탐지 시뮬레이션

```bash
# dev 클러스터에서 이상 행위 시뮬레이션
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml

# 1. 컨테이너 내부에서 셸 실행 (런타임 보안 도구가 감지해야 할 행위)
kubectl exec -n demo deploy/nginx-web -- whoami

# 2. 컨테이너 내부에서 패키지 관리자 실행 시도
kubectl exec -n demo deploy/nginx-web -- apt-get update 2>&1 | head -3 || echo "패키지 관리자 실행 시도"

# 3. /etc/shadow 접근 시도
kubectl exec -n demo deploy/nginx-web -- cat /etc/shadow 2>&1 | head -3
```

**동작 원리:** Falco가 탐지하는 이상 행위:
1. `Terminal shell in container`: 컨테이너에서 대화형 셸이 실행됨
2. `Package management process launched`: apt/yum 등 패키지 관리자 실행
3. `Read sensitive file`: /etc/shadow, /etc/passwd 등 민감 파일 접근
4. Falco 규칙이 커널 syscall을 모니터링하여 이상 행위를 실시간 탐지한다

### 실습 4: 대응 절차 연습

```bash
# 의심스러운 Pod 격리 절차
# 1. 증거 수집
kubectl get pod -n demo -l app=nginx-web -o yaml > /tmp/evidence-pod.yaml
kubectl logs -n demo deploy/nginx-web > /tmp/evidence-logs.txt

# 2. 네트워크 격리 (NetworkPolicy로 모든 통신 차단)
cat << EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: isolate-suspicious
  namespace: demo
spec:
  podSelector:
    matchLabels:
      app: suspicious-app   # 실제로는 격리할 Pod의 라벨
  policyTypes:
  - Ingress
  - Egress
EOF

# 3. 정리 (실습용 NetworkPolicy 삭제)
kubectl delete networkpolicy isolate-suspicious -n demo 2>/dev/null
```

**동작 원리:** 인시던트 대응 5단계:
1. **탐지**: Falco/Audit Log에서 이상 행위 감지
2. **증거 수집**: Pod YAML, 로그, 이벤트를 파일로 저장
3. **격리**: NetworkPolicy로 네트워크 차단, Pod를 cordon된 노드로 이동
4. **제거**: 감염된 Pod/Container 삭제
5. **복구**: 정상 이미지로 재배포, 보안 정책 강화

---

## 추가 심화 학습: Falco 규칙 작성과 Audit Log 고급 분석

### Falco 규칙 문법 상세 설명

```yaml
# Falco 규칙 파일 구조 (/etc/falco/falco_rules.local.yaml)

# ── 매크로: 재사용 가능한 조건 블록 ──
- macro: container          # 매크로 이름
  condition: container.id != host   # 컨테이너 내부인지 확인

- macro: spawned_process     # 프로세스가 새로 생성되었는지
  condition: evt.type = execve and evt.dir = <  # execve syscall의 exit 이벤트

- macro: sensitive_files     # 민감한 파일 목록
  condition: >
    fd.name startswith /etc/shadow or
    fd.name startswith /etc/passwd or
    fd.name startswith /etc/pki or
    fd.name startswith /root/.ssh

# ── 리스트: 값의 목록 ──
- list: shell_binaries       # 셸 바이너리 목록
  items: [bash, sh, zsh, ksh, csh, dash, tcsh]

- list: package_managers      # 패키지 관리자 목록
  items: [apt, apt-get, yum, dnf, apk, pip, npm]

# ── 규칙: 실제 탐지 로직 ──
- rule: Terminal shell in container      # 규칙 이름
  desc: 컨테이너 내부에서 셸이 실행됨     # 설명
  condition: >                           # 탐지 조건 (Sysdig 필터 문법)
    spawned_process and                   # 프로세스가 생성되었고
    container and                         # 컨테이너 내부이고
    proc.name in (shell_binaries)         # 실행된 프로세스가 셸인 경우
  output: >                              # 경보 메시지
    셸 실행 감지
    (user=%user.name container=%container.name
     image=%container.image.repository
     shell=%proc.name parent=%proc.pname
     cmdline=%proc.cmdline
     pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: WARNING                       # 심각도: EMERGENCY > ALERT > CRITICAL > ERROR > WARNING > NOTICE > INFO > DEBUG
  tags: [container, shell, mitre_execution]  # 태그 (MITRE ATT&CK 매핑)

- rule: Package management in container   # 패키지 관리자 실행 탐지
  desc: 컨테이너에서 패키지 관리자가 실행됨
  condition: >
    spawned_process and
    container and
    proc.name in (package_managers)
  output: >
    패키지 관리자 실행
    (user=%user.name container=%container.name
     command=%proc.cmdline
     pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: ERROR
  tags: [container, software_mgmt]

- rule: Read sensitive file in container  # 민감 파일 접근 탐지
  desc: 컨테이너에서 민감한 파일이 읽힘
  condition: >
    open_read and                         # 파일 읽기 이벤트
    container and
    sensitive_files
  output: >
    민감 파일 접근
    (user=%user.name file=%fd.name
     container=%container.name
     image=%container.image.repository
     pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: WARNING
  tags: [container, filesystem, mitre_credential_access]
```

**동작 원리:** Falco 규칙 3요소:
1. **Macro**: 재사용 가능한 조건 블록 (함수처럼 사용)
2. **List**: 값의 배열 (셸 목록, 패키지 관리자 목록 등)
3. **Rule**: 조건(condition) + 출력(output) + 우선순위(priority)
4. condition에서 Sysdig 필터 문법을 사용하여 syscall 이벤트를 필터링한다

### Kubernetes Audit Log 설정 상세

```yaml
# Audit Policy 파일
# 위치: /etc/kubernetes/audit/audit-policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # ── Secret 접근은 RequestResponse 레벨로 상세 기록 ──
  - level: RequestResponse        # 요청 + 응답 본문 모두 기록
    resources:
      - group: ""                 # 코어 API 그룹
        resources: ["secrets"]    # Secret 리소스
    verbs: ["get", "list", "watch", "create", "update", "delete"]

  # ── ConfigMap 변경은 Request 레벨로 기록 ──
  - level: Request                # 요청 본문만 기록 (응답 제외)
    resources:
      - group: ""
        resources: ["configmaps"]
    verbs: ["create", "update", "patch", "delete"]

  # ── Pod exec/attach는 반드시 기록 (보안 중요!) ──
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["pods/exec", "pods/attach"]  # 서브리소스!

  # ── 일반 읽기 요청은 Metadata만 기록 (로그 크기 절약) ──
  - level: Metadata               # 메타데이터만 기록 (요청/응답 본문 제외)
    resources:
      - group: ""
        resources: ["pods", "services", "deployments"]
    verbs: ["get", "list", "watch"]

  # ── kube-system 서비스 어카운트의 읽기는 기록 안 함 (노이즈 감소) ──
  - level: None                   # 기록 안 함
    users: ["system:kube-proxy", "system:kube-scheduler"]
    verbs: ["get", "list", "watch"]

  # ── 나머지는 Metadata 레벨 ──
  - level: Metadata
    omitStages:
      - "RequestReceived"         # 요청 수신 단계는 생략
```

**동작 원리:** Audit Log 4단계 레벨:
1. **None**: 기록 안 함 (노이즈 감소용)
2. **Metadata**: 누가, 언제, 무엇을 요청했는지만 기록 (요청/응답 본문 없음)
3. **Request**: 요청 본문 포함 (응답 본문 제외)
4. **RequestResponse**: 요청 + 응답 본문 모두 기록 (가장 상세, 디스크 많이 사용)

### API Server에 Audit Log 활성화

```yaml
# /etc/kubernetes/manifests/kube-apiserver.yaml에 추가할 플래그

# spec.containers[0].command에 추가:
- --audit-policy-file=/etc/kubernetes/audit/audit-policy.yaml    # 정책 파일 경로
- --audit-log-path=/var/log/kubernetes/audit/audit.log           # 로그 파일 경로
- --audit-log-maxage=30          # 로그 보관 일수 (30일)
- --audit-log-maxbackup=10       # 백업 파일 최대 수
- --audit-log-maxsize=100        # 파일 최대 크기 (MB)

# volumes에 추가:
- name: audit-policy
  hostPath:
    path: /etc/kubernetes/audit
    type: DirectoryOrCreate
- name: audit-log
  hostPath:
    path: /var/log/kubernetes/audit
    type: DirectoryOrCreate

# volumeMounts에 추가:
- mountPath: /etc/kubernetes/audit
  name: audit-policy
  readOnly: true
- mountPath: /var/log/kubernetes/audit
  name: audit-log
```

### Audit Log 분석 실습

```bash
# Audit Log에서 Secret 접근 이력 확인
cat /var/log/kubernetes/audit/audit.log | jq 'select(.objectRef.resource == "secrets")' | head -50

# 특정 사용자의 활동 추적
cat /var/log/kubernetes/audit/audit.log | jq 'select(.user.username == "suspicious-user")'

# Pod exec 이력 확인 (보안 감사에서 중요!)
cat /var/log/kubernetes/audit/audit.log | jq 'select(.objectRef.subresource == "exec")'

# 삭제 작업만 필터링
cat /var/log/kubernetes/audit/audit.log | jq 'select(.verb == "delete")'
```

### Sysdig를 활용한 시스템콜 분석

```bash
# Sysdig 기본 명령어 (컨테이너 시스템콜 분석)

# 특정 컨테이너의 모든 syscall 모니터링
sysdig -c container.name=nginx-web

# 네트워크 연결 이벤트만 추출
sysdig -c container.name=nginx-web "evt.type=connect"

# 파일 열기 이벤트만 추출
sysdig -c container.name=nginx-web "evt.type=open"

# 프로세스 실행 이벤트 (exec 계열)
sysdig -c container.name=nginx-web "evt.type=execve"

# Chisel(내장 스크립트) 사용: 컨테이너별 네트워크 바이트
sysdig -c topconns

# Chisel: 가장 많은 CPU를 사용하는 프로세스
sysdig -c topprocs_cpu
```

**동작 원리:** Sysdig vs Falco:
1. **Sysdig**: syscall을 수집하고 분석하는 "도구" (수동 분석)
2. **Falco**: syscall을 실시간 모니터링하여 규칙 기반 "탐지" (자동 경보)
3. Sysdig는 사후 분석(forensics)에 적합, Falco는 실시간 탐지에 적합
4. 둘 다 eBPF 또는 커널 모듈로 syscall을 캡처한다

### 컨테이너 불변성(Immutability) 구현

```yaml
# 불변 컨테이너 Pod 예제
apiVersion: v1
kind: Pod
metadata:
  name: immutable-pod
spec:
  containers:
    - name: app
      image: myapp:1.0
      securityContext:
        readOnlyRootFilesystem: true       # ✅ 루트 파일시스템 읽기 전용
        allowPrivilegeEscalation: false    # ✅ 권한 상승 차단
        runAsNonRoot: true                 # ✅ root 실행 금지
        capabilities:
          drop:
            - ALL                          # ✅ 모든 capability 제거
      volumeMounts:
        - name: tmp
          mountPath: /tmp                  # 임시 파일만 쓰기 허용
        - name: logs
          mountPath: /var/log/app          # 로그만 쓰기 허용
  volumes:
    - name: tmp
      emptyDir:
        sizeLimit: 100Mi                   # 크기 제한
    - name: logs
      emptyDir:
        sizeLimit: 500Mi
```

**동작 원리:** 불변 인프라의 핵심:
1. `readOnlyRootFilesystem: true` → 컨테이너 내부에 악성코드 설치 불가
2. 쓰기가 필요한 경로만 emptyDir로 마운트 (최소 권한 원칙)
3. 컨테이너가 변조되면 → Pod를 삭제하고 깨끗한 이미지로 재생성
4. "수리하지 말고 교체하라" = 불변 인프라의 철학

### 연습 문제: Runtime Security 시나리오

**문제 1:** 아래 Falco 규칙을 완성하시오: 컨테이너에서 `/etc` 디렉터리에 파일이 쓰여질 때 탐지

```yaml
# 정답:
- rule: Write to /etc directory in container
  desc: 컨테이너에서 /etc 디렉터리에 쓰기 감지
  condition: >
    open_write and                    # 파일 쓰기 이벤트
    container and                     # 컨테이너 내부
    fd.name startswith /etc           # /etc 경로
  output: >
    /etc 디렉터리 쓰기 감지
    (user=%user.name file=%fd.name
     container=%container.name
     pod=%k8s.pod.name ns=%k8s.ns.name)
  priority: ERROR
  tags: [container, filesystem]
```

**문제 2:** Audit Policy를 작성하시오: Secret의 생성/삭제는 RequestResponse, Pod의 읽기는 Metadata, 나머지는 None

```yaml
# 정답:
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["secrets"]
    verbs: ["create", "delete"]
  - level: Metadata
    resources:
      - group: ""
        resources: ["pods"]
    verbs: ["get", "list", "watch"]
  - level: None
```

**문제 3:** 의심스러운 Pod를 발견했다. 인시던트 대응 절차를 수행하시오.

```bash
# Step 1: 증거 수집 (삭제 전에 반드시!)
kubectl get pod suspicious-pod -n target-ns -o yaml > /tmp/evidence-pod.yaml
kubectl logs suspicious-pod -n target-ns > /tmp/evidence-logs.txt
kubectl describe pod suspicious-pod -n target-ns > /tmp/evidence-describe.txt

# Step 2: 네트워크 격리
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: isolate-pod
  namespace: target-ns
spec:
  podSelector:
    matchLabels:
      app: suspicious-app
  policyTypes:
  - Ingress
  - Egress
  # ingress/egress 규칙 없음 = 모든 트래픽 차단!
EOF

# Step 3: Pod 삭제 (격리 확인 후)
kubectl delete pod suspicious-pod -n target-ns

# Step 4: 원인 분석
# - Audit Log에서 누가 이 Pod를 생성했는지 확인
# - Falco 로그에서 어떤 이상 행위가 있었는지 확인
# - 이미지를 Trivy로 스캔하여 취약점 확인

# Step 5: 재발 방지
# - NetworkPolicy 강화
# - Pod Security Standards 적용
# - 이미지 스캔 정책 적용
```

### CKS 시험 팁: Runtime Security 빠른 풀이

```
Runtime Security 체크리스트
══════════════════════════

1. Falco 규칙 문제:
   □ condition = 이벤트 타입 + 컨테이너 필터 + 대상 필터
   □ output = 필요한 정보 필드 (%user.name, %container.name, %k8s.pod.name)
   □ priority = 심각도 (ERROR/WARNING/INFO)

2. Audit Log 문제:
   □ audit-policy-file 경로 설정
   □ audit-log-path 설정
   □ API Server 볼륨 마운트
   □ 올바른 level 선택 (None/Metadata/Request/RequestResponse)

3. 인시던트 대응 문제:
   □ 증거 수집 먼저! (삭제 전에 YAML, 로그, describe 저장)
   □ NetworkPolicy로 격리
   □ Pod 삭제
   □ 원인 분석 → 재발 방지

4. 불변 컨테이너 문제:
   □ readOnlyRootFilesystem: true
   □ 쓰기 필요한 경로만 emptyDir 마운트
   □ allowPrivilegeEscalation: false
```
