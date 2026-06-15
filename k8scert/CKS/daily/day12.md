# CKS Day 12: Monitoring, Logging & Runtime Security (2/2) - 시험 패턴, 실전 문제, 심화 학습

> 학습 목표 | CKS 도메인: Monitoring, Logging & Runtime Security (20%) | 예상 소요 시간: 2시간

---

## 오늘의 학습 목표

- Monitoring, Logging & Runtime Security 도메인의 CKS 시험 출제 패턴을 분석한다
- Falco 룰, Audit Log 분석, 인시던트 대응 관련 실전 문제 10개를 풀어본다
- tart-infra 환경에서 런타임 보안 실습을 수행한다
- 심화 주제를 학습하여 이해를 깊게 한다

**이 파일의 섹션 목차 (Day 12 범위):**
- [6. 이 주제가 시험에서 어떻게 나오는가](#6-이-주제가-시험에서-어떻게-나오는가)
  - [6.1 출제 패턴](#61-출제-패턴)
  - [6.2 실전 문제 (10개)](#62-실전-문제-10개-이상): 문제 1~10
- [트러블슈팅](#트러블슈팅-런타임-보안-실전-장애-시나리오): 시나리오 1~3
- [7. 복습 체크리스트](#7-복습-체크리스트)
- [tart-infra 실습](#tart-infra-실습): 실습 1~4
- [추가 심화 학습](#추가-심화-학습-falco-규칙-작성과-audit-log-고급-분석): Falco 룰 문법 · Audit Log 설정 · Sysdig · 컨테이너 불변성

> 섹션 1~5(Falco 아키텍처·룰 문법·Audit Log 기초·jq 분석·실측 검증)는 [day11.md](day11.md)에 있다. 이 파일만 처음 펼치는 경우 Day 11을 먼저 완료한 뒤 돌아온다.

**선수지식(Day 11 전제):** 본 문서는 Day 11에서 Falco의 기본 아키텍처(eBPF 또는 커널 모듈로 syscall 감시 → 규칙 매칭 → 알림 발송), Audit Log의 정책(Policy)/필터링, jq를 이용한 기본 분석을 배웠다고 가정한다. (eBPF = 커널을 다시 컴파일하지 않고 안전하게 커널 안에서 작은 프로그램을 실행하는 기술. Falco는 이것으로 syscall을 가로채 수집한다.) 위 내용이 기억나지 않으면 [day11.md](day11.md) 또는 [../01-concepts.md](../01-concepts.md)의 Falco 절을 먼저 본다.

**실습 전제(어느 클러스터에서 하는가) — 두 경로를 반드시 구분한다:**

> - **① 관찰만 (platform, 읽기 전용):** platform 노드에는 Falco·Audit Log가 이미 설정되어 있어 실제 탐지/로그를 *관찰*할 수 있다(§3 표, 읽기 위주). platform에서는 `journalctl -u falco`·`audit.log` 조회 같은 **읽기 명령만** 수행한다. 룰을 바꾸거나 서비스를 재시작하지 않는다.
> - **② 파괴·재현 (dev 또는 staging에서만):** 룰 추가/수정, `sudo systemctl restart falco`, Pod 격리/삭제, 탐지 트리거용 행위 재현 등 **상태를 바꾸는 실습은 반드시 dev/staging에서만** 한다. platform/prod에서는 절대 하지 않는다(§3·§8). dev/staging은 기본 상태에서 Falco가 없을 수 있으므로, 먼저 [../04-tart-infra-practice.md](../04-tart-infra-practice.md)의 런타임 보안 실습 절차로 **Falco를 설치한 뒤** 재현한다.

따라서 아래 문제의 `sudo systemctl restart falco`·`journalctl -u falco`·`audit.log` 조회는 **Falco/Audit Log가 갖춰진 노드(platform 관찰용 또는 Falco를 설치한 dev/staging)에서만** 실제 출력이 나온다. 각 문제는 "platform에서 관찰"인지 "dev/staging에서 재현"인지를 먼저 판단하고 시작한다. kubeconfig는 저장소 루트 기준 `kubeconfig/<클러스터>.yaml`, 노드 SSH는 `ssh dev-master`처럼 VM 이름 별칭을 쓴다.

### 등장 배경: 런타임 모니터링의 공격-방어 매핑

**직전 기술의 한계 — auditd와 K8s 컨텍스트 부재:** Falco가 등장하기 전 리눅스 노드 감사에는 커널 내장 도구 `auditd`(Linux Audit Daemon)를 썼다. auditd는 syscall 수준 이벤트(파일 열기·exec 등)를 커널에서 직접 포착하여 `/var/log/audit/audit.log`에 기록한다. 그러나 auditd에는 두 가지 결정적 한계가 있다. 첫째, 컨테이너 컨텍스트를 모른다. auditd가 기록하는 이벤트에는 프로세스 ID와 파일 경로만 있을 뿐, "어느 컨테이너의 어느 Pod가 어느 K8s 네임스페이스에서 실행된 것인가"가 없다. 컨테이너 수백 개가 같은 노드에서 실행될 때 특정 컨테이너의 이상 행위를 가려내려면 컨테이너 ID를 일일이 매핑해야 한다. 둘째, 실시간 탐지 규칙 엔진이 없다. auditd는 로그를 쌓을 뿐이고, "셸이 뜨면 즉시 알림"을 보내려면 별도 스크립트·SIEM 연동이 필요하다. **Falco는 이 두 가지를 해결하기 위해 Sysdig에서 2016년 오픈소스로 공개했다.** eBPF 또는 커널 모듈로 syscall을 가로채면서 동시에 컨테이너 런타임(containerd/CRI-O)에서 컨테이너 메타데이터를 조회해 `%container.name`, `%k8s.pod.name`, `%k8s.ns.name`을 이벤트에 붙인다. 여기에 YAML 형식의 규칙 엔진을 내장해 "특정 조건 충족 시 즉시 알림"을 노드에서 바로 처리한다.

Audit Log(K8s API Server 감사 로그)도 마찬가지로 직전 기술의 공백을 채운다. Falco가 없던 시절 "누가 kubectl로 Secret을 삭제했는가"를 추적하려면 API Server 앞에 프록시를 두거나 etcd를 직접 파헤쳐야 했다. K8s 1.7(2017)부터 API Server에 감사 로그 기능이 내장되어, 모든 API 요청을 `--audit-log-path`에 JSON Lines로 기록한다. 이 덕분에 "누가(user.username), 언제(requestReceivedTimestamp), 어떤 리소스에(objectRef), 무엇을(verb), 어떤 결과로(responseStatus.code)" 했는지를 etcd 없이 조회할 수 있다.

**트레이드오프:** 두 도구는 공짜가 아니다. Falco는 eBPF 프로그램이 모든 syscall 진입점에 붙으므로 syscall당 수 마이크로초의 CPU 오버헤드가 생기고, 커널 모듈 방식은 커널 업그레이드마다 모듈 재컴파일이 필요하다. 기본 룰 세트에서 오탐(false positive)이 발생하면 운영자가 직접 `falco_rules.local.yaml`에서 예외를 추가해야 한다. Audit Log는 RequestResponse 레벨로 설정하면 요청·응답 본문(Secret 값 포함)까지 파일에 기록되어 디스크가 급증하고, 민감 데이터가 평문으로 로그에 남는 위험이 있다. 적절한 Policy 레벨(None/Metadata/Request/RequestResponse)을 리소스별로 선택하는 것이 핵심 운영 과제다.

Day 11에서 배운 두 탐지 수단의 역할 분담을 먼저 상기한다. **Falco**는 노드 커널에서 일어나는 시스템콜(syscall)을 실시간으로 감시하여 "컨테이너 안에서 셸이 떴다", "민감 파일을 읽었다" 같은 **런타임 행위**를 즉시 알린다. 반면 **Audit Log(감사 로그)**는 kube-apiserver가 받은 API 요청/응답을 기록하여 "누가 어떤 리소스를 list/get/delete 했는가"를 **사후에 추적**한다. 즉 Falco는 노드 안에서 벌어지는 일(syscall 레벨), Audit Log는 클러스터 API를 통해 들어온 요청(제어 평면 레벨)을 본다. 둘은 감지하는 범위가 겹치지 않으므로 어느 하나만으로는 공격 체인 전체를 볼 수 없다. 이번 Day 12는 둘을 실전에서 함께 사용하여, 셸 획득(Falco)부터 토큰을 이용한 API 호출(Audit Log)까지 공격의 전 단계를 추적하는 전략을 다룬다.

```
런타임 보안이 필요한 실제 공격 시나리오
═══════════════════════════════════════

[공격 체인 예시: 웹 앱 → SA 토큰 탈취 → 클러스터 장악]
1. 공격자가 웹 앱의 SSRF 취약점으로 컨테이너 내부 셸을 획득한다
   → Falco 탐지: "Shell Spawned in Container" (WARNING)
2. /var/run/secrets/kubernetes.io/serviceaccount/token을 읽는다
   → Falco 탐지: "Access Service Account Token" (WARNING)
3. 탈취한 토큰으로 kubectl get secrets -A를 실행한다
   → Audit Log: verb=list, resource=secrets, user=system:serviceaccount:xxx
4. DB 접속 Secret을 획득하여 데이터를 외부로 유출한다
   → Falco 탐지: "Unexpected Outbound Connection" (WARNING)
   → Audit Log: verb=get, resource=secrets, 403이 아닌 200 응답

각 단계에서 Falco와 Audit Log가 탐지하며, 인시던트 대응 절차를 통해
격리 → 증거 수집 → 제거 → 복구를 수행한다.

내부 동작 원리 — Audit Log의 Webhook Backend:
  Audit Log는 두 가지 백엔드로 전송 가능하다:
  1. Log Backend: 파일에 JSON Lines 형식으로 기록한다
     (--audit-log-path, --audit-log-maxage, --audit-log-maxbackup)
  2. Webhook Backend: 외부 시스템(SIEM, Falco 등)에 실시간 전송한다
     (--audit-webhook-config-file)
  두 백엔드를 동시에 사용할 수 있으며, 실시간 탐지(Webhook) +
  사후 분석(Log File)을 병행하는 것이 모범 사례이다.
```

---


## 6. 이 주제가 시험에서 어떻게 나오는가

> **섹션 번호 안내:** Day 12는 Day 11의 후속이다. 섹션 1~5(Falco 아키텍처·룰 문법·Audit Log 기초·jq 분석·실측 검증)는 [day11.md](day11.md)에 있다. 이 파일은 섹션 6(시험 출제 패턴)부터 시작하며, day11.md를 읽지 않았다면 먼저 그 파일을 완료한 뒤 돌아온다.

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

#### 문제 풀기 전: Falco 룰의 3요소 (macro / list / rule)

아래 문제들은 Falco 룰을 직접 작성하므로, 먼저 Falco 룰이 어떤 부품으로 이루어지는지 실제 클러스터에서 확인한다. Falco 룰 파일은 세 종류의 항목으로 구성된다.

- **macro(매크로)**: 재사용 가능한 조건 블록이다. 함수처럼 이름을 붙여 여러 룰에서 호출한다. 예: `container`(컨테이너 내부인지), `spawned_process`(프로세스가 새로 생성되었는지).
- **list(리스트)**: 값의 목록이다. 예: `shell_binaries = [bash, sh, zsh, ...]`. 조건식에서 `proc.name in (shell_binaries)`처럼 쓴다.
- **rule(룰)**: 실제 탐지 로직이다. `condition`(언제) + `output`(무엇을 출력) + `priority`(심각도)로 구성된다.

가장 중요한 연결고리는 `spawned_process` 매크로가 커널의 어떤 동작을 감시하는가이다. `spawned_process`는 `evt.type = execve and evt.dir = <`로 정의되며, 이는 **`execve` 시스템콜의 종료(exit) 이벤트**를 뜻한다. `execve`는 리눅스에서 새 프로그램을 실행할 때 호출되는 시스템콜이므로(시스템콜 = 사용자 프로세스가 커널에 작업을 요청하는 진입점), Falco는 컨테이너 안에서 어떤 프로세스가 새로 실행될 때마다 이 매크로로 감지한다. 마찬가지로 `open_read`/`open_write` 매크로는 `open`/`openat` 시스템콜을 감시해 파일 읽기·쓰기를 탐지한다. 즉 Falco 룰의 `condition`은 결국 "어떤 syscall이 일어났는가"를 사람이 읽기 쉬운 매크로 이름으로 표현한 것이다.

기본 매크로 정의는 클러스터에 설치된 Falco의 룰 파일에서 직접 확인할 수 있다. (전제: Falco가 설치된 노드에서 실행. 본 저장소에서는 platform 클러스터 노드에 설치되어 있고, dev/staging은 아래 "실습 전제" 참조)

```bash
# Falco 기본 룰 파일에서 container / spawned_process 매크로 정의 확인
sudo grep -A5 'macro: container' /etc/falco/falco_rules.yaml
sudo grep -A5 'macro: spawned_process' /etc/falco/falco_rules.yaml
```

위 명령으로 `container` 매크로가 `container.id != host`(컨테이너 ID가 호스트가 아님)로, `spawned_process`가 `execve` 종료 이벤트로 정의된 것을 직접 확인한 뒤 아래 문제들을 풀면, 룰의 `condition`에 등장하는 매크로가 결국 어떤 syscall을 가리키는지 이해한 상태에서 작성할 수 있다.

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

검증 기대 출력 (예시-환경/도구따라다름, dev/staging에 Falco 미설치):
![Falco 런타임 경보 — 컨테이너에서 /etc/shadow 읽기 탐지(dev 실측, modern eBPF)](images/cks-falco-alert.png)

```bash
# Falco 서비스 상태 확인
sudo systemctl status falco | head -5
```

기대 출력 (예시-환경/도구따라다름, dev/staging에 Falco 미설치):
![Falco 런타임 경보 — 컨테이너에서 /etc/shadow 읽기 탐지(dev 실측, modern eBPF)](images/cks-falco-alert.png)

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

```bash
# 검증: Falco 재시작 후 /etc/shadow 읽기를 트리거한다
sudo systemctl restart falco
# demo 네임스페이스가 없으면: kubectl create namespace demo
kubectl exec -n demo deploy/nginx -- cat /etc/shadow 2>&1 || true
# Falco 로그에서 Sensitive file read 탐지 확인
sudo journalctl -u falco --since "1 minute ago" | grep "Sensitive file"
# 기대 출력: Sensitive file read (user=root file=/etc/shadow container=nginx ...)
# Falco 미설치 노드(dev/staging 기본)에서는 (미캡처)
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

`container_entrypoint`는 Falco 기본 룰 파일에 정의된 매크로로, 컨테이너 PID 1의 직계 자식 프로세스인지 확인한다. 구체적으로는 `proc.pname`이 runc 또는 containerd-shim 같은 컨테이너 런타임인 경우에 참이 된다. 즉 컨테이너 시작 직후 entrypoint 과정에서 생성된 프로세스에만 조건이 걸리고, 이미 실행 중인 컨테이너 내에서 추가로 실행된 자식 프로세스에는 걸리지 않는다. 이 조건이 있어야 셸이 Deployment나 Job의 정상 시작 스크립트가 아니라 외부에서 `kubectl exec`로 주입된 대화형 셸임을 구분할 수 있다.

```bash
sudo systemctl restart falco
# 검증: 대화형 셸을 트리거하면 ALERT 레벨로 기록되어야 한다
kubectl exec -it -n demo deploy/nginx -- /bin/bash -c "exit" 2>&1 || true
sudo journalctl -u falco --since "1 minute ago" | grep -E "Terminal shell|ALERT"
# 기대 출력: 우선순위가 WARNING 대신 ALERT로 출력된다
# rules_file 순서가 local.yaml이 falco_rules.yaml보다 뒤에 있어야 오버라이드가 동작한다
# Falco 미설치 노드에서는 (미캡처)
```

</details>

### 문제 4. Audit Log 분석 - Secret 삭제

Audit Log에서 지난 1시간 동안 `production` 네임스페이스의 Secret을 삭제한 사용자를 찾아라.

<details>
<summary>풀이</summary>

**시간 범위 필터 주의:** jq는 ISO 8601 타임스탬프(예: `"2024-01-15T13:05:00.000Z"`)를 날짜/시간 타입으로 직접 비교하는 기능이 없다. 따라서 "지난 1시간"을 jq에서 정확히 계산하려면 `now - 3600`과 `requestReceivedTimestamp`를 `fromdate`로 변환해 비교해야 하는데, 이는 시험 환경에서 오류가 생기기 쉽다. 실용적인 대안은 두 가지다: ① 로그 로테이션 정책(`--audit-log-maxage`)을 활용해 최근 파일만 대상으로 삼는다, ② `grep`으로 ISO 8601 날짜 프리픽스(`2024-01-15T1[23]`)를 사전에 필터링한 뒤 jq로 처리한다. 시험에서는 보통 "파일 전체"를 대상으로 삼으므로 아래 jq처럼 시간 비교 없이 리소스/verb/네임스페이스 조건만 적용하는 것이 현실적이다.

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
# jq는 시간 범위를 직접 지원하지 않으므로 최근 로그 파일을 대상으로 동작한다
# 시간 필터가 필요하면: grep "^{.*2024-01-15T1[23]" audit.log | jq 'select(...)'
```

```bash
# 검증: 실제 삭제 이벤트가 있는지 확인(출력 없으면 해당 삭제 이력 없음)
# Audit Log가 활성화된 노드(platform 클러스터 control-plane)에서만 동작
ssh platform-master "cat /var/log/kubernetes/audit/audit.log 2>/dev/null | \
  jq -r 'select(.objectRef.resource==\"secrets\" and .verb==\"delete\") | .user.username' \
  | sort | uniq" 2>/dev/null || echo "(Audit Log 미설정 환경)"
# 기대 출력: 삭제한 사용자명 목록, 없으면 빈 줄
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
# 참고: 위 NetworkPolicy는 Pod의 네트워크 인터페이스(eth0)만 차단하고,
#       kubectl exec(kubelet → 컨테이너 런타임 직접 호출)는 막지 않으므로
#       격리 후에도 exec는 정상 동작한다(트러블슈팅 시나리오 3 참조).
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

```bash
# 검증: Falco 재시작 후 /etc 쓰기를 트리거한다
sudo systemctl restart falco
# readOnlyRootFilesystem이 없는 컨테이너에서 /etc 파일 쓰기 시도
kubectl exec -n demo deploy/nginx -- sh -c "echo test >> /etc/testfile 2>&1; rm -f /etc/testfile" || true
sudo journalctl -u falco --since "1 minute ago" | grep -E "Write to etc|/etc 파일"
# 기대 출력: /etc 파일 수정 (user=root file=/etc/testfile container=nginx ...)
# Falco 미설치 노드에서는 (미캡처)
```

</details>

### 문제 7. Sysdig 분석

**사전 조건 — sysdig 설치 여부 확인:** sysdig는 Falco와 달리 기본 설치되지 않는 별도 패키지다. CKS 시험 노드에는 이미 설치된 상태로 제공되므로 시험 중에는 바로 쓸 수 있다. 로컬 실습 환경에서 미설치 시 `sudo apt-get install -y sysdig`(Debian/Ubuntu) 또는 [공식 설치 스크립트](https://github.com/draios/sysdig)로 설치하거나, 설치가 어렵다면 이 문제는 건너뛰고 문제 8로 진행한다. 설치 여부는 `which sysdig`로 확인한다.

sysdig를 사용하여 `nginx` 컨테이너에서 실행된 모든 프로세스를 기록하고, 셸 프로세스가 있는지 확인하라.

<details>
<summary>풀이</summary>

```bash
# 캡처 (10초) — 필터는 따옴표로 묶어야 한다(문서 하단 "문법 주의" 참조)
sudo sysdig -w /tmp/nginx-capture.scap 'container.name=nginx' &
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

```bash
# 검증: Audit Log 파일이 존재하는지 먼저 확인한다
ssh platform-master "ls -lh /var/log/kubernetes/audit/audit.log 2>/dev/null || echo '(Audit Log 없음)'"
# Audit Log가 있으면 403 카운트를 직접 실행한다
ssh platform-master "cat /var/log/kubernetes/audit/audit.log 2>/dev/null | \
  jq -r 'select(.responseStatus.code == 403) | .user.username' 2>/dev/null | \
  sort | uniq -c | sort -rn | head -5" || echo "(Audit Log 미설정 — 빈 결과 정상)"
# 기대 출력: '  N system:anonymous' 같은 형태로 사용자별 403 카운트
```

</details>

### 문제 9. Falco 룰 - 패키지 매니저 + 바이너리 쓰기

Day 8([day08.md](day08.md) 컨테이너 보안 컨텍스트 절)에서 다룬 **불변 인프라(immutable infrastructure)** 원칙을 상기한다. 프로덕션 컨테이너는 한 번 배포된 뒤 내부가 바뀌어서는 안 되며, 변경이 필요하면 컨테이너를 직접 수정하는 대신 새 이미지로 다시 빌드해 재배포한다. 따라서 실행 중인 컨테이너 안에서 `apt`/`pip`/`npm`으로 패키지를 설치하거나 `/usr/bin` 같은 바이너리 디렉터리에 파일을 덮어쓰는 행위는 **불변성 위반**이며, 보통 정상 운영이 아니라 공격자가 도구를 내려받거나 백도어를 심는 단계에서 나타난다. 이는 컨테이너에 `readOnlyRootFilesystem: true`를 설정해 애초에 차단하는 것이 바람직하지만(이 절 뒤 "컨테이너 불변성 구현" 참조), 모든 컨테이너가 그렇게 설정되어 있지는 않으므로 Falco로 "변경 행위 자체"를 런타임에 탐지하여 알림을 띄운다. 아래 두 룰이 그 탐지에 해당한다.

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

```bash
# 검증: Falco 재시작 후 두 룰을 각각 트리거한다
sudo systemctl restart falco

# 패키지 매니저 트리거
kubectl exec -n demo deploy/nginx -- apt-get --version 2>&1 || true
sudo journalctl -u falco --since "1 minute ago" | grep -E "패키지 매니저|Package Manager"
# 기대 출력: 패키지 매니저 (user=root pkg=apt-get ...)

# 바이너리 쓰기 트리거 (readOnlyRootFilesystem 없는 컨테이너에서)
kubectl exec -n demo deploy/nginx -- sh -c "touch /usr/bin/testbin 2>&1; rm -f /usr/bin/testbin" || true
sudo journalctl -u falco --since "1 minute ago" | grep -E "바이너리 쓰기|Write to Bin"
# 기대 출력: 바이너리 쓰기 (user=root file=/usr/bin/testbin ...)
# Falco 미설치 노드에서는 (미캡처)
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

```bash
# 검증: 파일이 생성되고 두 섹션 모두 포함되는지 확인한다
ls -lh /tmp/audit-report.txt
grep -c "Secret 접근" /tmp/audit-report.txt && grep -c "exec 기록" /tmp/audit-report.txt
# 기대 출력: 각 1 (두 섹션 헤더가 존재함)
# Audit Log가 없는 환경에서는 섹션 헤더만 있고 내용은 비어 있다 — 정상
```

</details>

---

## 트러블슈팅: 런타임 보안 실전 장애 시나리오

### 시나리오 1: Falco 룰 오버라이드가 적용되지 않는다

```
증상: falco_rules.local.yaml에 기존 룰과 같은 이름의 룰을 작성했으나 기본 룰이 계속 적용된다.
원인: Falco 설정(falco.yaml)에서 rules_file 목록에 local.yaml이 포함되지 않았다.
```

```bash
# 진단: Falco 설정에서 rules_file 확인
grep -A5 "rules_file" /etc/falco/falco.yaml
```

> **예시(참조) — Falco rules_file 설정:** `/etc/falco/falco.yaml` 의 `rules_file` 목록에 규칙 파일 경로를 지정한다(설정 파일 내용).

local.yaml이 목록에 없으면 추가해야 한다. 순서가 중요하다 — Falco는 `rules_file` 목록을 위에서 아래로 순서대로 로드하며, **같은 이름의 rule/macro가 나중에 정의되면 이전 정의를 덮어쓴다(override/merge).** 따라서 `falco_rules.local.yaml`은 반드시 `falco_rules.yaml`보다 **뒤에** 위치해야 기본 룰을 수정할 수 있다. 한 가지 주의점이 있다: local.yaml에서 기본 룰을 오버라이드할 때는 `desc`/`condition`/`output` 등 **룰 본문 전체를 다시 작성해야** 한다. priority 한 줄만 바꿔 적으면 부분 수정이 적용되는 것이 아니라 나머지 필드가 비어버릴 수 있으므로(문제 3의 풀이처럼) 기존 룰 정의를 통째로 복사해 원하는 필드만 바꾸는 방식으로 작성한다.

### 시나리오 2: Audit Log jq 필터링에서 빈 결과가 나온다

```
증상: jq 'select(.objectRef.resource == "secrets")' 실행 시 결과가 없다.
원인 1: Audit Policy에서 해당 리소스가 None 레벨로 설정되어 기록되지 않았다.
원인 2: JSON Lines 형식이 아닌 JSON Array 형식이다.
```

```bash
# 진단: Audit Log 형식 확인
head -1 /var/log/kubernetes/audit/audit.log | jq type 2>&1
```

기대 출력 (예시-환경/도구따라다름, dev/staging에 Audit Log 미설정):
> **예시(참조):** jq/jsonpath 로 추출한 필드 값(예: type="object"). 환경 리소스에 따라 다르다.

`"object"`가 나오면 JSON Lines 형식이므로 jq로 각 줄을 개별 처리한다. `"array"`가 나오면 `jq '.[] | select(...)'`으로 처리해야 한다.

```bash
# 진단: Audit Policy에서 secrets 기록 레벨 확인
cat /etc/kubernetes/audit-policy.yaml | grep -A3 secrets
```

기대 출력 (예시-환경/도구따라다름, dev/staging에 Audit Policy 미적용):
> **예시(참조) — Audit Policy:** audit-policy.yaml 의 rules(level: RequestResponse/Metadata/None, resources/verbs)를 정의한다(설정 파일 내용). 적용은 apiserver 플래그로 — CKS day04·본문 참고.

### 시나리오 3: NetworkPolicy 격리 후 Pod에 kubectl exec가 불가하다

```
증상: Pod를 NetworkPolicy로 격리한 후 kubectl exec가 타임아웃된다.
원인: NetworkPolicy는 Pod의 네트워크 인터페이스(eth0 등)를 통과하는 트래픽,
      즉 Pod↔Pod / Pod↔외부 통신만 제어한다.
      kubectl exec는 이 경로를 쓰지 않는다 — kubelet이 컨테이너 런타임
      (예: containerd)의 exec 엔드포인트를 노드 로컬에서 직접 호출(gRPC,
      localhost)하므로 Pod의 eth0을 통과하지 않는다. 따라서 NetworkPolicy로
      모든 Ingress/Egress를 막아도 kubectl exec는 그대로 동작한다.
      즉 exec 타임아웃의 원인은 NetworkPolicy가 아니다.
해결: 격리는 NetworkPolicy로 정상 적용된 것이며(네트워크 통신만 차단),
      kubectl exec가 타임아웃된다면 다른 원인을 본다 —
      kubelet ↔ Pod 연결성(노드 네트워크 문제) 또는 컨테이너 런타임
      (containerd) 상태를 점검한다. 격리 목적으로는 exec가 살아있는 것이
      오히려 정상이며, 증거 수집을 위해 exec를 사용할 수 있다.
```

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
export KUBECONFIG=~/sideproejct/IaC_apple_sillicon/kubeconfig/platform.yaml
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
1. Audit 로그는 JSON Lines 형식으로 저장된다 (`/var/log/kubernetes/audit.log`). JSON Lines(JSONL)는 **한 줄에 완전한 JSON 객체 하나**를 담는 형식으로, 일반 JSON 배열(`[{...}, {...}]`)과 달리 파일이 커져도 한 줄씩 스트리밍으로 읽어 처리할 수 있다. `jq`는 입력을 줄 단위로 자동 해석하므로 `cat audit.log | jq 'select(...)'`처럼 별도 `.[]` 없이 각 줄을 그대로 필터링한다.
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
export KUBECONFIG=~/sideproejct/IaC_apple_sillicon/kubeconfig/dev.yaml

# 사전 준비: demo 네임스페이스와 nginx-web Deployment가 없으면 먼저 생성한다
kubectl get namespace demo 2>/dev/null || kubectl create namespace demo
kubectl get deploy -n demo nginx-web 2>/dev/null || \
  kubectl create deployment nginx-web --image=nginx:1.25 -n demo
kubectl rollout status deployment/nginx-web -n demo --timeout=60s

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

아래는 기본 문제 1~10보다 훨씬 상세한 참고 자료다. 시험에 모두 필요한 것은 아니므로, 먼저 "지금 외워야 할 것"과 "알면 좋은 것"을 구분한다.

| 내용 | 시험 범위 | 비고 |
| :--- | :--- | :--- |
| rule의 `desc`/`condition`/`output`/`priority` 작성 | 필수 | 기본 문제 1~9의 핵심 |
| 기본 매크로(`spawned_process`/`container`/`open_read`/`open_write`) 사용 | 필수 | condition에서 그대로 호출 |
| `macro`/`list` 직접 재정의 | 선택 | 심화. 대부분 기본 매크로/리스트를 그대로 쓴다 |
| 복잡한 조건식(`and`/`or`/`startswith`/`in`) | 필수 | 룰 필터링 방식 |
| local.yaml 오버라이드 순서·머지 규칙 | 필수 | 문제 3, 트러블슈팅 시나리오 1 |
| Audit Policy `level`(None/Metadata/Request/RequestResponse) 선택 | 필수 | API 서버 감사 설정 |
| Audit Policy의 세밀한 `omitStages`·사용자별 예외 | 선택 | 알면 좋음 |
| sysdig 캡처/필터/chisel 상세 | 선택 | 사후 분석 도구, 출제 빈도 낮음 |

표의 "필수" 항목을 먼저 손에 익히고, "선택" 항목은 시간이 남을 때 읽는다. 아래 절들 중 "Falco 규칙 문법 상세"·"Sysdig 분석"은 대부분 선택 범위의 참고 자료이며, "Audit Log 설정 상세"는 필수 범위를 더 깊이 설명한 것이다.

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

> **참고:** 위 yaml 블록 안의 `Package management in container` 룰 예시는 문법 구조 설명용 참고 코드다. 실제 검증된 전체 룰(패키지 매니저 + 바이너리 디렉터리 쓰기 조합)은 [문제 9 풀이](#문제-9-falco-룰---패키지-매니저--바이너리-쓰기)를 본다.

위 `list: shell_binaries`의 각 항목(`bash`, `sh`, `zsh`, `ksh`, `csh`, `dash`, `tcsh`)은 컨테이너에서 대화형 셸로 쓰이는 셸 프로그램의 종류다. 조건식에 쓰인 `proc.name`은 `execve`로 실행된 프로세스의 **짧은 이름(basename, 경로 제외)**을 가리킨다. 즉 `/bin/bash`를 실행하면 `proc.name`은 전체 경로가 아니라 `bash`가 된다. 그래서 `proc.name in (shell_binaries)`는 "방금 실행된 프로그램의 basename이 셸 목록 중 하나인가"를 검사하는 조건이 된다.

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

`/etc/kubernetes/manifests/kube-apiserver.yaml`은 **정적 파드(static Pod) 매니페스트**다. static Pod는 kubelet이 직접 관리하는 파드로, API Server에 오브젝트를 등록하지 않고 kubelet이 이 파일을 감시하다가 변경을 감지하면 자동으로 kube-apiserver를 재기동한다(보통 30~60초 소요). 따라서 `systemctl restart kube-apiserver` 같은 명령은 존재하지 않으며, **파일을 수정·저장하는 것만으로 적용이 완료**된다. 수정 후 `kubectl get pods -n kube-system -w`로 apiserver Pod가 재기동되는 것을 확인한다.

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

> **⚠ 아래 블록은 현장에서 자주 보이는 잘못된 사용 예시다(사용 금지). `-c` 옵션의 의미를 오해하면 이렇게 작성하기 쉽다. 올바른 형태는 블록 다음 설명을 본다.**

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

> **문법 주의 — 위 sysdig 예시의 `-c`는 정확하지 않다.** sysdig의 `-c` 옵션은 **chisel(내장 분석 스크립트)** 을 실행하는 옵션이지 필터를 거는 옵션이 아니다. 필터(예: `container.name=nginx-web`)는 `-c` 없이 CLI 인자로 직접 전달해야 한다. 올바른 형태는 다음과 같다.
>
> ```bash
> # 올바름 1: 필터만 전달 (따옴표로 묶음)
> sudo sysdig 'container.name=nginx-web'
>
> # 올바름 2: 필터 + 이벤트 타입
> sudo sysdig 'container.name=nginx-web and evt.type=execve'
>
> # 올바름 3: chisel 실행은 -c (이때 뒤에 chisel 이름이 온다)
> sudo sysdig -c topconns          # 컨테이너별 네트워크 연결 상위
> sudo sysdig -c topprocs_cpu      # CPU 사용 상위 프로세스
>
> # 올바름 4: 필터 + 출력 포맷(-p/-o)
> sudo sysdig 'container.name=nginx-web and evt.type=execve' -p '%evt.type %proc.name %proc.args'
> ```
>
> 정리하면 `sysdig -c <필터>`는 필터를 chisel 이름으로 오인해 동작하지 않는다. **필터는 인자로, chisel만 `-c`로** 전달한다.

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
