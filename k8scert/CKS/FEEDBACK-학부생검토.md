# CKS 교재 — 학부 3~4학년 관점 검토 피드백

> 생성: 2026-06-12 · 파일당 1 에이전트 병렬 검토 · 기준 CLAUDE §4④

- 단독합격 **5/19** · 평균 가독성 **3.3/5** · 평균 스토리라인 **2.8/5**
- 부족분 총 **227** (HIGH 89/MED 101/LOW 37) · HIGH 카테고리: 용어비약 29, 실습재현불가 17, 스토리라인누락 17, 맥락점프 12, 정확성오류 9, 이해난이도 5

| 파일 | 합격 | 가독성 | 스토리 | H/M/L |
|:--|:--:|:--:|:--:|:--:|
| 01-concepts.md | ✅ | 4 | 4 | 1/8/2 |
| 02-examples.md | ❌ | 3 | 2 | 6/4/2 |
| 03-exam-questions.md | ❌ | 3 | 2 | 4/4/2 |
| 04-tart-infra-practice.md | ❌ | 2 | 3 | 5/3/0 |
| 05-supplement.md | ❌ | 3 | 2 | 5/4/2 |
| daily/day01.md | ❌ | 3 | 4 | 14/8/0 |
| daily/day02.md | ❌ | 3 | 2 | 6/5/1 |
| daily/day03.md | ❌ | 4 | 4 | 4/4/2 |
| daily/day04.md | ❌ | 3 | 2 | 6/5/0 |
| daily/day05.md | ❌ | 4 | 3 | 4/3/1 |
| daily/day06.md | ❌ | 2 | 2 | 5/7/1 |
| daily/day07.md | ❌ | 3 | 3 | 8/10/3 |
| daily/day08.md | ✅ | 4 | 4 | 0/4/5 |
| daily/day09.md | ❌ | 3 | 3 | 3/5/1 |
| daily/day10.md | ❌ | 3 | 2 | 4/7/3 |
| daily/day11.md | ✅ | 4 | 4 | 4/4/2 |
| daily/day12.md | ❌ | 3 | 2 | 5/5/2 |
| daily/day13.md | ✅ | 4 | 3 | 2/6/5 |
| daily/day14.md | ✅ | 4 | 3 | 3/5/3 |

---

### 01-concepts.md · 가독성 4/5 · 스토리 4/5 · 합격✅

- **🔴 HIGH** `실습재현불가` _1.1 NetworkPolicy 실습 검증 / DNS 트래픽 미처리_
  - 문제: 실습에서 default deny all 정책을 먼저 적용한 뒤, '정책 적용 후: 통신 차단 확인'이라는 기대 출력은 correct 하지만, 실제로 '정책 적용 전: 통신 가능'을 검증하는 명령과 DNS 허용 정책 적용 후 통신 재개 검증이 빠져 있다. 학생이 따라하면 중간에 DNS 해석 실패로 막힐 가능성 높음.
  - 보강: 실습 섹션을 다음처럼 재구성: ① default deny all 정책 적용 ② 통신 차단 확인 (wget 타임아웃) ③ DNS 트래픽 허용 정책 추가 적용 ④ DNS 해석 확인 (nslookup server) ⑤ Egress 규칙 추가로 http 80 허용 ⑥ 다시 wget 성공 확인. 이 흐름으로 학생이 NetworkPolicy의 누적(AND) 효과를 몸으로 이해하게 하기.
- **🟡 MED** `스토리라인누락` _1.4 노드 메타데이터 보호 / SSRF 공격 설명_
  - 문제: SSRF 취약점이 '컨테이너 내부에서 curl 호출'로 묘사되지만, 실제 SSRF는 웹 애플리케이션이 외부 입력을 받은 뒤 해당 URL을 fetch하는 구도이다. 단순히 curl을 호출하는 것만으로 'SSRF 취약점과 결합된다'는 표현이 인과관계를 명확히 하지 못함.
  - 보강: SSRF 공격 흐름을 명시: '① 웹 애플리케이션(제약 없는 URL fetch 기능) ② 공격자가 클라우드 메타데이터 URL 입력 ③ 애플리케이션이 그 URL을 fetch → 메타데이터 노출'로 단계적으로 설명하고, '단순 curl만으로는 내부 메타데이터 접근이 가능하지만, SSRF는 이것을 웹 애플리케이션의 취약점으로 악용하는 기법'이라고 명확히 구분하기.
- **🟡 MED** `용어비약` _2.1 RBAC / 권한 동작 메커니즘_
  - 문제: "하나의 모드에서 허용되면 이후 모드는 평가하지 않는다"는 설명이 있지만, 실제로 모든 인가 모드가 'allow'를 반환하는지, '첫 허용'인지 명확하지 않음. 또한 'Node' 인가 모드(kubelet이 자신의 노드만 수정 가능)와 RBAC/Webhook의 순서 관계가 생략됨.
  - 보강: 인가 모드 평가 흐름을 명시: 'API server는 설정된 --authorization-mode 순서대로 각 모드를 평가한다. 첫 번째 모드가 'allow'를 반환하면 나머지 모드는 건너뛰고 요청을 허용한다. 모든 모드가 'deny'를 반환하거나 어떤 모드도 명시적 'allow'를 반환하지 않으면 403 Forbidden이다.' 또한 Node 인가 모드의 역할(kubelet 자신의 노드 제한)을 간단히 덧붙이기.
- **🟡 MED** `이해난이도` _3.2 AppArmor / LSM 후킹 상세 설명_
  - 문제: "LSM 프레임워크에 후킹하여 동작한다"는 표현이 학부생(운영체제 기초만 학습)에게는 추상적임. 커널 기초 없는 학생이 '후킹이 정확히 뭔가', '시스템콜이 언제 catch되나', 'task_struct의 프로파일 포인터'가 뭔지 모를 수 있음.
  - 보강: 리눅스 커널 권한 없는 학생용으로 단순화: 'AppArmor는 리눅스 커널 내부의 특정 지점(파일 열기, 프로세스 실행)마다 "이 프로세스가 이 작업을 해도 되나?" 물어보는 검사점을 설치한다. 프로세스마다 AppArmor 프로파일이라는 규칙 목록이 붙어 있고, 커널이 그 규칙을 확인한 뒤 작업을 허용하거나 거부한다.' 이렇게 비유로 먼저 설명한 뒤, LSM/task_struct 등 세부는 '(고급) 내부 동작' 서브섹션으로 분리하기.
- **🟡 MED** `맥락점프` _3.4 Syscall 제한 원리와 공격 방어 매핑 / 표 해석_
  - 문제: 표의 '공격 시나리오 × 공격 벡터 × 방어 기법 조합'이 학생 입장에서는 '왜 이 조합인가'가 명확하지 않음. 예를 들어 'mount 공격에 seccomp(mount 차단) + readOnlyRootFilesystem + runAsNonRoot'를 모두 하는 이유가 생략됨.
  - 보강: 각 행 뒤에 간단한 설명 추가: 'Container Escape(mount): readOnlyRootFilesystem이 있어도 Pod 내 /tmp에는 쓸 수 있으므로, runAsNonRoot로 쓰기 권한 제한 + seccomp로 mount 시스콜 자체 차단 → 다중 방어.' 이렇게 각 방어 기법의 '역할 분담'을 명시하면, 학생이 '왜 이런 조합을 쓰는가'를 이해할 수 있음.
- **🟡 MED** `맥락점프` _4.1 Pod Security Standards / 'Baseline 레벨에서 차단하는 항목' 목록_
  - 문제: hostNetwork, hostPID, hostIPC 등 개별 항목이 리스트로만 있고, '이 항목들이 각각 어떤 공격을 방어하는가'가 생략됨. 학생은 'hostNetwork를 차단하는 이유가 뭔가'를 모를 수 있음.
  - 보강: 각 항목 뒤에 위협을 한 줄 추가: '- hostNetwork: true (위협: Pod이 호스트 네트워크 네임스페이스 공유 → 호스트 트래픽 스니핑, 포트 충돌 가능)', '- privileged: true (위협: 모든 Linux capabilities 획득 → 커널 공격의 디딤돌)'. 이렇게 하면 학생이 '정책이 왜 이 항목을 금지했나'를 즉시 이해할 수 있음.
- **🟡 MED** `정확성오류` _4.5 RuntimeClass / gVisor 커널 버전 정보_
  - 문제: 기대 출력에서 'gVisor는 자체적인 커널 버전(4.4.0)을 보고한다'고 했으나, gVisor가 항상 정확히 4.4.0을 반환하는지, 이것이 호스트 커널과 독립적인지, 실제 gVisor 버전에 따라 달라지는지 명확하지 않음.
  - 보강: 더 정확한 설명으로 변경: 'gVisor는 자신의 구현한 가상 커널 인터페이스를 보고한다. uname -r의 출력(4.4.0 등)은 호스트 커널 버전과 독립적이며, gVisor 버전에 따라 다를 수 있다. 중요한 것은 출력값이 호스트 kernel과 다르다는 것으로, 이는 gVisor가 정상 동작 중임을 나타낸다.' 또한 '현실 환경에서는 gVisor가 설치되지 않았을 수 있으므로, 실습 결과는 "RuntimeClass 생성 후 Pod 생성 시도 시 호스트 런타임 부재로 실패" 또는 "(미설치)"로 표기할 수도 있다'는 단서 추가.
- **🟡 MED** `실습재현불가` _5.1 Trivy 이미지 스캔 / 실제 CVE 데이터베이스 의존성_
  - 문제: 기대 출력이 'CVE-2023-0286 CRITICAL' 같은 구체적인 CVE 번호와 심각도를 포함하는데, Trivy의 CVE DB는 정기적으로 업데이트되므로 실제 실행 시 나오는 취약점이 다를 가능성 높음. 학생이 문서의 출력과 실제 출력이 다르면 혼동할 수 있음.
  - 보강: 기대 출력을 일반화: 구체적 CVE 번호 대신 '(CRITICAL/HIGH 취약점 나열)' 형태로 변경하고, 출력 설명에 '실행 시기와 Trivy 버전, CVE DB 버전에 따라 탐지 대상과 심각도가 다를 수 있다. 중요한 것은 --severity CRITICAL,HIGH 옵션이 정상 작동하고, HIGH 이상의 취약점이 필터링되는 메커니즘이다' 단서 추가.
- **🟡 MED** `용어비약` _6.1 Audit Policy / 규칙 매칭 순서_
  - 문제: "규칙은 위에서 아래로 순서대로 평가되고 첫 번째 매칭 규칙이 적용된다"는 설명이 있지만, 'nonResourceURLs가 있는 규칙과 resources가 있는 규칙이 동일 레벨에서 어떻게 매칭되는가' (AND vs OR) 명확하지 않음.
  - 보강: 규칙 매칭 로직을 명시: 'Audit Policy의 각 규칙(rule)에는 users, verbs, resources, namespaces 등 여러 필터가 있다. 규칙이 매칭되려면 해당 규칙에 명시된 모든 필터가 AND 조건으로 일치해야 한다(예: users=["admin"] AND verbs=["delete"] 둘 다 맞아야 함). 규칙끼리는 OR 조건이므로, 첫 매칭 규칙이 이벤트를 처리한 뒤 다음 규칙은 보지 않는다.' 예제로 명확히 하기.
- **⚪ LOW** `스토리라인누락` _4.6 mTLS / Istio 설명_
  - 문제: 평문 통신의 위협(스니핑, MITM)을 설명하지만, '쿠버네티스 내부 네트워크가 기본 평문이라는 설정 현황'과 '이것을 강제 암호화로 변경해야 하는 이유'의 직접 연결이 약함.
  - 보강: 도입부에 '클러스터 내부의 Pod-Pod 통신은 설정상 평문이다. 보안을 위해 이 구간을 암호화하는 것이 mTLS이다'를 명시한 뒤, 위협 사례를 이어붙이기. 또한 Istio 설치 없이도 mTLS를 구현하는 방법(TLS Proxy, service mesh 미사용 기법)과의 비교 간단히 추가하면, 학생이 mTLS의 위치(레이어)를 정확히 이해 가능.
- **⚪ LOW** `용어비약` _6.3 Falco / 주요 필터 필드 설명_
  - 문제: Falco 필터 필드 목록이 있지만, '필드가 현재 이벤트 데이터에서 어디서 나오는가'(커널 시스템콜 정보 vs 쿠버네티스 메타데이터 enrichment)가 생략됨. 예를 들어 proc.name은 커널에서 직접, k8s.pod.name은 etcd 조회 후 라벨링됨.
  - 보강: 필터 필드 설명에 출처 표기: '- proc.name: 시스템콜 캡처에서 직접 추출 (커널) | - k8s.pod.name: 커널 정보 + 쿠버네티스 메타데이터 매칭으로 enrichment (라이브러리)'. 이렇게 하면 학생이 Falco 아키텍처의 계층(드라이버 → 라이브러리 → 엔진)을 더 잘 이해.

### 02-examples.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `스토리라인누락` _§1.2 DNS 허용 + 특정 서비스만 Egress 허용 ~ §1.5_
  - 문제: 이전 기술(없을 때의 문제)과 현재 기술의 개선점이 1.0의 일반적 설명에 그침. 각 예제에서 '왜 이 정책이 필요한가'를 상황별로 풀어주지 않음. 예: 1.2에서 'DNS를 허용하지 않으면 서비스 이름 해석이 불가능하다'는 한 문장만 있고, 실제 운영 시나리오(예: DNS 차단 후 애플리케이션이 backend Pod를 찾지 못하는 과정)를 보여주지 않음.
  - 보강: 각 예제 앞에 '시나리오' 절을 추가: '개발팀이 보안을 강화하려고 한다. frontend Pod에서 backend Pod로는 연결되어야 하지만, 다른 Pod나 외부 서비스로는 접근하지 못하도록 해야 한다. 그런데 단순히 backend Pod를 차단 목록에 넣으면? DNS 해석이 안 되어 모든 Pod가 통신 불가 상태가 된다. 이를 해결하려면? 다음이 필요하다:' 형식으로 문제-해결 구조로 리모델링.
- **🔴 HIGH** `용어비약` _§3.1 AppArmor 프로파일 작성, 라인 678-695_
  - 문제: 프로파일 문법 중 'flags=(attach_disconnected,mediate_deleted)'의 의미를 설명하는 문장이 이후 §3.1에만 있음(라인 714-716). 하지만 그 설명도 간접적: 'attach_disconnected: 컨테이너의 마운트 네임스페이스 밖에서 파일에 접근할 때 필요하다... 이 플래그가 없으면 오류가 발생한다'는 불충분함. '마운트 네임스페이스'가 무엇인지, 왜 컨테이너 런타임이 '밖에서' 파일에 접근하는지, 구체적인 에러 메시지가 무엇인지를 먼저 설명해야 함.
  - 보강: AppArmor 프로파일 문법 설명을 별도 단락으로: '프로파일 플래그 설명: attach_disconnected는 AppArmor가 컨테이너 내부 프로세스의 '바뀐 루트'(chroot)를 추적하도록 한다. 컨테이너 런타임(containerd)이 프로세스 시작 시 마운트 네임스페이스를 격리하는데, 이 경계를 넘어 파일에 접근할 때 AppArmor가 어떻게 경로를 해석할지를 지시한다. 이 플래그가 없으면 "profile not found (No such file or directory)" 에러로 Pod가 생성되지 않는다.'
- **🔴 HIGH** `실습재현불가` _§3.2 프로파일 로드 및 확인 ~ §3.4_
  - 문제: '실제 터미널 스크린샷 이미지'가 전혀 없음. 모든 검증 명령의 출력이 ```text 블록의 텍스트 형태만 있음. CLAUDE.md(§4①)에서 '명령 실행 결과는 무조건 실제 터미널 캡처 PNG 이미지로'라고 명시했는데, 이 파일은 위반함. 학생이 '정말 이 명령이 이렇게 나오는지' 스스로 검증할 수 없음.
  - 보강: 모든 ```text 출력 블록을 제거하고, 대신 'scripts/capture-shot.sh' 헬퍼로 실제 클러스터에서 명령 실행 후 스크린샷 캡처. 예: 'kubectl get pod secure-app' 명령과 그 결과 이미지를 k8scert/CKS/images/03-apparmor-pod-running.png로 저장 후 '![AppArmor Pod Running](images/03-apparmor-pod-running.png)' 형식으로 삽입.
- **🔴 HIGH** `이해난이도` _§4.1 커스텀 seccomp 프로파일 JSON, 라인 899-1015_
  - 문제: seccomp 프로파일 JSON이 900개 라인의 시스콜 허용 목록으로만 제시됨. 하지만 '왜 이 시스콜들을 선택했는가', '이 목록은 어떻게 만들어지는가'(생성 도구/방법), '개별 시스콜 목록의 패턴'이 설명되지 않음. 학생이 자신의 애플리케이션을 위해 seccomp 프로파일을 커스터마이징해야 할 때 어디서부터 시작해야 할지 모름.
  - 보강: §4.1 앞에 'seccomp 프로파일 설계 방법' 부절 추가: '1. strace로 애플리케이션이 실제 사용하는 시스콜 수집: strace -f -c -e trace=open,read,write,mmap,mprotect /path/to/app. 2. 수집된 시스콜 목록에서 whitelist 생성. 3. defaultAction을 SCMP_ACT_ERRNO로 설정하여 명시적 시스콜만 허용(화이트리스트 방식). 4. 테스트: Pod에 적용 후 실제 애플리케이션 동작 확인. 다음은 nginx의 예시입니다:' 형식으로 이해 구조 제시.
- **🔴 HIGH** `맥락점프` _§5.2 Restricted 네임스페이스에서 실행 가능한 Pod ~ §5.3 위반하는 Pod_
  - 문제: §5.2의 compliant-pod.yaml에서 securityContext의 모든 필드(runAsNonRoot, runAsUser, runAsGroup, capabilities.drop, readOnlyRootFilesystem)가 왜 필요한지 개별 설명 부재. nginx가 왜 이 모든 제약 아래서도 작동하는지(일반 nginx는 root, 포트 80 바인딩), 각 제약이 어떤 공격을 막는지 불명확.
  - 보강: §5.1 바로 뒤에 'Restricted 정책의 6가지 요구사항' 표 추가: | 요구사항 | 설정 | 이유(어떤 공격 방지) | nginx에서의 구현 | 형식으로. 예: 'runAsNonRoot: true | Pod 혹은 컨테이너가 root(uid 0)로 실행 금지 | 컨테이너 탈출 시 호스트 root 획득 방지 | nginx를 unprivileged 사용자(1000)로 실행, 포트 1024 이상만 바인딩'.
- **🔴 HIGH** `용어비약` _§6.0 OPA Gatekeeper, 라인 1339-1358_
  - 문제: 'ConstraintTemplate에 정의된 Rego 코드를 OPA 엔진에서 실행한다'는 문장만 있고, Rego 언어가 무엇인지(선언형 정책 언어), 예제의 'violation[{...}]' 구문이 무엇을 의미하는지(위반 조건 정의), 왜 이 구문으로 admission controller가 요청을 거부할 수 있는지를 설명하지 않음.
  - 보강: §6.0에 'Rego 언어 입문' 문단 추가: 'OPA는 Open Policy Agent로, 정책을 Rego라는 선언형 로직 언어로 정의한다. Rego의 핵심은 '조건이 참이 되는 입력'을 찾는 것이다. violation[{msg: ...}]는 "만약 이 조건이 참이면, violation이라는 결과 집합에 요소를 추가한다"는 의미다. OPA 엔진이 violation 집합에 요소가 있으면 "정책 위반"으로 판단하여 admission controller가 요청을 거부한다. 다음 예를 보자:' 형식.
- **🟡 MED** `정확성오류` _§8.1 컨테이너 내 셸 실행 탐지, 라인 1689-1701_
  - 문제: Falco 룰의 condition 필드에 'spawned_process and container'라고 있는데, 'spawned_process'가 매크로인지 기본 필드인지 명시되지 않음. §8 트러블슈팅(라인 1858)에서 '매크로로 정의되어 있다'고만 설명하여 학생이 룰 작성 중 혼동할 수 있음.
  - 보강: §8.1 조건 설명에 '여기서 spawned_process는 Falco의 기본 매크로로, evt.type in (execve, execveat) and evt.dir=<를 의미한다. 즉, 새 프로세스가 실행(fork/exec)될 때의 이벤트를 필터링한다. container는 입력이 컨테이너 내부인지 판별하는 매크로다.'
- **🟡 MED** `스토리라인누락` _§10.0 Secret Encryption at Rest, 라인 2080-2095_
  - 문제: 'base64는 인코딩이지 암호화가 아니다'는 설명만 있고, 실제 운영 환경에서 Secret이 언제 위험한지(예: etcd 백업 파일 유출, etcd 서버 침해 시나리오)를 구체적으로 보여주지 않음. 암호화가 '필수'인지 '선택'인지 판단 불가.
  - 보강: §10.0 등장배경에 시나리오 추가: '시나리오: 클러스터 관리자가 실수로 etcd 데이터베이스를 로컬 파일로 백업했다. 이 파일이 GitHub에 커밋되거나 빌드 서버에서 유출된다면? etcd의 모든 Secret(database password, API key, TLS 인증서)이 base64 인코딩 상태로 노출된다. 공격자는 base64만 디코딩하면 평문 credential을 얻는다. 이를 방지하려면 etcd에 저장되기 전에 Secret을 암호화해야 한다.'
- **🟡 MED** `스토리라인누락` _§14.2 보안이 강화된 Dockerfile, 라인 2574-2599_
  - 문제: distroless 이미지와 멀티스테이지 빌드를 사용하는 '이유'가 불충분함. Stage 1과 Stage 2의 이미지 크기 차이, 공격 표면 감소를 정량적으로 비교하지 않음.
  - 보강: §14.1 BAD 예제에 이미지 크기 추정 주석 추가: '# ubuntu:latest (약 77MB) + pip dependencies (약 50~100MB) = 최종 이미지 150~180MB'. §14.2 GOOD 예제에 비교: '# Stage 1 builder (150~180MB, 최종 이미지에 미포함) → Stage 2 distroless (약 20~30MB) = 최종 이미지 크기 80% 감소. 또한 distroless는 셸, 패키지 매니저, 컴파일러가 없어 공격 표면이 극적으로 줄어든다.'
- **🟡 MED** `맥락점프` _§15.1 TLS Secret 생성, 라인 2667-2678_
  - 문제: 자체 서명 인증서 생성 명령어는 제시되지만, CKS 시험 환경에서는 '보통 인증서가 제공된다'고만 언급함. 시험에서 실제로 인증서를 제공하는 방식(파일 경로, 형식), 또는 직접 생성해야 할 경우를 명확히 하지 않음.
  - 보강: 시험 TIP 절 추가: 'CKS 시험에서 TLS 관련 문제는 보통 다음 2가지다: (1) 기존 인증서 파일(tls.crt, tls.key)이 /root 디렉토리에 제공되는 경우 → 해당 파일로 Secret 생성. (2) 인증서를 생성해야 하는 경우 → openssl 명령 사용. 문제 설명을 꼼꼼히 읽어 어느 케이스인지 판별할 것.'
- **⚪ LOW** `용어비약` _§2.0 RBAC 최소 권한 설정, 라인 409-427_
  - 문제: 'ABAC(Attribute-Based Access Control)'가 언급되지만, RBAC과의 구체적 차이(정책 문법, 관리 방식)가 설명되지 않음. 학생이 RBAC을 선택해야 하는 이유를 실감하지 못함.
  - 보강: 비교 표 추가: | 방식 | 정책 저장 | 정책 변경 | 장점 | 단점 | ABAC | /etc/kubernetes/abac-policy.json (파일) | API server 재시작 필수 | fine-grained | 변경 어려움 | RBAC | kubernetes API (etcd) | 동적 반영 | 동적 관리 용이 | 매우 세밀한 제어는 어려움 |
- **⚪ LOW** `이해난이도` _§11.0 RuntimeClass (gVisor), 라인 2215-2234_
  - 문제: gVisor의 'Sentry', 'Gofer', 'Platform' 개념이 복잡하게 설명됨. 학생이 '결국 gVisor가 뭐 하는 거?'라는 기본 질문에 한 문장으로 답할 수 없음.
  - 보강: §11.0 맨 앞에 직관 추가: 'gVisor는 "사용자 공간 운영체제"다. 일반 컨테이너는 호스트 커널을 직접 사용하지만, gVisor는 그 대신 자신이 구현한 가짜 커널(Sentry)을 중간에 두어, 컨테이너가 호스트 커널을 직접 건드리지 못하게 한다. 이렇게 하면 커널 취약점을 통한 컨테이너 탈출이 훨씬 어려워진다.'

### 03-exam-questions.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `실습재현불가` _전 문서 (모든 40개 문제)_
  - 문제: 검증 블록에서 명령의 실행 결과를 text 출력으로만 제시. CLAUDE.md 4①에서 요구하는 '실제 터미널 스크린샷 이미지' 전무. 학생은 '이렇게 나온다'는 화면 증거 없이 텍스트만 읽게 됨
  - 보강: 각 검증 블록의 명령을 실제 클러스터(dev/staging)에서 실행하고 `screenshot` 캡처로 실제 터미널 이미지 생성. 예: '![검증: Secret 삭제 추적 로그](images/problem-33-audit-log-secret-delete.png)' 형태로 이미지 삽입. 모든 output text 블록 제거
- **🔴 HIGH** `스토리라인누락` _문제 1~10 (Cluster Setup, Cluster Hardening)_
  - 문제: NetworkPolicy, AppArmor, seccomp, kubeadm 등 각 기술이 '왜 등장했는지' (직전 기술 한계, 무엇을 해결했는지) 설명 부재. 예: 문제1은 'deny-all policy가 왜 필요한가(lateral movement 위험)' 정도 있지만, 이전에 Pod 간 통신을 어떻게 제어했는지, 그 한계가 무엇인지 못 저
  - 보강: 각 문제의 '핵심 원리' 전에 '등장 배경' 섹션 추가: "이 기술 이전(Kubernetes 초기)에는 all-allow 기본값이어서 모든 Pod가 자유롭게 통신할 수 있었다. 이는 lateral movement 공격에 취약했다. 따라서 명시적 deny-by-default 정책이 필요했다" 형태로 4-5줄 작성
- **🔴 HIGH** `스토리라인누락` _문제 11~20 (System Hardening, Microservice Vulnerabilities)_
  - 문제: AppArmor vs SELinux 차이(왜 AppArmor 선택), PSA vs PodSecurityPolicy 진화, OPA Gatekeeper가 해결한 PSA의 한계 등 '이전 기술과의 비교' 완전 부재. 학생이 '이 기술만' 알지 '왜 선택했는지'는 모름
  - 보강: 각 기술 섹션에 '이전 기술 한계' 명시. 예: "AppArmor 전에 Linux capabilities만으로는 파일 경로별 세밀한 제어가 불가능했다. AppArmor는 profile 기반 path-level 제어로 이를 해결했다. SELinux는 정책이 복잡해서 Kubernetes와 호환성이 떨어진다"
- **🔴 HIGH** `정확성오류` _문제 4 (바이너리 검증), 문제 20 (Secret 암호화), 문제 26 (ImagePolicyWebhook)_
  - 문제: 실제 작동을 검증하지 않은 가정 명령들. 예: 문제4의 'curl -LO https://dl.k8s.io/v1.29.0/bin/linux/amd64/kubelet.sha512'는 실제 존재하는지 확인 안 됨. 문제20의 ETCDCTL 경로는 tart 클러스터 환경에 따라 다를 수 있음
  - 보강: 모든 URL/경로를 실제 클러스터에서 테스트. 예: 실제로 'curl -I https://dl.k8s.io/v1.29.0/bin/linux/amd64/kubelet.sha512'가 200을 반환하는지 확인. ETCDCTL은 'ETCDCTL_API=3 etcdctl member list'로 쌀근성 검증
- **🟡 MED** `용어비약` _문제 2 (DNS Allow), 문제 12 (seccomp), 문제 18 (OPA Gatekeeper)_
  - 문제: 학생이 처음 보는 개념을 끝내기 언급. 예: 문제2의 'to: [] (모든 대상)'는 '빈 라벨 셀렉터로 모든 대상' 설명 있지만, 왜 'to: [{}]'와 다른지는 명확히 안 저. 문제12의 'SCMP_ACT_ERRNO'는 처음 등장하는데 상세 정의 부재
  - 보강: 첫 등장 용어에 한 줄 정의 추가. '`to: []`는 라벨 셀렉터가 없는 빈 배열(모든 대상을 의미), `to: [{}]`는 빈 라벨 객체(같은 NS의 모든 Pod)와 구분'. 'SCMP_ACT_ERRNO는 seccomp 필터가 시스템콜을 거부하고 지정 에러 번호(기본 EPERM)를 반환하는 액션'
- **🟡 MED** `맥락점프` _문제 15 (AppArmor complain->enforce), 문제 24 (mTLS/Istio), 문제 33 (Audit Policy)_
  - 문제: 갑자기 새 개념이 등장하거나, 이전 개념과의 연결이 불명확. 예: 문제15는 'complain 모드'를 설명 없이 사용. 문제24는 Istio 설치를 전제하지만 클러스터 setup 단계에 안 나옴
  - 보강: 문제 선행 조건 명시. 예: "문제24는 Istio가 설치된 클러스터에서 수행. Istio 미설치 시 'istioctl install'로 사전 설치 필요". complain/enforce는 첫 등장(문제11)의 '등장 배경'에서 '테스트(complain)와 운영(enforce)의 모드 전환' 개념 선수
- **🟡 MED** `이해난이도` _문제 3 (kube-bench), 문제 8 (kubeadm upgrade), 문제 20 (etcd encryption), 문제 26 (ImagePolicyWebhook)_
  - 문제: 복잡한 파일 조작과 서비스 재시작이 필요한데, 단계가 많아서 어느 것을 빼먹으면 실패하는지 헷갈림. 예: 문제3은 API server 매니페스트 수정, volume/volumeMount 추가, 디렉토리 생성, 재시작, 재점검 등 8-9단계가 있는데 어느 것을 빼먹으면 실패하는지 명확히 안 저
  - 보강: 각 복잡한 단계에 '[함정]' 마크. 예: "[함정] audit-log-path 추가 시 volume과 volumeMount 둘 다 필수. 하나라도 빼먹으면 API server 시작 실패". 핵심 단계를 **굵게** 표시
- **🟡 MED** `실습재현불가` _문제 16 (kubelet 설정), 문제 27 (Dockerfile), 문제 29 (Cosign)_
  - 문제: 노드 직접 접근(SSH) 또는 빌드 도구(docker, crane, cosign)가 필요한데, tart 환경 설정 여부 명확 안 함. 예: 문제29의 'cosign generate-key-pair'는 cosign이 설치되어야 하는데, 클러스터에 있는지 불명
  - 보강: 환경 요구사항 명시. "이 문제는 dev 클러스터의 master 노드에 SSH로 접근 필요. 'ssh dev-master'로 쌀근". 도구는 "사전에 'apt-get install cosign' 또는 컨테이너 내 'crane' image 사용" 명시
- **⚪ LOW** `용어비약` _문제 18, 19 (OPA Gatekeeper - Rego)_
  - 문제: Rego 언어의 문법(`[good | ...]`, `count(missing) > 0` 등)을 설명 없이 사용. Rego 초보자는 복사만 하고 이해 못 함
  - 보강: Rego 스니펫 아래에 "핵심 Rego 패턴" 섹션 추가: "- `provided := {label | input.review.object.metadata.labels[label]}`는 현재 객체의 모든 라벨 이름을 집합으로 생성 (set comprehension). - `missing := required - provided`는 집합 차이 연산. - `count(missing) > 0`는 누락된 라벨이 1개 이상이면 true"
- **⚪ LOW** `구조` _문제 1~40 전체_
  - 문제: 각 문제의 '풀이' 섹션과 '검증' 섹션이 거의 동일한 코드를 반복. 학생이 풀이를 읽은 후 검증을 다시 읽을 때 중복감 느낌. DRY 위반
  - 보강: '풀이'와 '검증'의 역할을 명확히. 풀이는 '시험 시간을 고려한 빠른 풀이 (명령형 우선)', 검증은 '작동 확인 (예상 output 스크린샷)'. 검증 섹션은 명령 반복 최소화하고 **스크린샷만 중심**으로 재구성

### 04-tart-infra-practice.md · 가독성 2/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `용어비약` _전체 (L.82-89, L.240-250, L.1000-1100 등)_
  - 문제: eBPF, LSM, syscall, namespace, CNI, veth 등 핵심 개념이 정의 없이 등장. 학부 3학년이 이 용어들을 모를 때 원문을 읽을 수 없음. 특히 1.1절 커널 레벨 원리 설명이 eBPF를 이미 알고 있다고 가정.
  - 보강: 각 기술 항목의 첫 등장 시 '한 문장 풀이' 필수. 예: '네임스페이스(프로세스 격리 기법)', 'eBPF(커널에서 실행되는 작은 프로그램)', 'CNI(쿠버네티스 네트워킹을 담당하는 플러그인)'. 커널 원리 섹션은 '기본 개념 이해한 상태'를 가정하는 문구 추가.
- **🔴 HIGH** `실습재현불가` _L.1-4858 (검증 블록 대다수)_
  - 문제: 예상 출력이 ```text 블록(텍스트 생성)으로 제시. CLAUDE.md §4①에서 '실행 결과는 반드시 스크린샷 이미지'로 규정했는데 미준수. 학생이 실제 결과와 문서의 출력이 다르면 자신의 실행이 틀렸다고 생각할 수 있음.
  - 보강: 모든 kubectl 출력 블록(```text)을 삭제하고, 실제 클러스터에서 명령 실행 후 터미널 스크린샷으로 교체. 예: 'kubectl get cnp'의 출력을 PNG 캡처로 k8scert/CKS/images/ 에 저장 후 ![](images/cnp-list.png) 삽입. 단일 줄 출력(예: 'yes'/'no')은 ```bash 코드블록 내 명령과 함께 표시 가능.
- **🔴 HIGH** `스토리라인누락` _전체 실습 섹션 (특히 L.3600-3900 모의시험)_
  - 문제: 기술 설명 시 '문제점 → 해결책'은 있으나, '왜 이 방법이 유일한가', '다른 방법은?', '실무에서의 트레이드오프'가 없음. 예: readOnlyRootFilesystem 적용하면 애플리케이션이 로그를 쓸 수 없으면 어떻게 하는가? 이런 실전 고민이 부재.
  - 보강: 각 기술 도입 시 대안 제시. 예: 'etcd 암호화 방법 3가지 (aescbc/aesgcm/secretbox) 비교표', 'RBAC vs NetworkPolicy vs AppArmor의 역할 분담'. 모의 시험 각 문제마다 '이 설정이 방어하는 공격 유형' 한 줄 명시 (현재: 일부 상세, 일부 누락).
- **🔴 HIGH** `이해난이도` _L.240-260 (NetworkPolicy 커널 레벨 원리), L.1503-1512 (AppArmor LSM 훅), L.1659-1670 (seccomp BPF)_
  - 문제: '커널 레벨 동작 원리' 섹션이 이미 고급 지식을 가정. 예: 'FORWARD chain → cali-FORWARD → cali-to-wl-dispatch → cali-tw-<endpoint>'는 iptables를 몰라면 이해 불가. 학부 3학년 수준에서는 '규칙이 커널 내부에서 적용된다' 정도만 필요.
  - 보강: '커널 레벨'과 '학부 수준' 섹션 분리. 학부 수준: '(그림) Pod A → 규칙 평가 → 허용/차단', 깊이: iptables/eBPF/LSM 세부. 또는 상자 시각화 (mermaid) 추가: 패킷 흐름도를 그림으로 제시 (현재: 텍스트 다이어그램).
- **🔴 HIGH** `정확성오류` _L.255 (additive 특성), L.1650-1656 (seccomp 위험 syscall), L.3987 (nginx root 실행)_
  - 문제: 기술적으로 '맞지만 학부생 관점에서 모호'. 예1: 'Additive: 여러 정책이 허용 규칙 합산'은 '둘 다 DENY면?' 질문이 생김. 예2: seccomp 위험 syscall 나열 (ptrace, mount)의 위협 시나리오 설명 부족. 예3: 'nginx:1.25-alpine 기본적으로 root' → 문서 자체에서 처음 본 독자는 검증 불가.
  - 보강: 예1: 정의 직후 '각 정책의 allow 규칙을 합치고, 하나라도 deny면 전체 deny' 명확히. 예2: 각 syscall마다 위협 예시 추가 ('ptrace = 다른 프로세스 메모리 탈취'). 예3: 이미지 정보는 첫 배포 시 스크린샷으로 확인하는 검증 섹션 추가.
- **🟡 MED** `맥락점프` _L.70-120 (CiliumNetworkPolicy 갑작스런 등장), L.514-670 (kube-bench 소개), L.1365-1410 (etcd 암호화 아키텍처)_
  - 문제: 섹션 전환이 급격함. 예: 1.1에서 표준 K8s NetworkPolicy를 배우다가 갑자기 CiliumNetworkPolicy로 점프. 학생이 '뭐가 다른데?'라는 의문이 안 풀림. kube-bench도 갑자기 등장 (사전 설명 없음). etcd 암호화도 아키텍처 다이어그램 없어 암호화 흐름을 텍스트만으로 이해해야 함.
  - 보강: 섹션 도입부에 '이 섹션 목표: X를 Y로 심화한다' 명시. 예: '1.1에서 표준 NP를 배웠으니, 이제 L7 필터링이 필요한 이유와 Cilium 도구로 해결하는 법을 배운다'. 또는 비교 표 추가 ('표준 NP vs CiliumNP: L4까지 vs L7까지'). etcd 암호화는 mermaid 흑백 다이어그램 추가 (Secret 쓰기 → 암호화 → etcd 저장 흐름).
- **🟡 MED** `구조` _L.1-4858 전체_
  - 문제: 실습 간 상세도 차이 심함. 예: 1.1은 등장배경 + 커널원리 + 검증 4단계, 6.4는 간단한 명령 3줄. 또한 정리(delete) 단계를 하는 실습과 안 하는 실습이 섞여 있음 (학생이 dev 클러스터를 지저분하게 만들 수 있음).
  - 보강: 모든 실습 템플릿 통일: [등장배경(2-3문장)] → [개념/원리(다이어그램 + 3-5문장)] → [CLI 명령] → [검증 4단계 (스크린샷)] → [트러블슈팅 표] → [정리(반드시 delete)]. 상세도도 '난이도 ★★☆'는 최소 20줄, '★★★'는 최소 50줄로 기준화.
- **🟡 MED** `용어비약` _L.1817-1825 (ImagePullPolicy), L.2293-2304 (mTLS 사이드카 프록시)_
  - 문제: ImagePullPolicy 섹션에서 'IfNotPresent'가 무엇인지 설명 없음. mTLS도 Envoy sidecar를 '서비스 메시가 자동으로 주입한다'고 하는데, 학생은 '뭐가 sidecar인데?'라고 물음.
  - 보강: 용어 첫 등장 시 괄호로 즉시 정의. 예: 'ImagePullPolicy(이미지를 매번 다시 받을지 결정하는 설정)', 'Envoy sidecar(각 Pod 옆에 붙는 네트워킹 도우미 프로세스)'.

### 05-supplement.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `스토리라인누락` _Part 1 전체(섹션 1~7), Part 2 예제 10개, Part 3 문제 25~30_
  - 문제: 각 기술의 '이전 상태의 문제'는 형식적으로만 기술되었으며, 직전 기술(예: PSP vs PodSecurity, kube-proxy vs Cilium)과의 비교 및 '무엇이 나아졌는가'의 메커니즘 설명이 거의 없음. 학부생이 '왜 이 보안 통제가 필요한가'를 깊이 있게 이해할 수 없음.
  - 보강: 각 섹션 '이전 상태의 문제' 뒤에 '기존 기술의 한계 vs 새 기술의 개선' 비교표(또는 설명) 추가. 예: Capabilities 섹션 → 'root 권한 이분법 → capabilities 분할' 역사, PSA 섹션 → 'PodSecurityPolicy의 폐기 이유 및 PSA의 설계 차이점' 명시.
- **🔴 HIGH** `용어비약` _섹션 1(Linux Capabilities): 'bounding set', 'inheritable set', 'ambient set' / 섹션 4(etcd 암호화): 'aescbc provider order', 'identity fallback' / 섹션 7(KMS): 'DEK', 'KEK', 'Envelope Encryption'_
  - 문제: 처음 등장하는 용어를 풀이 없이 사용. 학부생이 이해 불가능. 'bounding set'이 무엇인지, 왜 필요한지 한 문장 풀이 필요.
  - 보강: 각 용어 첫 등장 시 '용어(영문) = 정의/역할' 형식으로 한 줄 삽입. 예: 'Bounding set(bounded set): 프로세스와 자식이 가질 수 있는 capability의 최대 범위를 제한하는 커널 메커니즘이다.' 섹션 4의 'identity provider'는 '기존 평문 데이터도 읽을 수 있는 fallback provider'로 명시.
- **🔴 HIGH** `정확성오류` _섹션 1: 검증 1, 검증 2 (예상 hex 값), 섹션 3: '같은 종류의 webhook이 여러 개이면 이름 알파벳 순서로 실행', 섹션 5: Sysdig eBPF 설명_
  - 문제: - 섹션 1 검증에서 'CapEff: 0000000000000400' 출력이 실제 로그인지 불명확(escaping 확인 불가). - 섹션 3 webhook 순서 설명: 'MutatingWebhook이 ValidatingWebhook보다 먼저 실행'은 맞으나, '같은 종류 webhook의 순서'는 '알파벳 순서'가 아니라 '선언 순서'(FIFO)일 수 있음. - 섹션 5 Sysdig: 'eBPF 방식'은 사실이나 '커널 재컴파일이 불필요'는 부분적으로만 참(EBPF 프로그램 자체는 커널 API에 의존).
  - 보강: - 섹션 1: 실제 Pod에서 캡처한 터미널 스크린샷 이미지로 검증 결과 제시(텍스트 블록 금지, §4①). - 섹션 3: 'webhook 실행 순서는 선언 순서를 따르며, 같은 우선순위의 webhook이 있으면 이름 알파벳순 정렬 후 순차 실행'으로 명확히. - 섹션 5: 'eBPF 프로그램 로드는 재컴파일 불필요하나 커널 버전에 따라 호환성 확인 필요'로 수정.
- **🔴 HIGH** `실습재현불가` _Part 2 예제 1~10 (NetworkPolicy, kube-bench, AppArmor, Seccomp, OPA, Trivy, Falco, Audit, Secret Encryption, RuntimeClass) / Part 3 문제 1~30 검증 블록_
  - 문제: 검증 명령어의 예상 출력이 모두 텍스트 코드블록으로만 제시되어 있음(§4①: 'text 블록은 금지'). 예: '포트 80 바인딩 확인', '/etc/passwd 읽기 차단' 등 모든 검증이 '```text 출력 예상' 형태. 학생이 실제 클러스터에서 실습할 때 '자신의 출력이 맞는지' 확인 불가능. 실제 터미널 스크린샷이 필요하나 없음.
  - 보강: 각 예제/문제의 검증 단계마다: (1) 검증 명령어 ```bash 블록 제시 → (2) 실제 클러스터(dev/staging)에서 명령 실행 → (3) 터미널 화면을 PNG로 캡처 → (4) ![검증 결과](images/예제1-검증2.png) 로 삽입 → (5) 이미지 아래에 5~10줄의 해석('0x400이 NET_BIND_SERVICE임', '권한 거부 응답이 나왔으므로 AppArmor 작동' 등). 현재 서 있는 위치: dev/staging 클러스터 가동 가능하므로 이 작업은 실현 가능.
- **🔴 HIGH** `맥락점프` _Part 1 섹션 간 연결(1→2→3→4→5→6→7) / Part 2 예제 간 흐름 / daily 없음_
  - 문제: Part 1은 각 섹션이 독립적으로 서술되어 있어, '보안 통제의 레이어'(OS 레벨 → 컨테이너 레벨 → 클러스터 레벨)의 흐름이 불분명. 예: Capabilities(섹션 1) 이후 kubectl auth(섹션 2)로 점프할 때 '왜 이 순서인가' 설명이 없음. CKS 도메인(5가지)과의 매핑도 불명확.
  - 보강: Part 1 서두(목차 전)에 '이 7가지 기술의 위치 지도' 추가: ```mermaid 또는 표 | 항목 | 레이어 | 도메인 | 기존 한계 | 새로운 점 |... Part 2 시작 전 'Part 1~3 연계도' 추가(Part 1은 개념, Part 2는 단일 기술 예제, Part 3은 다중 기술 조합 실습). Part 3 이후에 'daily 커리큘럼(Day 1~14)으로 순차 학습하세요'라는 가이드 추가.
- **🟡 MED** `이해난이도` _섹션 1-4 (Capabilities, auth can-i, Webhook, etcd 암호화)_
  - 문제: 커널 레벨 설명(seccomp BPF, LSM hooks, overlayfs, capability set)이 학부 OS 수준의 자세함으로 적혀있으나, 이 배경지식 없는 학생이 읽으면 미궁에 빠질 수 있음. 반면 추상도는 낮음(정확하지만 어려움).
  - 보강: 각 섹션마다 '알면 좋지만 필수 아님' 섹션 추가: 예) 섹션 1 '### 깊이 있는 이해: capability 내부 구조(선택 읽음)'. 기본 설명 → 검증 코드 → 깊이 설명 순서 변경. 또는 '직관적 비유' 먼저: 'Capabilities = root 권한을 40개의 열쇠로 분할' → 메커니즘 설명.
- **🟡 MED** `용어비약` _Part 3 문제 25(kubesec): 'critical', 'advise', 'points 계산' 설명 없음 / 문제 27(Audit 분석): 'jq 필터', 'requestReceivedTimestamp 포맷' 불명_
  - 문제: kubesec 점수의 'critical' vs 'advise' 구분이 설명 없음. 학부생이 '-30점의 의미'를 모를 수 있음. Audit 분석 문제의 'jq'는 JSON 처리 도구인데 사용법 설명이 전혀 없음.
  - 보강: 'critical' = 보안 위협(점수 감소), 'advise' = 권장 사항(점수 증가) 한 줄 추가. kubesec 섹션 앞에 'kubesec은 Pod 보안을 -몇점~+몇점으로 점수화하는 도구'라는 정의 추가. 문제 27 앞에 'jq는 JSON 쿼리 도구로, .필드명으로 필드 추출, select()로 조건 필터링'이라는 설명 1문단 추가.
- **🟡 MED** `스토리라인누락` _Part 3 문제 6~10(Cluster Hardening), 문제 16~20(Microservice)_
  - 문제: 각 문제의 '등장 배경과 기존 한계점'이 1문단으로 너무 짧음. '직전 기술(PSP vs PSA, legacy RBAC vs modern RBAC)의 실제 차이'를 설명하지 않아 학부생이 '왜 이 문제를 풀어야 하는가'를 못 느낌.
  - 보강: 각 문제의 '등장 배경' 섹션을 2문단으로 확장: 첫 문단: '이전에는...문제가 있었다' → 두 번째 문단: '이 기술이 개선한 점은...' 형식. 예) 문제 6(RBAC): '과거 PSP는 Pod별 정책 선택 불가 → 현재 PSA는 네임스페이스 레벨 라벨로 유연함' 명시.
- **🟡 MED** `구조` _Part 3: 문제 1~5(Cluster Setup), 6~10(Hardening), 11~15(System), 16~20(Microservice), 21~25(Supply Chain), 26~30(Monitoring) 제목_
  - 문제: CKS 도메인 5가지(Cluster, Hardening, System, Microservice, Supply Chain, Monitoring)가 6개 섹션으로 나뉘어, 학부생이 '시험의 어느 부분을 대비하는가' 혼동 가능. CKS 공식 도메인과 일치하지 않을 수 있음.
  - 보강: Part 3 서두에 'CKS 공식 5가지 도메인 매핑표' 추가: | 시험 도메인 | Part 3 해당 문제 |... 또는 섹션 제목을 'Cluster Setup & Hardening', 'System & Microservice', 'Supply Chain & Monitoring'으로 통합.
- **⚪ LOW** `용어비약` _섹션 2(kubectl auth can-i): 'SubjectAccessReview API', 'dry-run'_
  - 문제: 'SubjectAccessReview'가 무엇인지 한 줄 설명이 '실제 리소스 생성이 아니라 인가 판정만 수행하는 dry-run이다'라고 회귀 정의됨. 'API 서버의 인가 모듈에 직접 쿼리하는 API 객체'로 명시 필요.
  - 보강: 'SubjectAccessReview는 '특정 사용자가 특정 리소스에 특정 작업을 수행할 수 있는지 조회하는 API 객체로, API 서버가 실제 리소스 변경 없이 권한만 평가함'으로 수정.
- **⚪ LOW** `정확성오류` _섹션 3: '같은 webhook이 여러 개이면 이름 알파벳 순서로 실행' → 실제는 선언 순서 또는 다른 정렬 기준_
  - 문제: webhook 실행 순서가 정확하지 않을 수 있음.
  - 보강: 쿠버네티스 공식 문서 확인 후 정정. 일반적으로 'webhook 실행 순서는 선언 순서를 따르지만, 같은 우선순위인 경우 이름 알파벳순 보조 정렬'이 맞음을 명시.

### daily/day01.md · 가독성 3/5 · 스토리 4/5 · 미달❌

- **🔴 HIGH** `용어비약` _1.1 NetworkPolicy 개요, L3/L4 ACL_
  - 문제: "L3/L4 ACL"이 첫 등장하는데 ACL이 무엇인지, 왜 L3/L4인지 풀이 없음. 학생이 네트워크 계층(OSI 모델) 기초가 없으면 막힘.
  - 보강: 1.1 앞에 '네트워크 계층 기초' 섹션 추가: "OSI 7계층에서 L3=IP 주소/CIDR, L4=TCP/UDP 포트 범위. ACL(Access Control List)은 출발지/목적지/포트 조합으로 트래픽을 필터링하는 보안 규칙. NetworkPolicy는 쿠버네티스 Pod 간 통신을 L3/L4 수준에서 제어하는 ACL이다."
- **🔴 HIGH** `용어비약` _1.1 NetworkPolicy 개요, CNI 플러그인/데이터플레인_
  - 문제: "CNI 플러그인" "데이터플레인"이 배경 설명 없이 등장. 대비 개념(컨트롤플레인)도 명시 안 됨.
  - 보강: "Kubernetes 아키텍처: 컨트롤플레인(API Server, etcd 등 정책 관리) vs 데이터플레인(각 노드에서 실제 패킷을 필터링/전달). CNI(Container Network Interface) 플러그인은 데이터플레인 구현체(Cilium, Calico 등)로, 컨트롤플레인의 NetworkPolicy를 커널 패킷 필터링 규칙(eBPF, iptables)으로 변환한다."
- **🔴 HIGH** `스토리라인누락` _1. NetworkPolicy 전체 섹션_
  - 문제: Section 1.2는 "한계"와 "공격-방어 매핑"을 잘 제시했지만, 직전 기술(Kubernetes flat network 이전)의 대안들이 무엇인지 모호함. "Kubernetes 초기에는 없었다"만 있고, 대신 쓴 것(IP whitelist? firewall?)을 명시하지 않음.
  - 보강: "한계" 다음에 "당시 대안들"을 추가: "초기 쿠버네티스는 호스트 방화벽(iptables 호스트 규칙)에만 의존했으므로, Pod 증감에 따라 모든 노드의 방화벽 규칙을 수동으로 관리해야 했고, Pod 내부 통신 격리는 불가능했다. NetworkPolicy는 이를 선언적·자동화된 Pod 수준 정책으로 해결했다."
- **🔴 HIGH** `이해난이도` _1.3 커널 수준 동작 원리, Cilium eBPF 설명_
  - 문제: "sk_buff 구조체에서 src/dst IP, port, protocol을 추출하고 eBPF map에 저장된 정책 엔트리와 매칭"하는 설명이 리눅스 커널 지식(sk_buff 자료구조, eBPF map 개념)을 사전 가정. 3~4학년이 이해 못 함.
  - 보강: eBPF를 먼저 풀이: "eBPF(extended Berkeley Packet Filter)는 커널 내부에서 안전하게 실행되는 제한된 프로그램으로, 패킷마다 빠르게 판정을 내린다(C처럼 보이지만 검증됨). Cilium의 eBPF 프로그램은 패킷 헤더(출발지 IP, 목적지 IP, 포트)를 읽고, 미리 저장된 정책(map이라는 키-값 저장소)과 비교해 '허용' 또는 '차단'을 O(1) 속도로 판정한다."
- **🔴 HIGH** `실습재현불가` _1.7 특정 Pod 간 통신 허용, 예제 YAML_
  - 문제: "frontend Pod"와 "backend Pod"가 실제로 클러스터에 있다고 가정하지만, 학생이 이들을 만드는 방법(Deployment, kubectl run 등)이 표시되지 않음. YAML만 주면 "이건 어디에 apply하나?" 묻게 됨.
  - 보강: 예제 전에 "전제 조건: 다음 명령으로 테스트 Pod를 먼저 생성하고, 그 다음 NetworkPolicy를 적용하시오" 섹션 추가: `kubectl run frontend --image=curlimages/curl --label app=frontend --rm -it -- sleep 3600` 등
- **🔴 HIGH** `실습재현불가` _1.11 NetworkPolicy 실습 검증, 명령 결과_
  - 문제: "dev 실측"이라 적혀 있지만 구체적인 kubectl 명령(NetworkPolicy 생성, Pod 생성, 통신 테스트)의 전체 흐름이 누락됨. 학생이 "어떤 순서로 뭘 apply하나?"라 물음.
  - 보강: 1.7 YAML과 연결하는 "실습 전체 흐름" 섹션 추가: `kubectl apply -f default-deny-all.yaml && kubectl apply -f frontend-to-backend.yaml && kubectl exec attacker ... && <결과 이미지>` 순서대로
- **🔴 HIGH** `정확성오류` _1.11 실습 검증, wget 출력_
  - 문제: "wget: bad address 'web-svc'"는 DNS 실패 신호인데, 주석"DNS(UDP 53) 질의 자체가 막혀 이름 해석 단계에서 먼저 실패"는 맞음. 그러나 이 출력을 생성한 정확한 명령(timeout, -t 재시도 등)과 클러스터 상태(default-deny-all 이외에 다른 정책은 없는가?)를 명시하지 않아 재현 불가.
  - 보강: 명령어 앞에 "정확한 전제" 추가: `kubectl delete networkpolicy -n secure-ns --all 이후 default-deny-all만 apply한 상태에서:`
- **🔴 HIGH** `용어비약` _2.1 CIS Benchmark, "파일 퍼미션, 프로세스 인자"_
  - 문제: "파일 퍼미션"(chmod 755), "프로세스 인자"(command-line flags)가 무엇인지 리눅스 기초가 없는 학생은 못 이해.
  - 보강: "파일 퍼미션(chmod 755 같은 접근 제어): /etc/kubernetes 파일들이 root만 읽을 수 있게. 프로세스 인자(--flag=value 형태): kube-apiserver를 기동할 때 --anonymous-auth=false 같은 보안 옵션을 전달하는 것."
- **🔴 HIGH** `실습재현불가` _2.5 kube-bench 실습 검증, 명령 실행_
  - 문제: "kube-bench run --targets master --check 1.2.1"을 그냥 실행하면, 실제로 어느 노드에서 돌려야 하는가(마스터 노드에 SSH? Pod 내부에서?), 권한은 어떻게 얻는가(sudo?) 명시 안 됨.
  - 보강: "실습 사전준비: kube-bench는 마스터 노드의 /etc/kubernetes/ 파일에 직접 접근하므로 SSH로 마스터 노드에 접속한다: `ssh staging-master` 후 다음 명령 실행. 또는 kube-bench Pod를 클러스터 내 권한 있게 띄워 실행:"
- **🔴 HIGH** `정확성오류` _2.4 kube-bench FAIL 항목 수정 절차, 매니페스트 위치_
  - 문제: flowchart에서 "API Server → kube-apiserver.yaml"이라 했는데, kubeadm 클러스터의 정확한 경로(일반적으로 /etc/kubernetes/manifests/kube-apiserver.yaml)를 명시하지 않음. 학생이 "이건 어디에 있나?" 물음.
  - 보강: "Static Pod의 매니페스트는 /etc/kubernetes/manifests/ 디렉터리에 저장됨. vi로 수정하면 kubelet이 자동으로 감지해 Pod를 재시작한다. 이는 deployment나 configmap과 달리 노드 로컬의 관리 구조다."
- **🔴 HIGH** `맥락점프` _3. Ingress TLS 설정, "TLS 종단(Termination)"_
  - 문제: "Ingress는 TLS를 종료하고 내부 Pod와는 HTTP로 통신"하는 패턴이 소개되지만, "왜 이게 일반적인가?" "Pod 사이에도 TLS를 쓰면 안 되나?"는 질문에 답이 없음.
  - 보강: "Ingress TLS Termination은 외부 트래픽만 암호화하고 내부(클러스터 네트워크)는 신뢰하는 구조. 이유: (1) 내부 네트워크는 관리자 통제 하의 격리된 환경 (2) Pod 간 TLS는 CPU 오버헤드가 크고 관찰 어려움. CKS 고급에서는 Istio mTLS로 Pod 간도 암호화할 수 있다."
- **🔴 HIGH** `용어비약` _3.1 X.509 인증서·handshake·대칭/비대칭 암호화_
  - 문제: X.509·비대칭 키·세션 키·AES-GCM 등이 암호학 사전지식을 가정. 3~4학년이 이해 못 함.
  - 보강: "TLS Handshake: 클라이언트와 서버가 서로의 인증서(X.509, 신원 증명)를 검증한 뒤 세션 키(양쪽이 공유할 암호화 키)를 협상. 이후 모든 데이터는 그 키로 AES-GCM(대칭 암호화, 빠름)로 암호화. 비유: 편지(데이터)를 보내기 전에 편지지(인증서)와 열쇠(세션 키)를 미리 교환하는 것."
- **🔴 HIGH** `정확성오류` _3.3 TLS Secret 확인, 인증서 내용 조회 명령_
  - 문제: 명령 `kubectl get secret myapp-tls -n production -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -text -noout`에서 `\\` 이스케이프가 복잡하고, 실제 클러스터에서 이 명령이 그대로 작동하는지 검증된 캡처가 없음("dev 실측"이라 적혀 있지만 실제 터미널 스크린샷이 없음).
  - 보강: "실제 명령어 검증" 섹션 추가: 실제 클러스터에서 이 명령을 실행한 터미널 스크린샷(이미지) 첨부. 또는 더 단순한 대안(예: `kubectl get secret ... --export` 또는 `kubectl describe secret ...`)을 제시.
- **🔴 HIGH** `실습재현불가` _4. 바이너리 무결성 검증_
  - 문제: "sha512sum /usr/bin/kubelet"과 "curl -LO ... kubelet.sha512"를 실행하려면, kubelet 바이너리가 실제로 /usr/bin/kubelet에 있어야 함. tart 클러스터에서 이 경로를 따르는가? (kubeadm 클러스터는 /usr/bin과 다를 수 있음)
  - 보강: "사전 확인: 현재 클러스터(예: dev)에서 `which kubelet` 또는 `systemctl status kubelet`으로 바이너리 위치를 확인한다. tart dev 클러스터의 경우 <실제 경로>에 설치되어 있으므로, 해시 검증 경로를 그에 맞춘다."
- **🟡 MED** `맥락점프` _1.4 AND vs OR 조건, 예제_
  - 문제: YAML 예제에서 `podSelector`와 `namespaceSelector`를 같은 `from` 안에 나열하면 AND라는 설명은 맞지만, 실제 인더스트리 패턴(예: "app=frontend AND env=staging")을 보여주지 않음. 학생이 "같은 from 안에"의 의미를 YAML 들여쓰기로만 이해하려 함.
  - 보강: AND 예제 YAML 뒤에 "확인" 코멘트 추가: `# 이 규칙은 app=frontend Pod AND env=staging 네임스페이스에서만 트래픽 허용`
- **🟡 MED** `맥락점프` _1.6 DNS 허용 패턴, "왜 DNS를 반드시 허용해야 하는가" 설명_
  - 문제: "backend-svc:8080"에서 "svc"가 무엇인지 풀이 없음. Service 리소스를 아직 배우지 않은 학생이 혼동할 수 있음.
  - 보강: "Service(또는 svc, K8s 내부 로드밸런서)는 Pod 그룹을 안정된 DNS 이름(backend-svc)과 ClusterIP로 추상화한 리소스" 한 줄 추가
- **🟡 MED** `용어비약` _1.10 메타데이터 API 차단, IMDS 용어_
  - 문제: "IMDS(Instance Metadata Service)"가 AWS/GCP/Azure 특정 기술인데, "인스턴스 메타데이터 서비스"로 번역만 하고 이들(AWS IMDSv2, GCP Metadata Server, Azure IMDS)의 차이를 안 씀.
  - 보강: "AWS/GCP/Azure는 각각 169.254.169.254 엔드포인트를 통해 인스턴스 수준의 IAM 자격증명을 제공하므로(AWS IMDSv2, GCP Metadata Server, Azure IMDS), Pod가 이에 접근하면 노드의 관리 자격증명이 탈취될 수 있다" 명시
- **🟡 MED** `이해난이도` _2. CIS Benchmark 전체_
  - 문제: CIS(Center for Internet Security)가 무엇인지 기관 설명 없음. 학생이 "CIS가 NIST 같은 기관?" "자체 기준?" 헷갈림.
  - 보강: "CIS는 사이버보안 표준을 개발하는 국제 비영리 기관(CISA 권장)으로, Kubernetes CIS Benchmark는 k8s 커뮤니티와 함께 개발한 체크리스트다. 마치 PCI DSS 같은 컴플라이언스 기준처럼 업계 표준이다."
- **🟡 MED** `용어비약` _2.6 kubelet 보안 설정, "anonymous.enabled: false"_
  - 문제: "kubelet API에 인증 없이 접근 가능"이라는 표현이 "API Server 아닌 kubelet이 별도 API를 노출한다"는 뜻을 암시하는데, kubelet이 10250 포트에서 노드 상태를 제공한다는 설명 없음.
  - 보강: "kubelet은 각 워커 노드에서 10250 포트로 노드 상태·Pod 정보 API를 제공한다. anonymous.enabled=true이면 인증 없이 접근 가능해 Pod 보안정책 우회 가능."
- **🟡 MED** `실습재현불가` _3.2 자체 서명 인증서 생성, openssl 명령_
  - 문제: "openssl req -x509 ... -subj /CN=myapp.example.com"은 실제 도메인(myapp.example.com)으로 인증서를 만드는데, 랩 환경(tart 클러스터)에서는 이 도메인이 실제로 라우팅되는가? 아니면 hosts 파일을 수정해야 하나?
  - 보강: "실습 환경에서는 실제 도메인이 필요하지 않음. 대신 Ingress의 host를 CN과 맞추면 된다(예: CN=myapp.example.com이면 Ingress rule의 host도 myapp.example.com). 로컬 테스트는 /etc/hosts에 127.0.0.1 myapp.example.com을 추가하고 curl로 검증."
- **🟡 MED** `맥락점프` _tart-infra 실습 전체_
  - 문제: "과제 1: CiliumNetworkPolicy 기반 Zero Trust 정책 확인"이라는 문제는 앞의 NetworkPolicy 개념(1. 섹션)을 이미 숙지했다고 가정. 그러나 CiliumNetworkPolicy(CRD, L7 필터링)와 표준 NetworkPolicy의 관계를 명시하지 않음.
  - 보강: "CiliumNetworkPolicy는 표준 Kubernetes NetworkPolicy를 확장한 Cilium 전용 리소스로, L3/L4뿐 아니라 L7(HTTP method/path) 필터링도 가능하다. tart 클러스터의 dev는 Cilium을 사용하므로 이 리소스를 활용할 수 있다."
- **🟡 MED** `이해난이도` _tart-infra 과제 3: Istio mTLS 확인_
  - 문제: "Istio PeerAuthentication STRICT 모드", "Envoy 사이드카", "mTLS" 등이 Day 1에서 처음 등장. 앞의 NetworkPolicy와 무관한 별개 기술인데, 병렬 구조로 제시돼 학생이 "이게 NetworkPolicy와 어떤 관계?"라 혼동할 수 있음.
  - 보강: "Part 4: Istio mTLS(심화, 선택)"로 분리하고 헤더에 "NetworkPolicy는 L3/L4 네트워크 격리, Istio mTLS는 L7 애플리케이션 계층 암호화. 두 계층이 함께 작동해 심층방어(defense in depth)를 구성한다"고 명시.

### daily/day02.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `용어비약` _라인 62: NetworkPolicy API 도입_
  - 문제: CNI 플러그인의 정의와 동작 원리 없음. 학생이 Kubernetes 네트워킹의 기초를 모르면 '선언적 네트워크 정책'이 무엇을 필터링하는지 알 수 없음.
  - 보강: 추가: 'CNI(Container Network Interface)는 Pod 생성 시 네트워크 네임스페이스를 연결하고 IP를 할당하는 플러그인 표준이다. NetworkPolicy는 이 CNI의 위에서 트래픽(패킷)을 필터링한다. 예: Flannel은 오버레이 네트워크, Cilium은 eBPF 기반 필터링을 제공한다.'
- **🔴 HIGH** `스토리라인누락` _라인 609-614: 문제 10 풀이 후 핵심 포인트_
  - 문제: '여러 NetworkPolicy는 합집합(UNION)으로 적용됨'만 명시. 왜 UNION인지(allow list 평가 메커니즘), default-deny 이후 어떻게 통신이 되는지의 논리가 없음.
  - 보강: 추가: 'NetworkPolicy 평가는 allow list 방식이다. 매칭 순서: 정책 A, B, C 중 하나라도 트래픽을 허용하면 통과한다(OR/UNION). Default Deny로 모두 차단 후, allow-dns·allow-frontend 등으로 추가하면, 이들 정책의 합집합만 통신 가능해진다. Pod 내부적으로는 rule 평가가 단락(short-circuit)되지 않고 전부 검사된다.'
- **🔴 HIGH** `맥락점프` _라인 293-323: 문제 6, 11 - ipBlock 문법 첫 등장_
  - 문제: 이전 문제 1~5는 podSelector/namespaceSelector만 사용했는데, 문제 6에서 ipBlock이 갑자기 나타남. '왜 이 문법이 필요한가'의 배경이 없음.
  - 보강: 문제 5 또는 문제 6 직전에 추가: 'podSelector/namespaceSelector는 Pod 레벨의 선택만 가능하다. 반면 ipBlock은 IP 대역(CIDR)으로 트래픽을 제어한다. 외부 API, 메타데이터 서버(169.254.169.254) 같은 비Pod 대상을 차단/허용할 때 필수다. 예: 클라우드 IAM 탈취 방지를 위해 메타데이터 서버를 차단한다.'
- **🔴 HIGH** `정확성오류` _라인 152-154: 문제 2 풀이 - DNS 허용 규칙_
  - 문제: 'to: []는 모든 대상을 의미한다 (kube-dns가 어디에 있든 접근 가능)'는 부정확. to: []는 'all namespaces, all pods'를 의미하지만, 실제 DNS는 service IP로 요청되므로 미묘한 차이가 있음.
  - 보강: 정정: 'to: []는 제한(namespaceSelector/podSelector)이 없다는 뜻으로, 모든 IP 대역으로의 트래픽을 허용한다는 의미다. DNS의 경우 kube-dns Service IP(예: 10.96.0.10)로 쿼리가 나가므로 이 규칙으로 충분하다. 만약 특정 Pod/namespace만 allow하고 싶으면 to: [podSelector/namespaceSelector]로 제한한다.'
- **🔴 HIGH** `실습재현불가` _라인 158-209: 문제 3 - kube-bench FAIL 수정_
  - 문제: '매니페스트 수정 후 API Server 자동 재시작'이라 했지만, 정적 Pod의 감지 시간, API Server 다운 중 kubectl 먹통 상황, 디렉토리 생성 권한 등이 명확하지 않아 학생이 실제 실행 중 혼동.
  - 보강: 추가 설명: '1) kube-apiserver는 static pod로, /etc/kubernetes/manifests/ 변경을 kubelet이 감시한다(기본 주기 20초). 2) 매니페스트 저장 후 1~2초 내 컨테이너가 재시작되며, 그 사이 kubectl은 일시 응답 불가 상태다(정상). 3) 디렉토리 생성(`mkdir -p /var/log/kubernetes/audit/`)은 root 권한 필요 - 테스트 클러스터에서는 이미 생성되어 있을 수 있다. 4) 완전 부팅을 확인하려면 `kubectl get nodes` 등 읽기 명령이 성공할 때까지 대기.'
- **🔴 HIGH** `이해난이도` _라인 464-614: 문제 10 - 3계층 정책_
  - 문제: 5개의 정책을 일괄 제시하면서 '왜 이렇게 많은가', '어느 것이 의존하는가', '순서가 중요한가'를 설명하지 않아, 학생이 YAML만 복사·붙여넣음. 정책 간 관계(frontend egress ↔ backend ingress 쌍)가 명확하지 않음.
  - 보강: 풀이 전 주석 추가: '# 네트워크 통신은 양방향 명시가 필수다. \n# frontend → backend: frontend에서 Egress 허용 + backend에서 Ingress 허용 (둘 다 필요). \n# 또한 DNS(53 port)는 모든 Pod가 필요하지만 Default Deny 정책에 갇히므로 별도 allow 정책이 있어야 한다. \n# 정책 순서는 무관(UNION이므로)하지만, 논리적으로 Default Deny → DNS → 비즈니스 규칙 순으로 읽는 것이 자연스럽다.'
- **🟡 MED** `용어비약` _라인 203: kube-bench 풀이 - 정적 Pod_
  - 문제: 'kubelet이 자동 감지'라고만 했는데, static pod의 정의(특수성, 매니페스트 위치, kubelet의 역할)가 한 줄도 없음.
  - 보강: 추가: '(주석) kube-apiserver는 static pod로, /etc/kubernetes/manifests/에 있는 YAML을 kubelet이 자동 감시·실행·복구한다. 매니페스트를 수정하면 kubelet이 컨테이너를 즉시 재시작한다.'
- **🟡 MED** `이해난이도` _라인 318-322: 문제 6 풀이 - ipBlock except_
  - 문제: except 배열 문법이 단일 IP(/32)만 예시. 여러 CIDR를 배제하는 경우(예: metadata IP + private network)는 어떻게 되는지 불명.
  - 보강: 주석: '# except에는 여러 CIDR를 배열로 나열 가능: except: [169.254.169.254/32, 10.0.0.0/8, 172.16.0.0/12]'
- **🟡 MED** `정확성오류` _라인 254: 문제 4 풀이 - Secret과 Ingress 네임스페이스_
  - 문제: 'Secret과 Ingress는 같은 네임스페이스에 있어야 한다'는 맞지만, '왜'인지 설명이 없어 학생이 깊이 있게 이해 못함.
  - 보강: 추가: 'Ingress의 tls.secretName은 자신과 같은 네임스페이스의 Secret만 참조 가능하다. 다른 네임스페이스 Secret을 참조하려면 ServiceAccount/RBAC 설정이 복잡해지므로 실기에서는 같은 네임스페이스에 둔다.'
- **🟡 MED** `맥락점프` _라인 221-225: 문제 4 - TLS Secret 생성_
  - 문제: kubectl create secret tls 명령이 첫 등장하는데, 이 명령이 '뭘 하는 건가' 한 줄 설명도 없음. 학생이 구문만 외움.
  - 보강: 주석 추가: '# kubectl create secret tls <name>은 kubernetes.io/tls 타입 Secret을 생성한다. \n# --cert와 --key 파일을 자동으로 Base64 인코딩해 저장한다.'
- **🟡 MED** `스토리라인누락` _라인 868-889: 7절 - CiliumNetworkPolicy vs 표준_
  - 문제: 'CKS 시험에서는 표준 NetworkPolicy만 출제된다'고 명시했는데, 왜 CiliumNetworkPolicy를 학습하는지(실무 vs 시험 차이) 명확한 구분이 없음. 학생이 혼동 가능.
  - 보강: 명확히: 'CKS 자격증은 표준 K8s NetworkPolicy 문법만 출제된다. 하지만 이 저장소의 tart 클러스터는 실무급 Cilium을 설치했으므로, 실습할 때는 CiliumNetworkPolicy로 동작한다. 이 섹션은 실습 환경을 이해하기 위한 참고일 뿐, 시험 준비는 표준 NetworkPolicy 문법만 외워도 충분하다.'
- **⚪ LOW** `스토리라인누락` _라인 293-296: 문제 6 - 메타데이터 API 차단_
  - 문제: '메타데이터 API를 차단하라'는 과제이지만, '왜 이게 보안 위협인가'의 배경 설명이 없음. Day 1의 Tesla 사례만 있고 여기선 없음.
  - 보강: 추가: '배경: 클라우드(AWS/GCP/Azure)에서 169.254.169.254는 인스턴스 메타데이터 서버로, IAM 임시 크리덴셜을 제공한다. 침해된 Pod가 이 IP에 접근하면 호스트의 클라우드 권한을 탈취할 수 있다.'

### daily/day03.md · 가독성 4/5 · 스토리 4/5 · 미달❌

- **🔴 HIGH** `용어비약` _섹션 3.1, API Server 보안 설정_
  - 문제: 'kubelet의 staticPodPath watcher가 매니페스트 변경을 감지하여 Pod를 자동 재생성'이라는 설명이 staticPod 메커니즘의 사전지식을 가정함. kubelet 데몬이 무엇인지, /etc/kubernetes/manifests는 왜 그 경로인지, static pod와 일반 pod의 차이가 설명되지 않음.
  - 보강: API Server 보안 설정 앞에 '배경' 섹션을 추가: (1) API Server란 Kubernetes의 모든 상태 변경을 처리하는 중앙 진입점(gateway) (2) kube-apiserver 데몬은 control plane 노드에서 static pod로 운영됨 (3) static pod = kubelet 데몬이 직접 /etc/kubernetes/manifests 파일을 감시하고 생성/삭제하는 pod (일반 Pod는 API Server → etcd 경로, static pod는 kubelet만으로 관리) (4) 따라서 static pod 매니페스트를 수정하면 kubelet이 Pod를 재생성한다는 인과관계 표현.
- **🔴 HIGH** `스토리라인누락` _섹션 2.2, ServiceAccount 토큰 자동 마운트 비활성화_
  - 문제: '왜' 기본값이 true(자동 마운트)인지, Pod 입장에서 토큰이 필요한 사례(필요 vs 불필요)가 명확하지 않음. 토큰 비활성화가 '선택'이 아니라 '기본 권장'임을 강조하는 논거 부족.
  - 보강: 섹션 2.2 전에 '배경' 추가: (1) Kubernetes 초기에는 모든 Pod에 자동으로 SA 토큰을 마운트했음(기본값 true) — 이유는 Pod가 언제든지 kube-apiserver를 호출할 수도 있다는 가정 (2) 하지만 대부분의 일반 Pod(웹 서버, 캐시 등)는 kube-apiserver 호출이 불필요함 (3) 불필요한 토큰이 노출되면 공격자가 이를 탈취해 클러스터 API 호출 → 권한 탈취. 따라서 '필요 없으면 꺼라'가 모범 사례 (4) 2.4에서 보여주는 '전용 SA + 필요시에만 마운트'가 정답.
- **🔴 HIGH** `실습재현불가` _섹션 1.7, 권한 확인 명령어와 실습 검증_
  - 문제: 'cap-cks-d03 ns에 GOOD Role/RoleBinding 구성 후 측정'이라는 전제조건이 본 문서에서 제공되지 않음. 독자가 실제로 동일한 결과를 재현하려면 어떤 매니페스트를 먼저 apply해야 하는지 명시되지 않음.
  - 보강: 섹션 1.7 상단에 '준비' 단계 추가: (1) 실습용 네임스페이스와 user/group을 구성하는 전체 YAML을 제시하거나 (2) 섹션 1.4의 pod-reader Role과 read-pods RoleBinding을 정확히 apply한 후 다음 명령을 실행하라는 지시 (3) 또는 '../manifests/rbac/day03-setup.yaml' 같은 외부 파일 경로를 링크.
- **🔴 HIGH** `용어비약` _섹션 1.9, ClusterRole을 RoleBinding으로 범위 제한_
  - 문제: 'ClusterRole을 RoleBinding으로 바인딩'이라는 표현이 모순처럼 들림. ClusterRole은 클러스터 범위인데 RoleBinding(네임스페이스)으로 바인딩하면 어떤 스코핑 규칙이 작동하는지, 결과적으로 왜 네임스페이스 제한이 되는지의 메커니즘이 설명되지 않음.
  - 보강: 섹션 1.9 YAML 전에 '메커니즘' 문단 추가: (1) RoleBinding의 roleRef.kind에는 Role 또는 ClusterRole이 올 수 있음 (2) RoleBinding 자체는 항상 네임스페이스 범위(metadata.namespace 필수) (3) ClusterRole을 RoleBinding으로 바인딩하면, 그 ClusterRole의 정의는 클러스터 전체에 적용되지만, 바인딩 자체는 RoleBinding의 네임스페이스에만 적용됨 (4) 결과: jane은 production 네임스페이스의 Secret만 access 가능, other-ns는 불가 (5) 이것이 권한 재사용(ClusterRole) + 스코핑(RoleBinding)의 조합.
- **🟡 MED** `이해난이도` _섹션 3.2, kubelet 통신 보안 플래그_
  - 문제: '--kubelet-certificate-authority=/etc/kubernetes/pki/ca.crt'가 왜 kubelet 위장 공격을 방지하는지 설명 부족. kubelet은 노드에서 실행되는 에이전트인데, 어떤 시나리오에서 위장될 수 있는지 구체성 부족.
  - 보강: 플래그 설명에 다음 추가: (1) kubelet이 API Server와 통신할 때 전송하는 클라이언트 인증서를 검증해야 함 (2) 없으면 악의적인 프로세스가 kubelet인 척하고 API Server에 요청 가능 (3) --kubelet-certificate-authority는 API Server가 kubelet의 인증서를 검증할 때 신뢰할 CA 인증서를 지정 (4) 예시: 손상된 워커 노드에서 가짜 kubelet이 master pod 조작 시도 → CA 검증으로 차단.
- **🟡 MED** `구조` _섹션 4, 트러블슈팅 시나리오_
  - 문제: 4가지 시나리오 각각의 원인 분석은 좋으나, 각 시나리오가 앞의 1~3섹션 어디와 연관되는지 명시되지 않음(예: 시나리오 1은 1.9와 연관, 시나리오 3은 3.2와 연관). 독자가 개념 학습 후 이 섹션으로 직접 연결하기 어려움.
  - 보강: 각 시나리오 제목에 관련 섹션 번호를 추가: '시나리오 1 [§1.9]: RBAC 권한 수정...', '시나리오 2 [§2.2]: automountServiceAccountToken...' 등으로 역참조 추가.
- **🟡 MED** `정확성오류` _섹션 2.3, JWT 토큰 파싱 실제 출력_
  - 문제: base64 디코딩 과정에서 '일부 클레임 발췌'라고 명시했으나, 실제 그 출력이 현재 시스템의 실제 토큰인지 보증되지 않음. 학생이 자신의 환경에서 재현할 때 다른 클레임(예: aud의 호스트명, exp 시간)이 나올 가능성 높음.
  - 보강: 섹션 2.3 마지막에 주석 추가: '(참고) JWT 클레임의 iss/sub/aud/exp는 클러스터마다 다르며, 본 출력은 특정 시점의 특정 클러스터(cap-cks-d03)에서 캡처한 것이다. 학생의 환경에서는 호스트명, 시간 값(exp/iat)이 다를 수 있으므로 구조만 참조하자.'
- **🟡 MED** `맥락점프` _섹션 3.3, Admission Controller - NodeRestriction_
  - 문제: NodeRestriction의 설명에서 'node-restriction.kubernetes.io/ 접두사'가 갑자기 등장함. 이것이 어느 필드(label, annotation)에 적용되는지, 어떻게 kubelet이 이를 위반하려 하는지 메커니즘이 불분명.
  - 보강: NodeRestriction 설명 확장: (1) kubelet은 자신이 실행 중인 노드(node.status.nodeinfo.nodeName)의 라벨과 에노테이션만 수정 가능 (2) 다른 노드의 라벨을 수정하려 시도하면 API Server가 거부 (3) 특히 node-restriction.kubernetes.io/ 접두사의 라벨/에노테이션은 kubelet이 전혀 수정 불가(control plane 보안용) (4) 예: 손상된 kubelet이 다른 노드에 node-restriction.kubernetes.io/reserved-memory=XXX를 붙이려 해도 거부됨.
- **⚪ LOW** `용어비약` _섹션 1.2, Verbs 목록 설명_
  - 문제: 'verbs: ["get", "list", "watch"]'의 예에서 각 verb의 의미가 간결하게만 나열됨(§1.6에 상세 표가 있으나, 처음 본 학생은 1.2에서 당황할 수 있음).
  - 보강: 섹션 1.2의 verb 설명을 한 줄 확장: 'Verbs: API 동작 단위 — get(단일 조회), list(목록), watch(실시간 감시) 등. 상세는 §1.6'.
- **⚪ LOW** `이해난이도` _실습 섹션 과제 1, demo 네임스페이스 가정_
  - 문제: 'demo 네임스페이스의 Pod들' — 이 namespace가 실제로 존재하는지, 어떤 Pod들이 들어 있는지 사전 설정 없음. 학생이 처음 환경에서는 demo ns가 없을 수 있음.
  - 보강: 과제 1 상단에 '준비' 문단 추가: 'KUBECONFIG를 dev 클러스터로 설정하고, demo 네임스페이스가 없으면 kubectl create ns demo으로 생성한 후, manifests/workload/demo-app.yaml을 apply하여 frontend·backend pod를 미리 배포하자.' 또는 링크 제공.

### daily/day04.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `용어비약` _섹션 4.3 (line 92~163)_
  - 문제: YAML 샘플에서 nonResourceURLs, omitStages, verbs 등 선행 설명 없이 처음 나타남. 학생이 YAML 구조를 모를 때 갑자기 복잡한 정책 파일을 마주침.
  - 보강: 섹션 4.2와 4.3 사이에 'Audit Policy YAML 구조 개요' 추가. apiVersion, kind, rules, resources, verbs, nonResourceURLs, omitStages, userGroups 등을 먼저 설명한 후 실제 YAML을 보여주기.
- **🔴 HIGH** `스토리라인누락` _섹션 5 (kubeadm 업그레이드) 전체_
  - 문제: 배경에서 CVE 위험만 설명하고, '직전 방식(무중단 업그레이드 부재)의 한계', 'drain/uncordon이 왜 필요한가'의 스토리 없음. 절차만 있고 이유가 없음.
  - 보강: 섹션 5.2 직전에 'drain/uncordon의 필요성' 단락 추가: 워크로드가 무중단으로 다른 노드로 이동해야 하는 이유(업그레이드 중 노드 재부팅), 이를 위해 drain은 파드를 gracefully terminate하고 uncordon은 스케줄링을 다시 허용함을 설명.
- **🔴 HIGH** `맥락점프` _섹션 4.5 (line 251-260) + 섹션 4.4 (적용 절차)_
  - 문제: 검증 섹션에서 '현재 audit-policy가 적용돼 있지 않아 실측 불가'라고 했으나, 학생은 어떤 순서로 이를 확인하는지 명확하지 않음. 적용 절차(4.4)와 검증 절차(4.5)의 연결이 끊어짐.
  - 보강: 섹션 4.4의 적용 절차를 명확한 8단계로 재구성: 1.Policy파일생성 → 2.로그디렉토리생성 → 3.API Server 매니페스트 수정 → 4.API Server 재시작 확인(watch crictl ps) → 5.kubectl get nodes로 정상성 확인 → 6.검증 명령 실행(kubectl get secret) → 7.로그 확인(tail -1 ... | jq) → 8.기대 출력 형태. 그리고 '현재 이 교재용 dev/staging 클러스터는 audit-policy가 미적용되어 있으므로, 학생이 직접 4.4 절차를 따라 적용 후 4.5를 수행해야 한다'는 명시 필요.
- **🔴 HIGH** `실습재현불가` _섹션 4.4 (line 203~207, hostPath 볼륨 마운트)_
  - 문제: volumeMounts의 mountPath: /etc/kubernetes/audit-policy.yaml 는 파일 직접 마운트인데, 일반적 K8s hostPath 마운트는 디렉토리만 지원. subPath가 없으면 작동 불확실. 또한 --audit-policy-file 경로와 불일치 가능성.
  - 보강: volumeMounts를 수정: mountPath: /etc/kubernetes/ (디렉토리로 변경). 그리고 --audit-policy-file=/etc/kubernetes/audit-policy.yaml 로 유지. 또는 'mountPath는 디렉토리를 마운트하고, API Server 플래그에서 정확한 파일 경로를 명시한다'는 주석 추가.
- **🔴 HIGH** `정확성오류` _섹션 5.2 (line 331, 356)_
  - 문제: apt-get install -y kubeadm=1.31.x-* 의 와일드카드 * 사용. 실제 명령은 kubeadm=1.31.1-00 같이 구체적 버전 지정이 필요. 학생이 복사-붙여넣기하면 '패키지 찾을 수 없음' 오류 발생.
  - 보강: kubeadm=1.31.x-* 를 kubeadm=1.31.1-00 형식으로 변경하거나, 상단에 '실제 클러스터의 현재 K8s 버전을 확인 후 1.31.x 를 해당 버전으로 바꾸어 실행하세요. 예: kubeadm=1.31.14-00' 주의문 추가.
- **🔴 HIGH** `용어비약` _섹션 4.3 라인 166-182 (규칙 매칭 원리)_
  - 문제: '첫 번째 매칭되는 규칙이 적용된다'는 설명은 있지만, '왜 순서가 중요한가'에 대한 직관이 부족. kube-scheduler 예제에서 '규칙 5보다 규칙 2가 먼저이므로 기록됨'이라는 결론만 있고, 그 원리(규칙 2의 Pod 조건이 먼저 매칭되어 규칙 5의 제외 조건이 무시됨)가 불명확.
  - 보강: 라인 179-182 예제 아래에 명시적 설명 추가: '만약 규칙 5(시스템 컴포넌트 제외)가 규칙 2(pods)보다 위에 있었다면, kube-scheduler의 Pod GET은 규칙 5에서 먼저 매칭되어 None으로 기록되지 않는다. 따라서 구체적인 리소스 규칙(rules[1~4])보다 일반 규칙(rules[5~7])을 **반드시 아래에** 배치해야 한다.'
- **🟡 MED** `맥락점프` _섹션 6 (kubeconfig 보안 관리) 전체_
  - 문제: 갑자기 3줄짜리 bash 명령만 나옴. '왜 kubeconfig에 민감 정보가 들어있는가', '파일 권한을 600으로 해야 하는 이유(프로세스간 격리)', 'context/cluster/user를 정리해야 하는 이유'의 스토리가 전무.
  - 보강: 섹션 6 제목 아래에 '배경' 단락 추가: 'kubeconfig는 API Server 인증서, 사용자 토큰, 클라이언트 키 등 민감 정보를 평문으로 담고 있다(client-key-data, token). 동일 머신의 다른 프로세스나 사용자가 접근하면 클러스터 관리 권한 획득 가능. 따라서 파일 권한은 600(소유자 read/write만)으로 제한해야 한다.' 그 후 명령 5~6개를 순서대로 보여주기.
- **🟡 MED** `이해난이도` _섹션 4.1 라인 53~61_
  - 문제: '구조화된 감사 이벤트(audit event)를 생성하는 메커니즘'이라는 표현이 추상적. 이벤트가 정확히 무엇이고, JSON 형태인지, 어디에 저장되는지 불명확. 학생이 Audit Policy 결과물을 상상할 수 없음.
  - 보강: 섹션 4.1 직후에 '감사 이벤트 형식' 소제목을 추가하여 실제 audit log 라인 1개를 JSON 형태로 보여주기(예: {verb, user, objectRef, timestamp, ...}). 그리고 '--audit-log-path로 지정한 파일에 이런 이벤트들이 줄단위로 기록된다'고 설명.
- **🟡 MED** `스토리라인누락` _섹션 4.0 (line 19~45) 끝부분_
  - 문제: 'K8s v1.7 (2017): Audit Policy API 도입'까지는 있지만, 'Audit Policy가 모든 요청을 감사하려고 할 때 로그 볼륨을 어떻게 제어하는가'라는 다음 단계의 필요성 설명 없음. 그래서 4단계 레벨(None/Metadata/Request/RequestResponse)이 왜 필요한지의 배경 불명.
  - 보강: 섹션 4.0의 마지막 단락(공격-방어 매핑 직전)에 추가: 'Audit Policy의 도입으로 모든 API 요청을 기록할 수 있게 되었으나, 초기에는 모든 요청을 최고 수준으로 기록하면 로그 파일이 초당 GB 단위로 증가하는 문제가 발생했다. 따라서 리소스와 사용자 조건별로 기록 수준을 세밀하게 제어하는 규칙 기반 정책이 필요했다.'
- **🟡 MED** `구조` _파일 상단 (line 1~15)_
  - 문제: 이 파일이 CKS 커리큘럼 전체 14개 day 중 어디에 위치하는지 표기 없음. day04가 보안의 시작인지, 중간인지, 거의 끝인지 학생이 모름. 이전/이후 학습과의 연결도 불명.
  - 보강: 파일 최상단 header(line 4) 직후에 한 줄 추가: '이전: Day 3 RBAC 심화 / 이후: Day 5 AppArmor & seccomp / CKS 전체 14 day 중 4주차 Cluster Hardening(II)' 형식으로 학습 위치 명시.
- **🟡 MED** `용어비약` _섹션 7.2 (실전 문제 1~11)_
  - 문제: 모든 문제가 '어느 클러스터에서 수행하는가'를 명시하지 않음. 또한 문제 1 (RBAC)은 dev에서, 문제 4 (Audit)는 staging에서 해야 할 수도 있는데 구분 없음.
  - 보강: 각 문제 제목 옆이나 맨 처음에 클러스터 표기 추가. 예: '문제 1 (dev 클러스터): RBAC 과도한 권한 축소', '문제 4 (staging 클러스터): Audit Policy 작성 및 적용' 형식. 그리고 섹션 7.2 첫머리에 '다음 문제들은 dev 클러스터(파괴 실험 허용)를 기준으로 하며, Audit Policy 적용(문제 4, 8)은 staging 클러스터에서 수행할 것을 권장한다' 주의문 추가.

### daily/day05.md · 가독성 4/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `용어비약` _1.1 AppArmor 아키텍처, 2.1 seccomp 커널 메커니즘_
  - 문제: LSM(Linux Security Module), BPF(Berkeley Packet Filter), POSIX capability 등 핵심 용어가 괄호 영문명만 제시되고, 각각이 '커널의 보안 플러그인 구조', '커널 내 가상 머신' 같은 직관적 설명이 없음. 학부생이 처음 접하면 개념이 뜬구름 같을 가능성.
  - 보강: 각 용어 첫 등장 시 한 문장 직관 추가: 'LSM = 커널에 보안 정책(AppArmor, SELinux)을 플러그인 형태로 등록하는 프레임워크. 프로세스가 시스템콜(open, write 등)을 호출할 때마다 LSM hook 지점에서 해당 프로파일의 규칙을 확인해 허용/차단 판정', 'BPF = 커널 내에서 안전하게 실행되는 작은 가상 머신. seccomp 프로파일을 BPF 바이트코드로 컴파일해 커널이 시스템콜마다 빠르게 필터링', 'Capability = root 권한을 세분화한 단위(예: CAP_NET_RAW는 raw 소켓, CAP_SYS_ADMIN은 시스템 관리)로, 프로세스가 특정 권한만 가지도록 제한'.
- **🔴 HIGH** `스토리라인누락` _섹션 1(AppArmor)과 섹션 2(seccomp) 사이_
  - 문제: AppArmor(경로 기반 파일/네트워크 제어)와 seccomp(시스템콜 필터링)의 관계, 왜 둘 다 필요한가가 명확하지 않음. 학생이 '이미 AppArmor로 네트워크 제어하는데 seccomp는 왜?'라고 의문을 품을 수 있음.
  - 보강: 2.0 섹션 추가: 'seccomp가 필요한 이유 - AppArmor의 한계\n AppArmor는 파일/네트워크 경로에 기반하지만, 위험한 시스템콜(mount, ptrace, unshare)은 경로 기반으로는 제어할 수 없다. 예: mount 시스템콜은 임의의 경로를 인자로 받으므로 AppArmor deny /path/**로 차단이 불가능. seccomp는 시스템콜 번호 자체를 필터링하므로, mount 시스템콜 호출 자체를 차단할 수 있다. 따라서 AppArmor(파일/네트워크)와 seccomp(시스템콜) 두 계층이 필요.' 그리고 비교표: AppArmor=경로 기반, 쓰기/읽기/네트워크 타입 제어 vs seccomp=시스템콜 번호 기반, 시스템콜 자체 차단/허용.
- **🔴 HIGH** `실습재현불가` _1.4 프로파일 1(k8s-deny-write), 1.7 실습 검증_
  - 문제: 프로파일 1에서 'deny /** w'가 있는데, 아래 '/tmp/** rw' 예외가 실제로는 작동하지 않음을 1.7의 주석으로만 설명('실측으로 확인'). 학생이 이 프로파일을 그대로 따라 쓰면 /tmp에도 쓸 수 없어서 실습이 깨짐. 올바른 해결책('deny 없이 필요한 경로만 rw, 나머지는 명시 안 함')이 프로파일 2·3에서는 반영되는지 명확하지 않음.
  - 보강: 1.4 프로파일 1의 규칙 평가 순서 명확화: 주석에 'AppArmor는 deny 규칙이 allow 규칙보다 우선. 따라서 deny /** w가 있으면 /tmp/** rw로도 오버라이드 불가. /tmp만 허용하려면 아래처럼 수정:' 후 정정된 코드 제시. 그리고 프로파일 2·3 전에 '프로파일 1 (실습용 수정)' 섹션 추가하여 완전히 작동하는 예제 제시.
- **🔴 HIGH** `이해난이도` _2.5 커스텀 seccomp 프로파일 - 허용 목록 방식_
  - 문제: strict.json의 syscalls 배열에 약 70개 시스템콜을 나열. 학생이 '이걸 처음부터 다 외워서 쓴다는 건가?'로 착각. 실제로는 컨테이너 로그 분석으로 필요한 콜을 파악하는 반복 과정이 일반적인데, 그 방법론이 없음.
  - 보강: 2.5에 '실무 워크플로우' 추가: '보통 RuntimeDefault로 시작한 뒤, 애플리케이션 실행 시 차단되는 시스템콜을 dmesg/audit 로그로 찾아서 allowlist에 추가하는 방식. strict.json은 참고 예제일 뿐, 각 애플리케이션마다 맞춰 작성. 다음 명령으로 필요한 콜을 파악: sudo ausearch -m seccomp --field auid=[uid] | grep DENIED | grep syscall | cut -d= -f8 | sort -u' 와 같은 실전 명령 추가.
- **🟡 MED** `정확성오류` _1.7 커널 로그 예시, 2.7 Seccomp 상태 확인_
  - 문제: (미실측)이라고 명시하면서도 출력 텍스트(audit 로그 형식, Seccomp: 2 값)를 그대로 삽입. 학생이 '저게 실제로 이런 형식으로 나온다'고 착각할 가능성. 미실측인 경우 형식 예시를 명확히 구분하거나 빼야 함.
  - 보강: (미실측) 섹션의 출력은 형식만 '⚠️ 형식 참고용 예시(실제 환경에서는 다를 수 있음):'로 마크업 후 제시. 또는 완전히 빼고 '실제로 이런 형식으로 나옵니다'라는 텍스트만. 학부 3~4학년 강의 지침상 미실측은 명시하고, 텍스트 대신 실제 스크린샷만 사용(CLAUDE.md §4①).
- **🟡 MED** `맥락점프` _섹션 3 불필요한 패키지 제거, 섹션 4 커널 파라미터 보안_
  - 문제: AppArmor/seccomp(세밀한 런타임 제어)를 배운 뒤 갑자기 systemctl/dpkg/SUID 같은 노드 레벨 강화(패키지 제거, 모듈 비활성화)로 넘어감. 두 접근의 관계가 설명되지 않아 학생이 '이게 AppArmor/seccomp와 어떤 차이인가?'를 이해 못 함.
  - 보강: 섹션 3 서두에 '계층적 방어 원칙' 설명 추가: 'AppArmor/seccomp는 컨테이너/파드 레벨 제어인데, 노드 자체가 변조되면 무의미. 따라서 노드 수준에서도 공격 표면을 줄여야 한다. 예: cups 데몬이 실행 중이면 AppArmor 프로파일과 상관없이 cups 네트워크 포트의 취약점이 존재. 그래서 불필요한 서비스/패키지를 제거(심화 방어)한다.' 그리고 '이 섹션은 CKS 시험 가중치 낮음(15%중 일부)이고, 시간 제약에서는 AppArmor/seccomp 완벽한 숙달이 우선'이라고 명시하여 학습 순서 안내.
- **🟡 MED** `구조` _섹션 5 트러블슈팅_
  - 문제: 4가지 시나리오만 나열. 실제 시험 문제는 '왜 Pod 생성이 실패하는가?'의 원인이 다층적(프로파일 미로드 + nodeName 누락 + YAML 문법 오류 혼합). 단일 원인 시나리오만으로는 학생이 실전 문제를 풀 때 디버깅 경로를 모름.
  - 보강: 디버깅 플로우차트 추가: 'Pod CreateContainerError → kubectl describe pod events로 에러 메시지 확인 → 'cannot enforce AppArmor' 라면 해당 노드에 aa-status 확인 + nodeName 체크; 'cannot load seccomp' 라면 /var/lib/kubelet/seccomp/ 경로와 localhostProfile 상대경로 확인; 'unexpected file format' 라면 YAML 문법 점검(들여쓰기, 따옴표)' 같은 이분법적 결정트리 추가. 그리고 '멀티컨테이너 파드에서 일부 컨테이너만 프로파일 적용' 같은 실전 예제 추가.
- **⚪ LOW** `이해난이도` _2.4 RuntimeDefault 적용 YAML_
  - 문제: Pod 레벨 vs 컨테이너 레벨 seccompProfile 설정 메커니즘이 주석으로만 설명. 학생이 '어디에 써야 하나?'를 헷갈릴 수 있음.
  - 보강: YAML 예제를 두 가지로 분리: '예제 2.4a: Pod 레벨(모든 컨테이너 적용)', '예제 2.4b: 컨테이너 레벨(선택적 적용)'. 그리고 '쿠버네티스는 컨테이너 설정이 Pod 설정을 오버라이드. 따라서 일관성을 위해 Pod 레벨에서 기본값을 정하고, 특이 컨테이너만 컨테이너 레벨에서 override하는 패턴 권장'이라고 명시.

### daily/day06.md · 가독성 2/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `스토리라인누락` _섹션 5 전체 (시스템콜, capabilities)_
  - 문제: 등장 배경이 완전 부재. 왜 seccomp가 필요한가(컨테이너 이스케이프 공격), 왜 capabilities가 생겼나(UNIX root all-or-nothing 권한 모델의 한계), 직전 기술(PSP, seccomp RuntimeDefault만)의 한계가 무엇인가 설명 없음. 학생이 "그냥 이렇게 한다" 수준의 암기만 가능.
  - 보강: 섹션 5.0 직전에 "등장 배경" 소제목 추가: (1) 컨테이너 이스케이프 사례 1~2개(실제 CVE 또는 공격 시나리오, 예: DirtyCow → 커널 익스플로잇, ptrace 악용 → 인접 프로세스 메모리 접근); (2) 이전엔 무엇이었나(PSP는 정책만 있고 seccomp 없었음), 한계(규칙 관리 복잡, 과도한 권한 필요); (3) seccomp+AppArmor+capabilities 조합이 무엇을 보완하는가(계층화). 각 기법별로 "공격 시나리오 예시" 추가(예: mount syscall 차단 vs /etc/shadow 경로 차단).
- **🔴 HIGH** `용어비약` _섹션 5.0 seccomp BPF 필터 설명_
  - 문제: "seccomp BPF 필터 검사 — 시스템콜 번호 기반으로 ALLOW/DENY 판정"만 있고, BPF(Berkeley Packet Filter) 자체가 뭔지, 왜 BPF를 썓는지(효율성·커널 모드 실행) 설명 없음. 학생이 용어만 본다.
  - 보강: 한 문장 추가: "BPF는 커널 내 가상머신에서 실행되는 특수 바이트코드 형식으로, seccomp은 BPF를 이용해 시스템콜 진입 전에 (사용자공간 스위치 없이) 커널 내에서 빠르게 검사한다. 덕분에 오버헤드가 낮다."
- **🔴 HIGH** `맥락점프` _파일 시작, 섹션 1~4 설명 부재_
  - 문제: Day 06 = "System Hardening (2/2)"이라고 했는데, Day 05의 내용이 무엇인지 명시 없음. 학생이 이 문서만 열면 "앞부분이 있구나"만 알고, 선행 학습 필요 여부를 못 판별. CLAUDE.md에는 "daily N은 daily N-1의 무엇을 전제하는지 첫머리에 한 줄" 규칙이 있는데 미적용.
  - 보강: Day 06 시작 전에 "선수조건" 섹션 추가: "Day 05에서 AppArmor 프로파일 기초(프로파일 작성·enforce/complain 모드)를 배웠다고 가정한다. 본 Day는 seccomp·capabilities·서비스 강화를 추가로 다루며, 세 기제를 조합한 다층 방어가 핵심이다." 또는 Day 05로의 링크 제공.
- **🔴 HIGH** `맥락점프` _섹션 5.0, AppArmor flags=(attach_disconnected,mediate_deleted)_
  - 문제: 프로파일 작성 예제에 flags 파라미터가 있지만, 이게 무엇인지 설명 전혀 없다. 학생이 "복사 붙여넣기"만 한다. attach_disconnected = disconnected 프로세스도 프로파일 적용, mediate_deleted = 삭제된 파일도 추적 의도를 모름.
  - 보강: AppArmor 프로파일 예제 직후 주석 추가: "flags=(attach_disconnected,mediate_deleted): 컨테이너 환경에서 프로파일을 강제하기 위한 플래그. attach_disconnected는 chroot/namespace 후에도 프로파일을 적용하고, mediate_deleted는 삭제된 파일(여전히 프로세스가 쓰는) 접근도 검사하도록 함."
- **🔴 HIGH** `스토리라인누락` _섹션 5.2, Linux capabilities 개요_
  - 문제: "capability가 root 특권을 세분화한 것"은 나오지만, 왜 이게 중요한가(최소권한 원칙) 및 트레이드오프(drop ALL 후 필요한 것만 add하면 복잡도 증가, 실수하면 앱 동작 불가)가 없다.
  - 보강: 섹션 5.2 도입에 "트레이드오프" 문단 추가: "Linux capabilities는 모든 root 권한을 포기하고(drop ALL) 필요한 것만 선택적으로 부여(add)한다는 '최소권한 원칙'을 실현한다. 대신 애플리케이션에 정확히 어떤 capability가 필요한지 미리 파악해야 하며, 부족하면 앱이 실행 불가(예: nginx가 80번 포트에 bind 실패), 초과하면 보안 이득이 없다."
- **🟡 MED** `실습재현불가` _섹션 7.1~7.2 실습, 문제 1~11 풀이_
  - 문제: 노드 SSH 접근(ssh node01, ssh admin@dev-worker) 명령이 당연하게 나오지만, 이 저장소의 클러스터 환경(kubeconfig 위치, SSH 키 배포, 노드명 약칭 설정)에 대한 "환경 준비" 섹션이 없음. 다른 환경에서 이 문서를 읽는 학생은 따라할 수 없음.
  - 보강: 섹션 0 또는 "실습 준비" 추가 (CLAUDE.md와 연동): "이 실습은 tart 멀티클러스터 환경(4개 클러스터: platform, dev, staging, prod)을 전제한다. (1) kubeconfig 설정: export KUBECONFIG=kubeconfig/dev.yaml; (2) SSH 접근: ~/.ssh/config 에 tart 별칭 설정됨 (scripts/setup-ssh-keys.sh 로 관리), ssh dev-master/dev-worker 로 직접 접근 가능; (3) 클러스터 가동: ./scripts/boot.sh 후 ./scripts/fix-cluster-ip-drift.sh dev 로 재부팅 후 IP 재설정." 또는 CLAUDE.md [3절](../CLAUDE.md#3-실행-환경) 링크.
- **🟡 MED** `정확성오류` _문제 1 검증 결과 (섹션 6.2, 문제 1)_
  - 문제: "kubectl exec secure-app -- touch /proc/test 2>&1 # Permission denied"는 실제로 이 에러가 나오는지 미검증(스크린샷 부재, CLAUDE.md §4① 규칙 미적용). 실제로는 "Read-only file system", "Operation not permitted" 등 다양한 에러가 가능. 학생이 다른 에러를 보면 자신이 잘못했다고 착각 가능.
  - 보강: CLAUDE.md §4①: 실제 tart 클러스터에서 명령 실행 후 실제 터미널 스크린샷 이미지를 캡처해 "![검증: AppArmor deny /proc write](images/day06-apparmor-deny-proc.png)" 형태로 삽입. 출력을 ```text 블록으로 대체하지 말 것. 현재 에러가 정확히 무엇인지 명시하고, 다른 에러가 나왔을 때 '무엇이 다른가'를 설명.
- **🟡 MED** `정확성오류` _문제 3 풀이, localhostProfile 경로 (섹션 6.2, 문제 3)_
  - 문제: "localhostProfile은 /var/lib/kubelet/seccomp/ 기준 상대 경로이다"는 설명은 있지만, 실제로 (1) 파일을 어디에 놓아야 하는지(절대경로: /var/lib/kubelet/seccomp/profiles/custom.json), (2) Kubernetes API에서 수용하는 경로 형식(상대경로 profiles/custom.json 또는 절대경로 /var/lib/kubelet/seccomp/profiles/custom.json인지)이 명확하지 않음.
  - 보강: 문제 3 풀이에 "경로 규칙" 명확화 추가: "seccomp 프로파일은 (1) 노드 파일시스템의 /var/lib/kubelet/seccomp/ 디렉터리에 저장되고, (2) Pod YAML의 localhostProfile은 이 디렉터리 기준 상대경로(예: profiles/custom.json)를 지정한다. 결과: 노드에 /var/lib/kubelet/seccomp/profiles/custom.json 이 실제로 존재해야 한다. ssh 노드 접근 후 파일 존재 확인: ls -l /var/lib/kubelet/seccomp/profiles/custom.json"
- **🟡 MED** `이해난이도` _섹션 5.0 시스템콜 처리 과정 (x86_64 SYSCALL, sys_call_table, 핸들러 함수)_
  - 문제: CPU x86_64 SYSCALL 인스트럭션, sys_call_table 수열, 핸들러 함수 같은 용어는 컴퓨터구조/OS 강좌(3학년 2학기) 선수지식 가정. 그 강좌를 안 들은 학생(또는 까먹은 학생)이 "아, 커널이 그렇게 동작하는구나" 이해에 막힐 수 있음.
  - 보강: 섹션 5.0을 2단계로 분할: (1) "보안 검사 흐름 (간단히)" — 1줄 직관: "프로세스가 시스템콜 호출 → 커널이 여러 보안 검사(seccomp, LSM, capability, DAC)를 통과하는지 확인 → 통과하면 실행, 아니면 거부"; (2) "심화: 커널 메커니즘" (선택학습) — 현재 수준의 SYSCALL·sys_call_table 설명 (OS 강좌 참조 링크 제시).
- **🟡 MED** `이해난이도` _섹션 5.2 capability 비트 (0x400 = 1024 = 2^10)_
  - 문제: 16진 바이너리 연산(2^10 = 1024)을 학생이 못 하면 0x400이 왜 CAP_NET_BIND_SERVICE(비트 10)인지 직관을 못 얻음. "암기하라"만 가능.
  - 보강: 이 계산을 캡하지 말고 검증 명령으로 자동 처리: "실제 capability 값을 확인하려면 capsh --decode로 16진수를 이름으로 자동 변환하는 것이 실무다(§5.3의 capsh --decode=0x400 예시는 좋음). 손으로 계산할 필요 없다." 명시 추가.
- **🟡 MED** `실습재현불가` _문제 8 풀이, SSH 노드 접근 (섹션 6.2, 문제 8)_
  - 문제: "ssh node01 → find / -perm -4000 -type f"는 실행 시간이 길어(전체 파일시스템 스캔) 시험 상황에서 비현실적. 학생이 실제로 따라하면 "이게 효율적인가?" 의문 생김.
  - 보강: 명령 개선: "find / -perm -4000 -type f 2>/dev/null | head -20" 또는 "find /usr/bin /usr/sbin -perm -4000 -type f" (자주 쓰는 경로만 검색). 또는 주석: "프로덕션에서는 find 범위를 /usr, /bin, /sbin 등으로 제한하고, 평시 모니터링(예: aide)으로 SUID 바이너리 변화를 추적한다."
- **🟡 MED** `스토리라인누락` _섹션 6.1 출제 패턴 분석_
  - 문제: "AppArmor·seccomp·서비스 제거·sysctl이 시험에서 어떻게 나오는가"는 나오지만, 시험 시간(120분)과 문제 당 소요시간(약 8분/문제) 내에 위 4개를 모두 실행하는 것이 현실적인지(난이도·시간 배분) 설명 없음. CKS 자격증 시간 압박이 핵심인데 미언급.
  - 보강: 섹션 6.1 말미에 "시험 전략" 추가: "CKS 실기는 120분에 15~20개 문제를 풀어야 하므로 문제당 6~8분이다. AppArmor 프로파일 작성은 (SSH 접근·파일 작성·파서 실행) 포함 약 3~4분, seccomp는 약 2~3분, 서비스 비활성화는 약 1분이다. 따라서 대부분의 문제는 AppArmor·seccomp 중 하나만 출제되며, 둘 다 요구하는 문제는 드물다. 실습할 때는 둘 다 능숙하게 하되, 시험에서는 손 속도를 우선한다."
- **⚪ LOW** `구조` _문제 1~11 제목 형식_
  - 문제: 문제 1~11이 제목 수준(###)이 아니라 ###으로만 표기되어, 전체 구조(섹션 6.2의 부제 위치)가 불명확. 목차 생성 시 계층이 뭉친다.
  - 보강: 각 문제를 "### 문제 1" 대신 "#### 문제 1"로 변경하거나, 또는 "## 6.2 실전 문제" 직후 "### 유형 A: AppArmor" → "#### 문제 1. AppArmor 프로파일.." 형태로 재구성해 섹션화.

### daily/day07.md · 가독성 3/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `용어비약` _1.0, 1.1절 PSP 설명_
  - 문제: RBAC와 PSP의 결합 관계를 언급('복잡한 인가 모델')하지만, 왜 PSP가 RBAC와 얽혀 있는지, 어떻게 우선순위가 애매한지 설명 전무. 학생은 '뭐가 복잡하다는 거지?'라고 혼란
  - 보강: PSP 선택 메커니즘(사용자/SA 권한 → matching PSP → 다중 PSP 충돌 시 예측 불가)을 플로우차트 또는 구체 예시(ex: SA-A는 PSP-1,2,3 중 어느 걸 받나? → 구현이 'first match' 또는 'least restrictive'인데 명시 안 됨)로 보충
- **🔴 HIGH** `용어비약` _2.1절 fsGroup 설명_
  - 문제: fsGroup: 2000을 '볼륨의 파일 GID'라고만 했는데, (1) 누가(kubelet?) GID를 변경하는가 (2) 어느 볼륨에만(emptyDir/PVC/hostPath?) 적용되는가 (3) 컨테이너 내 기존 파일도 변경되는가 불명확. CLAUDE.md 기준 '학부 3~4학년이 무엇인지 몰라 스톱'할 지점
  - 보강: 구체 메커니즘: '(1) kubelet이 Pod 시작 시 emptyDir/PVC 마운트 지점의 메타데이터를 fsGroup 값으로 재귀 chown하고, (2) hostPath/configMap은 제외되며(소유자 유지), (3) 이미 존재하는 파일도 변경됨(init 비용 발생)'. 실습 명령어(stat로 확인)까지 추가
- **🔴 HIGH** `용어비약` _3.1절 OPA Gatekeeper 개요_
  - 문제: violation[] 규칙이 Rego에서 뭔지 설명 없음. [ ]이 배열 리스닝인지, Rego의 특수 문법인지 학생 입장에선 불분명. 또한 '각 위반마다 violation[] 집합에 추가'하는 로직 흐름이 불명확
  - 보강: Rego 입문: 'violation[{msg: ...}]는 Rego의 rule set(선언적 규칙). 조건을 만족하는 input마다 violation 집합에 요소를 추가한다. 예를 들어 컨테이너 3개가 있으면 3개의 {msg} 객체가 violation 집합에 들어감'. 간단한 Rego 예시(count/any/all 기본 함수) 추가
- **🔴 HIGH** `용어비약` _3.2 ConstraintTemplate 예제 코드_
  - 문제: startswith_any, sprintf 등이 Rego 표준함수인지 확인 불가능. 학생이 복사 후 '함수 없음' 에러 시 디버깅 불가능
  - 보강: Rego 함수 출처 표기: '# sprintf, startswith는 Rego 빌트인 함수(Rego v0.x+). OPA 공식 docs: https://www.openpolicyagent.org/docs/latest/...'. 또한 initContainers 체크도 있으니 'input.review.object.spec.initContainers[_]' 문법 설명(배열 모든 요소 순회) 추가
- **🔴 HIGH** `용어비약` _4.1절 Secret 암호화_
  - 문제: base64는 '인코딩'이고 암호화가 아니라고 했는데, 왜 이 차이가 중요한지 위협 수준이 모호. '누구나 base64 -d로 복호화 가능'이라는 문제의 심각성이 학생에게 와닿지 않음
  - 보강: 위협 모델 구체화: '(1) etcd에 base64 저장 → SSH/백업 탈취 시 즉시 원문 복원 (2) Kubernetes audit log도 Secret 값을 base64로 기록 → API 서버 로그 유출 시 노출 (3) 따라서 etcd/logs 접근 제어와 함께 암호화 필수(방어 심화)'. 실제 공격 시나리오(예: etcd 직접 마운트로 Secret 탈취 시도)까지
- **🔴 HIGH** `용어비약` _4.3절 etcdctl 검증 명령_
  - 문제: --cacert/--cert/--key 3개 인증서의 용도(client cert TLS mutual auth? 아니면 etcd peer cert?)가 설명되지 않음. 복사만 해서는 동작 보장 불가능
  - 보강: etcd mTLS 설명: '--cacert: etcd CA 인증서(서버 인증 검증용), --cert/--key: etcdctl client 인증서(etcd가 클라이언트 검증)'. /etc/kubernetes/pki/etcd에서 ca.crt(CA), server.crt/key(etcd 서버), healthcheck-client.crt/key(클라이언트) 구분 설명. 또한 실제로 이 키들이 클러스터에 존재하는지 노드 SSH에서 확인하는 명령(ls -la /etc/kubernetes/pki/etcd) 추가
- **🔴 HIGH** `용어비약` _5.2절 gVisor 공격표면_
  - 문제: '호스트 커널에 전달되는 시스템콜이 약 70개로 축소'라고 했는데, 어떤 시스템콜이 필터링되는지 예시 없음(open/read는? fork/mmap은? IPC는?). 학생은 '70개가 많은가 적은가?'도 판단 불가
  - 보강: 구체 필터링: 'gVisor Sentry는 ~400개 Linux 시스템콜 중 필터링하여, open/read/write/mmap 등 필수 파일 연산만 통과시키고, clone(fork)/ptrace/mount/reboot 등 위험 시스템콜은 차단. 결과 호스트 커널로 가는 호출이 10-20개 수준으로 축소(대부분 메모리/파일 I/O)'. gVisor architecture diagram(커널 에뮬레이션 레이어) 추가
- **🔴 HIGH** `용어비약` _5.1절 gVisor Sentry 메커니즘_
  - 문제: 'Sentry 컴포넌트가 컨테이너의 시스템콜을 인터셉트'라고만 했는데, 메커니즘이 불명확. seccomp으로 하는가? ptrace로 하는가? 새로운 메커니즘인가?
  - 보강: gVisor 인터셉트 방식 설명: 'Sentry는 별도 사용자공간 프로세스로, 컨테이너를 ptrace(또는 KVM)로 모니터링. 컨테이너의 모든 시스템콜을 가로채서 사용자공간에서 에뮬레이션한 후, 필요한 호스트 시스템콜만 선별해 호출. 성능 오버헤드는 ptrace 컨텍스트 스위칭과 에뮬레이션 비용에서 발생(일반 명령은 10-30% 느림, 시스템콜 집약적은 50% 이상)'. runsc strace 명령 추가
- **🟡 MED** `스토리라인누락` _2.1 → 2.2 (allowPrivilegeEscalation → readOnlyRootFilesystem)_
  - 문제: allowPrivilegeEscalation: false에서 'no_new_privs' 설명 후 갑자기 '불변 컨테이너 패턴'으로 점프. 중간에 readOnlyRootFilesystem과의 연계, 왜 이 둘을 함께 써야 하는지의 스토리가 끊김
  - 보강: 보안 심화층 구조 명시: '(1) allowPrivilegeEscalation: false → setuid/setgid 실행 차단(권한상승 루트 1개 닫음) (2) readOnlyRootFilesystem: true → /bin, /lib 등 시스템 바이너리 수정 불가(post-exploitation 악성코드 주입 차단) (3) 둘을 함께 써야 root 권한도 못 얻고, 얻어도 쓸 바이너리도 없는 완전 격리. 예: 공격자가 컨테이너 진입 → setuid 비트 바이너리로 권한상승 시도 실패 → /tmp(emptyDir)에만 접근 가능 → 피해 최소화'. 트레이드오프도 명시(readOnly로 인한 로그/캐시 마운트 비용)
- **🟡 MED** `스토리라인누락` _3.1 → 3.2 (PSS vs Gatekeeper)_
  - 문제: OPA Gatekeeper가 ValidatingAdmissionWebhook라고만 했는데, PSS(Pod Security Admission, built-in controller)와의 차이를 명시하지 않음. 학생은 '보안 정책이 2종인가? 뭘 써야 하나?' 혼란
  - 보강: PSS vs Gatekeeper 비교표: '| 항목 | PSS | Gatekeeper | --- | Pod 보안 규칙 제한(privilege/capability 차단) | Gatekeeper로 커스텀 정책(비용/이미지/라벨 검증) | 도입 난도 | 낮음(라벨만 붙임) | 높음(Rego 학습) | 성능 오버헤드 | 낮음(빌트인) | 높음(webhook 네트워크 호출) | 사용 패턴 | 기본 보안 선(항상 켜기) | 조직별 정책(커스텀) |'. 또한 CKS 시험 출제 범위(PSS가 기본, Gatekeeper 심화)도 명시
- **🟡 MED** `이해난이도` _1.3절 warn → enforcement 전환 절차_
  - 문제: warn 모드로 경고가 나온다고 했는데, '경고를 본 후 어떻게 Pod를 고친다?'는 구체 절차가 없음. 어느 필드를? 어떻게? 하는 실전 지도가 부족
  - 보강: 실전 마이그레이션 시나리오 추가: '(1) warn=restricted 적용 → kubectl apply 출력에 경고('runAsNonRoot != true' 등) (2) 경고 메시지에서 위반 필드 파악 (3) Pod YAML의 securityContext에 runAsNonRoot: true 추가 (4) kubectl replace 또는 Deployment .spec.template.spec.securityContext 수정 (5) 모든 경고 제거 후 enforce=restricted로 전환'. 실제 Deployment 고쳐보기 예제 YAML 추가
- **🟡 MED** `이해난이도` _4.1절 base64 인코딩의 보안 의미_
  - 문제: base64가 인코딩(암호화 아님)이라는 설명은 있지만, 위협 수준이 학생에게 와닿지 않음. '누가 etcd에 접근하나?'의 실제 공격 시나리오가 약함
  - 보강: 실제 공격 경로 제시: '(1) Kubernetes 노드의 etcd 데이터 디렉토리(/var/lib/etcd) 스냅샷 탈취 → base64 Secret 읽기 가능 (2) API 서버 감사 로그(--audit-log-path) 수집 → Secret 값 노출 (3) 백업 파일 유출(예: velero backup → S3 bucket 공개) (4) RBAC 실패로 비인가 사용자가 etcdctl 접근 → 모든 Secret 평문 가능. 따라서 Encryption at Rest + etcd/로그 접근제어 + audit logging 심화 필수'. 각 경로별 mitigation도
- **🟡 MED** `맥락점프` _§3(정책 엔진) → §4(암호화) → §5(런타임) → §6(mTLS) 섹션 간_
  - 문제: 6개 주제가 'Minimize Microservice Vulnerabilities' 도메인 하에는 있지만, 논리적 연결 없이 나열됨. 학생은 '왜 이 6개가 한 묶음인가? 언제 뭘 써야 하나?'를 모름
  - 보강: 도메인 맵핑 명시: 섹션 0.5로 '공격 방어 계층' 도입 — '(1) 입구 통제: PSS(권한 박탈) + Gatekeeper(정책 강제) (2) 저장소 보호: Encryption at Rest(암호화) (3) 런타임 격리: RuntimeClass(kernel 격리) (4) 통신 보안: mTLS(상호 인증+암호화)'. 각 계층이 어떤 공격을 방어하는지(예: RuntimeClass는 kernel exploit 방어, Encryption은 데이터 탈취 방어) 명시. 또한 '이들은 방어 심화 수준이 다르므로, 일반 워크로드는 PSS+Gatekeeper로 충분하고, 고보안 워크로드는 RuntimeClass+mTLS까지 추가' 같은 의사결정 프레임 추가
- **🟡 MED** `맥락점프` _1.5절 Pod YAML의 이미지 선택_
  - 문제: nginx:1.25를 갑자기 제시. '왜 1.25인가? latest는 왜 안 되나?'의 의도가 불명확(권장사항만 있음)
  - 보강: 이미지 선택 기준 추가: '(1) latest 태그를 피하는 이유: 재배포 시 다른 버전으로 바뀔 수 있어 재현성 깨짐(CKA/CKS 시험 금지) (2) 구체 버전(1.25) 선택: 보안 패치(CVE 수정) + 알려진 안정성. 예: 1.25는 alpine 기반으로 이미지 크기 작고, 공식 보안 업데이트 지원 기간 확보'. 또한 '자격증 시험에서는 보통 latest 사용 금지 명시하지 않으므로 imperative 명령(kubectl run)에서는 latest 가능, 하지만 YAML(securityContext가 필요한)은 명시 버전 권장'이라는 시험 팁 추가
- **🟡 MED** `실습재현불가` _1.6 실습 명령_
  - 문제: production 네임스페이스를 예제로 했는데, 실제 CLAUDE.md의 dev 클러스터에는 production이 없음(cap-cks-d07). 학생은 '이 명령을 어디서 쓰나?' 혼란
  - 보강: 현실 클러스터에 맞게 수정: 'dev 클러스터에 실습용 namespace를 생성하고 실행': kubectl create namespace restricted-ns && kubectl label ns restricted-ns pod-security.kubernetes.io/enforce=restricted pod-security.kubernetes.io/enforce-version=latest'. 또한 '시험 환경에서는 보통 production/staging 네임스페이스가 있을 것이므로, 실습이 작업 후 cleanup 명령(kubectl delete ns restricted-ns) 추가'
- **🟡 MED** `실습재현불가` _3.2/3.3 OPA Gatekeeper 실습_
  - 문제: Gatekeeper 설치 명령 전무. 학생은 'ConstraintTemplate을 어디에 apply 하나? Gatekeeper가 떠 있는가?'를 확인 불가능
  - 보강: 설치 지시 추가(헬름 또는 매니페스트): 'helm repo add gatekeeper https://open-policy-agent.github.io/gatekeeper/charts && helm install gatekeeper/gatekeeper -n gatekeeper-system --create-namespace'. 또는 kubectl로 직접 apply할 수 있게 매니페스트 링크(또는 인라인 YAML). 설치 후 검증 명령(kubectl get deployment -n gatekeeper-system)도 추가. 그 후에야 ConstraintTemplate 작성 실습 가능
- **🟡 MED** `실습재현불가` _5.3 RuntimeClass 적용_
  - 문제: containerd에 runsc 핸들러를 등록하라고 했지만, 구체 /etc/containerd/config.toml 설정 내용이 전무. 시험에서 시도하면 에러(handler not found) 발생 후 복구 불가
  - 보강: containerd config 샘플 제시: '''toml
[[plugins.'io.containerd.grpc.v1.cri'.containerd.runtimes]]
  runtime_type = 'io.containerd.runsc.v1'
  runtime_engine = '/usr/local/bin/runsc'
  runtime_root = '/run/containerd/runsc'
'''와 함께, '(1) 노드에 runsc 바이너리가 /usr/local/bin/runsc에 설치되어야 함 (2) config 수정 후 containerd 재시작: systemctl restart containerd (3) 검증: kubectl get nodes -o wide | grep gvisor(RuntimeClass가 지정된 노드)'. 또한 gVisor 설치 선행조건(KVM 지원, seccomp, 권한 등)도 명시
- **🟡 MED** `실습재현불가` _6.3 mTLS 실습 — Connection reset 에러 확인_
  - 문제: 'Connection reset by peer' 에러라고만 했는데, 이게 mTLS 실패의 증거인지 네트워크 끊김인지 확인 방법이 없음. 또한 Istio 설치/PeerAuthentication 배포가 전제조건인데 명시 안 됨
  - 보강: mTLS 실패 증명: '(1) PeerAuthentication STRICT 설정 후, no-sidecar Pod에서 curl http://httpbin:8000/get → 연결 실패. (2) Envoy 로그 확인: kubectl logs -n <ns> <service-pod> -c istio-proxy | grep -i tls/mtls → TLS handshake failure 메시지. (3) 대조: sidecar가 있는 Pod에서 같은 요청 → 성공 + X-Forwarded-Client-Cert 헤더 확인. (4) PeerAuthentication mode: PERMISSIVE로 변경 → no-sidecar도 통과 확인'. 선행조건 체크리스트(Istio 1.6+, injection enabled, PeerAuthentication 존재) 추가
- **⚪ LOW** `정확성오류` _1.5 Pod YAML — runAsNonRoot 위반 테스트_
  - 문제: runAsNonRoot: true를 설정하면 '이미지의 USER가 root이면 Pod 시작 실패'라고 했는데, 정확히는 '(1) 이미지에 명시 USER 없으면 root(0)로 간주 (2) Pod securityContext에 runAsUser가 없으면 이미지 USER 따름 (3) 둘 다 root로 결론나면 거부'. 단순 '이미지가 root이면' 표현은 nginx:1.25 이미지(실제는 nginx uid로 정의)를 예제로 했을 때 혼동 가능
  - 보강: 정확한 조건: 'runAsNonRoot: true 설정 시, Pod 실행 uid = min(Pod.securityContext.runAsUser, image.USER, image.USER 없으면 0) = 0이면 거부. nginx 이미지는 USER nginx(uid 101)로 정의되어 있으므로 runAsUser를 명시하지 않으면 자동 통과. 하지만 alpine 또는 수정된 이미지가 root로 정의되었다면 실패. 따라서 명시적으로 runAsUser: 1000을 항상 써서 이미지 설정을 무시(override)하는 것이 보안 베스트프랙티스.'
- **⚪ LOW** `정확성오류` _4.3 etcdctl 검증 — hexdump 출력 형식_
  - 문제: k8s:enc:aescbc:v1:key1 접두사를 hexdump -C 텍스트 형식으로 보였는데, 실제 etcd 바이너리 저장소는 protobuf 인코딩이므로 학생이 똑같은 출력을 볼 확률이 낮음. 또한 이 명령 자체가 staging/prod 클러스터의 노드에서만 가능(etcd 접근권)하므로 dev 클러스터 실습 불가능
  - 보강: 대체 검증 방법: '(1) Secret 암호화 확인은 etcdctl이 아닌 kube-apiserver 로그로 가능: grep 'Encryption' /var/log/pods/kube-system_kube-apiserver*/kube-apiserver.log (2) 또는 kubectl 문법: 새 Secret 생성 후 kubectl get secret <name> -o yaml | grep -A 1 ^data 로 base64 인코딩 확인 (3) etcdctl로 하려면 staging 클러스터의 마스터 노드 SSH 필수, kubeadm 실습(CKA) 파트에서 다룸'. 또한 현실적인 검증(API 호출 성공)으로도 충분함을 명시
- **⚪ LOW** `구조` _제목 '(1/2)' 및 다음 Day 예고_
  - 문제: Day 7이 '(1/2)'라고 명시했는데, Part 2(Day 8)와의 경계가 불명확. 학생은 '이 내용이 전부인가?'의 불안감. 실제 CKS 출제 범위와의 매핑 불명확
  - 보강: 섹션 0 '학습목표'에 명시: 'Day 7(1/2): Pod 레벨 보안(PSS/SecurityContext) + 정책/암호화 메커니즘(Gatekeeper/Encryption/RuntimeClass) → Day 8(2/2): 클러스터 보안(RBAC/NetworkPolicy/감시(Audit/Falco)), CKS 시험 Minimize Microservice Vulnerabilities 도메인 20% 커버'. 또한 Day 7 끝에 '✅ Day 7 자가점검': [Pod를 Restricted 레벨로 만들 수 있나] [Encryption at Rest를 설정할 수 있나] 등 체크리스트 추가. 또한 Day 8 시작 때 Day 7 복습 섹션(1줄 요약) 추가

### daily/day08.md · 가독성 4/5 · 스토리 4/5 · 합격✅

- **🟡 MED** `용어비약` _Section intro line 17: no_new_privs first mention_
  - 문제: Mentions 'kernel no_new_privs flag' abruptly without defining what it prevents. Student cannot understand without prior knowledge of setuid/execve syscall mechanics. Detailed explanation exists later in advanced section (lines 44-47) but absent from main narrative.
  - 보강: Before section 1.1, add: 'no_new_privs is kernel security mechanism. When set via prctl(PR_SET_NO_NEW_PRIVS, 1), it forces execve() syscall to forbid effective UID elevation, blocking setuid/setgid privilege escalation. Containers with allowPrivilegeEscalation=false invoke this.'
- **🟡 MED** `용어비약` _Attack-defense intro lines 48-50: seccomp-bpf mechanism_
  - 문제: States 'RuntimeDefault profile blocks about 50 dangerous syscalls' but never explains what BPF is, how it intercepts syscalls, or why mount/reboot/kexec_load are dangerous. Student cannot assess risk. Detailed explanation exists in advanced section (line 48) but not in main flow.
  - 보강: Add to attack-defense section: 'seccomp-bpf is kernel bytecode filter that intercepts all syscalls at entry. It allows/denies each by rule. mount() changes host fs; reboot() crashes host; kexec_load() boots alternate kernel—all break host isolation. RuntimeDefault denies these ~50 syscalls to prevent container escape.'
- **🟡 MED** `스토리라인누락` _Section 7 Exam Patterns (lines 62-88): lists 5 output patterns_
  - 문제: Lists 5 exam patterns but omits why they matter. Relationship between PSA, SecurityContext, Secret Encryption is hierarchical (PSA=policy layer, SecurityContext=pod layer, Encryption=data layer) but not stated. Student may memorize patterns without grasping architecture.
  - 보강: Before pattern list, add paragraph: 'CKS Domain: Minimize Microservice Vulnerabilities has 3 protection layers. Layer 1: Pod Security Admission (namespace-wide policy enforcement). Layer 2: SecurityContext (pod/container-level hardening settings). Layer 3: Secret Encryption (etcd-level data protection). All 5 exam patterns map to these layers.' Add ASCII diagram or mermaid showing layers.
- **🟡 MED** `용어비약` _Problem 5 Rego code (lines 367-377): Rego logic undefined_
  - 문제: Provides Rego function 'startswith_any(str, prefixes) { prefix := prefixes[_]; startswith(str, prefix) }' without syntax explanation. Underscore _, comprehension semantics unknown to student unfamiliar with logic languages. Exam tip says 'focus on Constraint parameters' but example contradicts this.
  - 보강: Add before Rego block: 'OPA Gatekeeper policies written in Rego declarative language. In Rego: prefixes[_] means iterate each element; startswith(str, prefix) checks if str begins with prefix. For CKS, modify ConstraintTemplate from examples, not write Rego from scratch. This example shows template structure.'
- **⚪ LOW** `정확성오류` _Problem 9 encryption verification lines 516-520: hexdump output interpretation_
  - 문제: Output interpretation vague. States 'if k8s:enc:aescbc:v1:key1 prefix seen, encrypted; if plaintext seen, failed.' But k8s:enc metadata always shows if encrypted. Student may misinterpret binary data meaning.
  - 보강: Clarify: 'etcd stores encrypted Secret: first 20-30 bytes show metadata k8s:enc:aescbc:v1:key1; remaining bytes are AES-CBC ciphertext (unreadable without key, API Server only decrypts). If plaintext words or secret values appear in hexdump, encryption failed—critical breach.'
- **⚪ LOW** `맥락점프` _Problem 6 Istio mTLS (lines 396-426)_
  - 문제: Section suddenly introduces Istio mTLS. Day 8 theme is Pod/container hardening (PSA, SecurityContext, encryption, RuntimeClass, OPA). Istio mTLS is service mesh network security—different scope. Prerequisite knowledge (sidecars, mTLS modes) not explained. Feels disconnected.
  - 보강: Add transitional paragraph before Problem 6: 'So far we hardened Pod internals. Now extend to Pod-to-Pod communication: Istio mutual TLS (mTLS) enforces encrypted authentication between services. Unlike K8s default plaintext HTTP, mTLS requires both client and server certificate verification with no app code changes (Envoy sidecar handles it). STRICT mode forbids non-TLS; PERMISSIVE allows both (migration phase).'
- **⚪ LOW** `실습재현불가` _Hands-on section 2 Istio mTLS (lines 746-749): curl command_
  - 문제: Command 'kubectl exec -n demo deploy/nginx-web -c istio-proxy -- curl https://httpbin:8000' assumes demo namespace exists, Pods deployed, sidecars injected. No setup shown. If Istio not installed or Pods missing, student cannot run. Reproducibility blocked.
  - 보강: Before command, add setup check: '(Assumes dev cluster Istio installed and demo namespace with nginx-web, httpbin Pods deployed. Verify: kubectl get pods -n demo. If missing, scripts/install.sh auto-deploys or deploy from manifests/.)' Provide fallback check if Pods unavailable.
- **⚪ LOW** `용어비약` _Advanced section: Kyverno policy (lines 950-998)_
  - 문제: Introduces 'patchStrategicMerge' without definition. Validating vs Mutating policies difference not stated. Student may not grasp auto-modification. Why mention Kyverno in CKS course (which tests OPA)? Purpose unclear.
  - 보강: Add before Kyverno code: 'Kyverno is alternative to OPA Gatekeeper (not CKS-required, but useful reference). Supports Validating policies (reject non-compliant) and Mutating policies (auto-modify). patchStrategicMerge is K8s JSON-patch syntax to add/modify fields. Example auto-injects resource limits. CKS focuses on OPA; Kyverno mentioned for comparison.'
- **⚪ LOW** `스토리라인누락` _Advanced section: EncryptionConfiguration (lines 1000-1039)_
  - 문제: Process steps 1-5 correct but isolated from earlier Problem 3. Student may not see why aescbc-then-identity order is critical. Explanation lacks visualization of API Server provider usage during CREATE vs GET.
  - 보강: Add Operating Principle subsection with sequence diagram: 'Secret CREATE → API Server tries providers in order → aescbc encrypts → etcd stores metadata+ciphertext. Secret GET → try providers in order → aescbc decrypts (success). Old Secret (identity-only before encryption) → try aescbc (fail) → fallback identity (success). Provider order determines encryption target.' Then criticality becomes clear.

### daily/day09.md · 가독성 3/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `스토리라인누락` _L522-523 distroless 설명 부분_
  - 문제: distroless·alpine의 장점만 있고, '그럼 모든 이미지를 distroless로?'의 질문에 대한 trade-off 미설명. 셸 없음→디버깅 어떻게 하나? alpine의 musl libc 호환성 문제 미언급
  - 보강: '§5.1 끝에 '베이스 이미지 선택 trade-off' 섹션 추가: ubuntu/debian (공격 표면 넓음 but 디버깅 도구 풍부) vs alpine (작지만 musl libc 호환 이슈·보안 업데이트 느림) vs distroless (가장 안전하지만 셸/apt 없어 kubectl exec 디버깅 불가, 헬스체크/로깅 사전 필수). 선택 기준: 프로덕션 distroless, 개발/테스트 alpine, 레거시는 debian-slim' 표로 정리
- **🔴 HIGH** `맥락점프` _L256-399 ImagePolicyWebhook 설정 섹션_
  - 문제: 3개 YAML이 상호 참조하는데 '이 4개 파일을 실제로 어디에 어떻게 만드나?'의 구체 순서 미설명. kubeConfigFile 경로는 누가 생성하나? ImagePolicyWebhook과 ValidatingWebhookConfiguration 차이·선택 기준 미설명
  - 보강: '§3.1 흐름도 아래에 한 문단: 실제 구성 순서 (1) webhook 검증 서비스를 Pod로 배포 (2) /etc/kubernetes/admission-control/ 마스터 노드에 생성 (3) 3개 파일(admission-config.yaml·image-policy-webhook.kubeconfig·webhook-ca.crt) 복사 (4) kube-apiserver.yaml 수정 재시작. §3.4 ValidatingWebhookConfiguration 헤드에: API Server 옵션 ImagePolicyWebhook이 우선. CKS는 보통 ValidatingWebhookConfiguration (더 표준적) 다룸' 추가
- **🔴 HIGH** `실습재현불가` _L751-927 'tart-infra 실습' 섹션_
  - 문제: '예상 출력'이 모두 ```text 텍스트 블록 (L801~905, 8겹 이상의 코드블록). 실제 터미널 스크린샷 이미지 0개. 학생이 명령 따라 입력했을 때 '이렇게 나오면 성공'이라는 시각적 증거 없음. demo 네임스페이스의 실제 Pod들·이미지 상태 스크린샷 없어 환경이 다르면 재현 불가
  - 보강: 'dev 클러스터에서 실제로 demo 네임스페이스 Pod들을 확인한 스크린샷 (kubectl get pods -n demo) 실습 1 앞에 삽입. Trivy로 nginx:1.25·postgres:15 등 2-3개 이미지를 실제 스캔한 터미널 화면 PNG 1-2장을 L815 자리의 ```text 대신 ![Trivy nginx:1.25 스캔](images/trivy-nginx-critical.png) 형식으로 삽입. 실습 2·3도 동일하게 실제 kubectl 출력 스크린샷 추가. 각 실습 시작 전 '선수 검증' 명령 스크린샷 (kubectl config current-context / kubectl -n demo get pods)' 추가
- **🟡 MED** `용어비약` _L47-54 OCI 이미지 레이어 설명 부분_
  - 문제: 'OCI 이미지는 매니페스트·설정·레이어의 3개 구성 요소'라고만 설명. config vs layer 구체적 구분 없음. 학생이 '이미지 설정이 뭐고 레이어가 뭔가'를 모름
  - 보강: 'OCI 이미지는 (1) 매니페스트[=레이어 목록+메타데이터의 JSON] (2) 설정[=ENV·ENTRYPOINT·USER 같은 실행 인자] (3) 레이어들[=실제 파일시스템 tar.gz]로 이루어짐. 매니페스트 자체의 SHA-256 해시가 다이제스트'로 명시. 다이제스트 섹션 L417과 연결
- **🟡 MED** `용어비약` _L151-152 CVSS 점수 정의_
  - 문제: CVSS 0~10 점이 왜 이런 범위인지, 누가 정하는지, 'RCE 가능성'과 '점수' 관계 설명 없음
  - 보강: 'CVSS는 미국 NIST와 업계 합의로 표준화된 취약점 심각도 점수(0~10). 9.0+ 판정은 "공격 난이도 낮고 영향 범위 넓음"(주로 RCE)을 의미. 공개된 모든 CVE에 CVSS 점수가 부여됨' 추가
- **🟡 MED** `용어비약` _L53 CPE(Common Platform Enumeration) 정의_
  - 문제: CPE 이름만 있고 '패키지를 CPE로 식별하는 구체 방식'(예: nginx 7.21 = cpe:/a:nginx:nginx:1.21) 없음
  - 보강: 'CPE는 software name:version:platform을 표준 형식(cpe:/a:nginx:nginx:1.21)으로 정의한 ID. Trivy는 이미지에서 추출한 모든 패키지를 CPE로 정규화한 뒤 NVD 데이터베이스와 매칭' 추가
- **🟡 MED** `스토리라인누락` _L211-237 Cosign 등장 부분_
  - 문제: '왜 단순 gpg가 아니라 Cosign인가?'의 동기 미설명. 개인 키 자체 보관의 위험·레지스트리 표준화 필요성 등 직전 기술의 한계 없음
  - 보강: '§2.1 끝에 추가: 전통적 gpg 서명은 CI 서버에 개인 키를 저장해야 하므로 키 유출 위험이 크다. 또한 K8s Admission Controller가 서명을 어디서 읽을지 표준이 없었다(메타데이터? 별도 시스템?). Cosign은 OCI 레지스트리를 신뢰할 수 있는 서명 저장소로 활용하여 이 문제 해결' 명시
- **🟡 MED** `스토리라인누락` _L240-252 DCT(Docker Content Trust) 섹션_
  - 문제: Cosign과 DCT의 관계 설명 없음. '왜 DCT는 deprecated되고 Cosign으로 가는가?'의 스토리 미비. 단순 명령 나열만 있음
  - 보강: 'DCT는 Docker Hub 중앙화 서명(Docker Hub만 지원)이므로 Private Registry(ECR·Quay·Harbor) 호환성 낮음. Cosign은 OCI 표준 API로 모든 레지스트리 지원. CKS는 Cosign 중심' 명시. 절 끝에 Cosign vs DCT 비교표 추가
- **⚪ LOW** `정확성오류` _L417-420 다이제스트 정의_
  - 문제: '다이제스트는 이미지 매니페스트의 SHA-256' vs '레이어 1비트 변경되면 다이제스트 변경'의 연결이 부정확하게 읽힘. 엄밀히는 '레이어 해시 변경→매니페스트 변경→매니페스트 해시(=다이제스트) 변경'인데 문장 구조가 애매. L421 예시 'nginx@sha256:abc123'이 매니페스트 다이제스트인지 명시 없음
  - 보강: 'L417-420을 다시 쓰기: 다이제스트(digest) = 이미지 매니페스트 자체의 SHA-256 해시 (예: nginx@sha256:6af79...). 매니페스트는 레이어 목록+설정 메타데이터를 포함하므로, 레이어 1비트 변경→매니페스트 변경→매니페스트 해시 변경→다이제스트 불일치. 이것으로 변조 탐지' 명시. L421 예시에 '(= 이 이미지 매니페스트 다이제스트)'주석

### daily/day10.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `용어비약` _3-12줄 오늘의학습목표_
  - 문제: 'tart-infra 환경'이 학생의 사전 이해 없이 등장. tart가 무엇인지, 왜 필요한지, dev/staging 클러스터가 이미 실행 중인 상태라는 가정이 명시되지 않음
  - 보강: '오늘의 학습 목표' 직전에 1단락 추가: 'tart-infra란 본 저장소의 로컬 멀티클러스터 환경(dev/staging/platform/prod 4개)을 의미한다. 이 과정은 클라우드 SaaS가 아니라 로컬 실제 K8s 클러스터에서 직접 손으로 명령을 실행하며 배운다. tart 클러스터는 `scripts/boot.sh`로 사전에 가동되어야 한다(CLAUDE.md §3 참조).'
- **🔴 HIGH** `맥락점프` _45-75줄 §7. 출제패턴 직후 §문제1(Trivy)_
  - 문제: '문제 1. Trivy 이미지 스캔'이 갑자기 나타나며, 이전 섹션(14-40줄 admission chain 설명)과 연관이 끊김. 왜 '이미지 다이제스트'가 중요한지의 배경(컨테이너 immutability 개념)이 없음
  - 보강: 문제 1 전에 새 절 추가: '내부 동작 원리: 이미지 태그 vs 다이제스트\n이미지 태그(nginx:1.25)는 변경 가능한 참조이지만, 다이제스트(sha256:...)는 이미지 내용의 불변 해시다. 보안 환경에서는 다이제스트를 사용하여 image replacement 공격을 방지한다.' + mermaid로 '레지스트리 재푸시 → 같은 태그 다른 내용' 흐름도 추가
- **🔴 HIGH** `스토리라인누락` _53-69줄 출제 패턴 5가지_
  - 문제: 각 패턴이 '어떤 보안 위협'을 막기 위한 기술인지 설명이 없음. 학생은 '아, Trivy를 써야 하는구나' 정도만 이해할 수 있지, 왜 공급망 보안이 CKS 도메인에 20% 비중인지 이해 못 함
  - 보강: §7.1 상단에 '공급망 보안 개요' 추가: 'Supply Chain Security는 컨테이너 이미지가 개발 단계부터 배포까지 변조/탈취되는 것을 방지하는 분야다. 과거 Docker 시대에는 이미지 서명 체계가 없어 공격자가 Dockerfile 변조·레지스트리 접근 후 악성 이미지를 업로드할 수 있었다. CKS는 Trivy(이미지 스캔)·ImagePolicyWebhook(정책 검증)·Cosign(디지털 서명)·SBOM(컴포넌트 추적)으로 이 공격 체인을 막는다.'
- **🔴 HIGH** `스토리라인누락` _77-98줄 문제1_
  - 문제: Trivy 명령 결과가 '텍스트 블록'(85-88줄)으로 주어졌으며, CLAUDE.md §4①의 '실제 터미널 스크린샷 이미지만' 규칙을 위반함. 학생이 '실제 출력이 어떻게 보이는지' 알 수 없음
  - 보강: 다음으로 교체: '```bash\ntrivy image --severity CRITICAL nginx:1.19 2>/dev/null\n```\n\n[실제 스크린샷 이미지: dev 클러스터에서 위 명령 실행 결과] (현재는 스크린샷이 없으므로 "(스크린샷 필요)" 표기)'
- **🟡 MED** `이해난이도` _100-140줄 문제2(ImagePolicyWebhook)_
  - 문제: 설정 파일이 '/etc/kubernetes/admission-control/admission-config.yaml'이라 명시되었으나, 실제 경로·파일명·내용 형식이 불명확. 학생이 '어디서 파일을 만들어야 하는지' '기존 파일이 있는지' 알 수 없음. API Server 매니페스트 수정의 '--enable-admission-plugins' 기존 값이 무엇인지도 미공개
  - 보강: 문제2 풀이 주석에 추가: 'API Server 매니페스트 확인: `kubectl get pod kube-apiserver-<node> -n kube-system -o yaml | grep enable-admission-plugins` 결과에 이미 있는 플러그인 목록을 확인한다. 기존값(예: NodeRestriction,PodSecurityPolicy)에 ImagePolicyWebhook을 ,로 구분하여 추가한다. 순서는 상관없다.'
- **🟡 MED** `실습재현불가` _212-224줄 문제4(다이제스트 적용)_
  - 문제: 명령 `kubectl get pod -n production ...`에서 조회하는 값이 'deployment web-app'에 해당하는 실제 pod 이름이 무엇인지 불명확. 또한 crane 명령(`crane digest nginx:1.25`)이 사전 설치 필수인지 명시 없음
  - 보강: 문제4 직전 '준비물' 항목 추가: 'crane 설치 확인: `which crane` 또는 `go install github.com/google/go-containerregistry/cmd/crane@latest`. 또는 `docker inspect <image> | jq .[0].RepoDigests` 사용 가능'
- **🟡 MED** `용어비약` _235줄 문제5(kubesec)_
  - 문제: 'kubesec scan pod.yaml' 명령이 갑자기 나타나며, kubesec 도구 설치·사용법·출력 형식이 전혀 설명되지 않음. curl 명령도 있는데 둘의 차이는?
  - 보강: 문제5 직전 '도구 소개' 추가: 'kubesec는 Kubernetes YAML의 보안 정책을 평가하는 도구다. 설치: `curl https://github.com/controlplaneio/kubesec/releases/download/v2.x.x/kubesec_linux_amd64.tar.gz -L | tar xz; sudo mv kubesec /usr/local/bin/`. 또는 웹 API `curl -sSX POST --data-binary @pod.yaml https://v2.kubesec.io/scan`로도 사용 가능(설치 불필요).'
- **🟡 MED** `정확성오류` _189줄 FROM 이미지_
  - 문제: 'FROM gcr.io/distroless/python3-debian12:nonroot'이라 했으나, Google distroless의 실제 태그명이 정확한지 미확인. distroless는 nonroot 이미지가 기본(별도 ':nonroot' 태그 불필요할 수도)
  - 보강: 실제 이미지 검증 후 수정 필요. 대안: 'FROM gcr.io/distroless/base-debian11:nonroot'(검증됨) 또는 파이썬 버전이 필요하면 'FROM gcr.io/distroless/python3-debian11'(이미 non-root UID 65532)로 명시. 주석에 '`docker inspect <image>` 또는 hub.docker.com에서 태그 확인' 추가
- **🟡 MED** `맥락점프` _270-296줄 문제6_
  - 문제: 'dev 클러스터'와 '데모 네임스페이스(demo namespace)'가 갑자기 등장. TART 환경에서 이 이름이 실제로 있는지, 어디서 확인하는지 불명확
  - 보강: 문제6 상단에: '준비: dev 클러스터 접속 확인 → `kubectl get ns | grep demo` (또는 `kubectl get pods -n demo --kubeconfig kubeconfig/dev.yaml`로 기존 pod 확인)'
- **🟡 MED** `용어비약` _561-571줄 tart-infra 실습 환경설정_
  - 문제: SBOM(Software Bill of Materials)의 개념이 문제 7(300-318줄)에서 첫 등장하는데 설명이 한 줄뿐. 학생이 SBOM이 뭔지 왜 필요한지 모르고 명령만 따라함
  - 보강: 문제7 직전 1단락 추가: 'SBOM(Software Bill of Materials)란 컨테이너 이미지에 포함된 모든 소프트웨어 컴포넌트(라이브러리·패키지)의 목록이다. 개발자가 의존성 변조(supply chain 공격)를 감지하기 위해 배포 시 SBOM을 공개하고, 이를 CycloneDX 형식으로 표준화했다. Trivy는 이미지를 분석해 SBOM을 자동 생성할 수 있다.'
- **🟡 MED** `맥락점프` _320-355줄 문제8(ValidatingWebhookConfiguration)_
  - 문제: ImagePolicyWebhook(문제2)과 ValidatingWebhookConfiguration(문제8)의 차이가 명확하지 않음. 둘 다 'webhook을 호출한다'는 점에서 중복처럼 보임
  - 보강: 문제8 직전에 '개념 비교' 추가: 'ImagePolicyWebhook vs ValidatingWebhookConfiguration\n- ImagePolicyWebhook: K8s 1.19+ deprecated, 이미지 정책만 검증하는 전용 admission controller\n- ValidatingWebhookConfiguration: 범용 admission webhook, 임의의 리소스(Pod·Deployment·NetworkPolicy)를 검증 가능. CKS 최신 시험은 ValidatingWebhookConfiguration 사용을 권장한다.'
- **⚪ LOW** `스토리라인누락` _827-849줄 Cosign 이미지 서명_
  - 문제: '비대칭 키 기반'이라는 표현이 암호학 배경 없는 학생을 혼동시킬 수 있음. 서명이 '누가 빌드했는지 검증'하는 것이라는 실용적 설명 부족
  - 보강: mermaid 다이어그램 캡션 아래에 추가 설명: 'Cosign 서명의 의도: 개발자가 개인키로 이미지에 '나는 이 이미지의 빌더다'라는 서명을 붙인다. 배포 시스템(kubectl·Admission Controller)는 공개키로 서명을 검증해 '변조된 이미지는 아닌가' 확인한다. 이를 통해 이미지 replacement 공격(공격자가 레지스트리에 악성 이미지 푸시)을 방어한다.'
- **⚪ LOW** `이해난이도` _853-874줄 연습문제1(Dockerfile 보안 5가지 이상)_
  - 문제: 정답이 7개나 제시되어 '5가지 이상'이라는 문제 요구와 맞지 않음. 또한 권장사항(chmod 755 vs 777)이 의도와 트레이드오프 없이 기술됨
  - 보강: '정답 7개' 앞에 '주요 5가지 (필수):'라고 명시하고, 6~7번은 '심화 항목'으로 구분. 또한 '권장': chmod 755로 설명할 때 '(대신 불필요한 쓰기 권한을 제거해 컨테이너 런타임이 의도 외 파일 수정을 방지한다)' 추가
- **⚪ LOW** `구조` _920-947줄 CKS 시험 팁 체크리스트_
  - 문제: 이 체크리스트가 일반 설명과 별개로 떨어져 있어 앞의 문제들과 연관이 약함. 문제 풀이 직후에 '이 문제에서 배운 체크리스트'를 즉시 제시하는 게 학습 효율이 높음
  - 보강: 각 문제 그룹(1-3, 4-6, 7-11)별로 '이 섹션의 체크리스트'를 문제 직후에 삽입. 마지막 한 번에 '전체 CKS 공급망 보안 체크리스트' 제시

### daily/day11.md · 가독성 4/5 · 스토리 4/5 · 합격✅

- **🔴 HIGH** `실습재현불가` _1.6절 Falco 룰 작성 예제 모음 전체(line 221~391)_
  - 문제: 15개 Falco 룰이 모두 YAML 형식으로만 나열되어 있고, '이 룰이 실제로 작동하는지' 검증 명령어와 출력이 전혀 없음. 학생이 /etc/falco/falco_rules.local.yaml에 복사-붙여넣기한 후 실제로 트리거되는지, 알림이 발생하는지 확인할 수 없음.
  - 보강: 각 룰마다 다음 구조 추가: (1) 룰 코드 블록 → (2) '검증 명령어' 섹션(예: kubectl exec로 컨테이너에서 /bin/bash 실행) → (3) 예상되는 Falco 알림 스크린샷(journalctl -u falco 출력) → (4) '알림 해석' 문단. 최소 3~5개 중요 룰(Shell/민감파일/패키지/외부연결/리버스셸)에 대해서는 반드시 실제 검증 출력을 캡처해 넣을 것.
- **🔴 HIGH** `맥락점프` _1.2절 Falco 아키텍처 상세 → 1.3절 설정 파일 구조(line 89~127)_
  - 문제: mermaid 플로우차트는 좋지만, 그 직후 '설정파일 경로'로 곧바로 점프함. 중간에 '그러면 이 Falco를 실제로 쓰려면 어떻게 설치하고 구동할까?'라는 질문이 누락되어 있음. 학생 입장에서는 '아키텍처는 이해했는데, 내 클러스터에 어떻게 깔지?'라는 essential한 순서가 빠짐.
  - 보강: 1.2와 1.3 사이에 '1.2.5 Falco 설치 및 구동' 절 추가: (1) Helm/kubectl로 Falco DaemonSet 배포 명령 → (2) 실제 배포 확인 스크린샷(kubectl get pods -n falco) → (3) 로그 확인 명령(journalctl -u falco 또는 kubectl logs). 이후에야 설정 파일 구조가 의미를 가짐.
- **🔴 HIGH** `용어비약` _1.1절 도입 부분(line 69~75)_
  - 문제: HIDS(Host-based Intrusion Detection System) 용어가 갑자기 나타남. 학부생이 IDS가 무엇인지 모를 수 있음. 또한 '시스템콜 이벤트를 커널에서 직접 캡처'라는 표현이 '커널 공간(kernel space) 프로그램에서'를 암시하는데 명확히 하지 않음.
  - 보강: 다음을 추가하거나 명확히 할 것: '**HIDS(Host-based IDS)**: 호스트(노드) 수준에서 의심스러운 행동을 탐지하는 보안 도구. IDS = 침입 탐지 시스템으로, 침입을 자동으로 차단하는 IPS(Prevention)와 다르게 '탐지하고 알림'만 함.' / '**시스템콜**: 애플리케이션이 커널 기능(파일 열기, 프로세스 생성, 네트워크 연결 등)을 요청하는 인터페이스. Falco는 이 모든 시스템콜을 hook해 모니터링함.'
- **🔴 HIGH** `스토리라인누락` _3절 이상행위 탐지 및 대응(line 569~628)_
  - 문제: 3.1의 '이상행위 탐지 매트릭스'는 있지만, 그 이전에 '왜 Falco 룰만으로는 부족하고 Audit Log + NetworkPolicy까지 함께 써야 하는가'라는 스토리가 없음. 즉, '탐지 도구 3가지(Falco/Audit/Network)를 어떤 층(런타임/API/네트워크)에서 각각 감시하고, 왜 세 개를 모두 써야 하는가'라는 context가 결여됨.
  - 보강: 3.1 이전에 '3.0 다층 방어 아키텍처' 절 추가: Falco(syscall)·Audit Log(API)·NetworkPolicy(L3/4)가 각각 다른 레이어를 감시한다는 그림을 그리고, '한 층의 우회(예: eBPF 우회)를 다른 층이 보완'하는 defense-in-depth를 설명. 그 후 각 탐지 도구의 역할을 설명하면 학생이 '왜 전부 필요한가'를 이해.
- **🟡 MED** `구조` _실습 1·2·3(line 859~1038)_
  - 문제: 세 실습 모두 '예상 출력'을 `예상 출력 (예시-환경/도구따라다름, dev/staging에 Falco/Audit Log 미설치)` 식으로 제시하고, 괄호 안의 '미설치' 주석을 붙임. 이는 '이 실습이 현재 dev 클러스터에서 실제로 작동하는지 불명'을 의미하는데, 그렇다면 '검증되지 않은 예제'를 학생에게 제시하는 것. CKS 실기 시험은 '손으로 실제 명령을 실행하고 결과를 해석해야 하므로' 이는 치명적.
  - 보강: CLAUDE.md(§4①)의 규칙: 모든 예상 출력은 실제 터미널 스크린샷이어야 하고, 불가능하면 '(미캡처)'로 명시할 것. 현재 기술 상태(dev 클러스터에 Falco 미설치)는 사실 확인 후, 만약 실제로 미설치라면 '설치 후 재캡처 예정' 마크업을 붙이고, 학생용 예제는 플레이스홀더가 아닌 실제 검증 출력만 제시할 것.
- **🟡 MED** `이해난이도` _1.4절 Falco 룰 구성 요소 상세(line 129~177)_
  - 문제: 예제 룰의 output 필드에서 변수(예: %user.name, %container.id)가 열거되어 있지만, '이 변수들이 어디서 나오는가' 설명이 뒤에 주석으로만 있음. 학생이 custom 룰을 작성할 때 '어떤 변수를 쓸 수 있나'를 찾으려면 매번 1.5절 필터필드표로 돌아가야 함.
  - 보강: 1.4절 끝에 '주요 output 변수 빠른참조' 박스를 추가: `%user.name, %container.id, %container.name, %proc.name, %proc.pname, %proc.cmdline, %k8s.pod.name, %k8s.ns.name` 등을 간단히 정리. 또는 1.5절의 필터필드표에 '### Output 변수' 섹션을 따로 만들어 output에만 쓸 수 있는 변수를 분리.
- **🟡 MED** `정확성오류` _1.8절 Falco 관리 명령어(line 418~469)_
  - 문제: line 457에서 '기대 출력 (예시-환경/도구따라다름, dev/staging에 Falco 미설치)'라고 표기된 출력이 뒤에 나오는데, 실제로 그 출력(line 462~464)이 '정말로 실제 기계에서 나오는 것인지' 확인 불가. 또한 'dev/staging에 Falco 미설치'라면 이 명령 자체가 dev에서 실행 불가능하므로, 명령 예제가 '진짜 작동하는가'에 대한 의심이 생김.
  - 보강: 이 절 전체를 다시 검증할 것. 실제 dev 클러스터에 Falco를 설치(또는 platform에 설치된 Falco가 있다면 그곳에서)한 후, 모든 명령을 실행해 실제 출력 스크린샷을 캡처해 붙일 것. 불가능하면 '이 명령들은 Falco DaemonSet 가동 상태에서만 동작하며, 현재 dev에 Falco가 미설치되어 있습니다. 설치 후 재실행 예정.'이라고 명시.
- **🟡 MED** `맥락점프` _트러블슈팅 섹션(line 705~774)_
  - 문제: 트러블슈팅이 '시나리오 1: Falco 재시작 후 이벤트 미수집' '시나리오 2: Audit Log 미생성'만 다룸. 하지만 '시나리오 1·2가 학생이 실제로 마주칠 가장 흔한 문제인가?'에 대한 근거가 없음. CKS 시험에서는 '룰을 작성했는데 트리거되지 않음' 같은 더 직접적인 문제가 더 자주 나올 수 있음.
  - 보강: 시나리오를 추가·우선순위 재정렬: (1) Falco 룰이 YAML 문법 오류로 로드 안 됨 → dry-run 검증 방법 (2) 룰은 로드됐지만 트리거되지 않음 → 조건식 논리 확인(예: 'container' 매크로 사용 의존도) (3) Audit Log policy 미설정 → apiserver manifest 확인 + audit-policy.yaml 작성 (4) CiliumNetworkPolicy 격리 후 네트워크 단절 → 정책 재검토. 실기 시험 빈도순으로 정렬.
- **⚪ LOW** `용어비약` _5절 컨테이너 불변성(line 777~836)_
  - 문제: line 789에서 'capabilities.drop: ["ALL"]'이라는 Linux capability 개념이 갑자기 등장함. 학부생이 capability가 무엇인지 모를 수 있음.
  - 보강: 'Linux capability: 전통 Unix의 all-or-nothing 'root' 권한을 세분화한 것. 예를 들어 CAP_NET_BIND_SERVICE(1024 이하 포트 바인딩) 같이 특정 시스템 권한만 주는 메커니즘. drop [ALL]은 모든 권한을 제거한다는 뜻.' 같은 한 문단을 추가.
- **⚪ LOW** `이해난이도` _실습 1(line 859~911)_
  - 문제: 실습 1의 '동작 원리' 설명(line 905~910)은 있지만, '학생이 왜 이 명령들을 실행하는가'라는 목표가 명확하지 않음. 즉, '불변성 검증'이라는 추상적 목표보다 '구체적으로 무엇을 확인하려고 하는가'를 먼저 제시해야 함.
  - 보강: 실습 1의 도입부에 '**목표**: demo namespace의 모든 Pod이 CKS security best practices(readOnlyRootFilesystem, capabilities.drop, allowPrivilegeEscalation=false)를 따르는지 감사하고, 실제로 각 제약이 작동하는지 손으로 시험한다.'를 추가.

### daily/day12.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `용어비약` _라인 84-125 (문제 1)_
  - 문제: Falco 기본 개념(spawned_process 매크로, container 매크로, proc.name 필드)을 학생이 처음 보는 것으로 가정하고, 사전 풀이 없이 YAML 문법만 제시. 학생은 '왜 이런 매크로가 있는가', 'spawned_process = execve syscall'이라는 연결고리 없이 문제를 풀어야 함.
  - 보강: 문제 1 전에 "Falco 룰의 3가지 요소(macro/list/rule)"를 실제 클러스터에서 확인하는 짧은 섹션 추가: `sudo cat /etc/falco/falco_rules.yaml | grep -A5 'macro: container'` (스크린샷 포함) + "이 매크로들이 커널의 어떤 syscall을 감시하는지" 한 문단.
- **🔴 HIGH** `스토리라인누락` _라인 14-42 (등장 배경)_
  - 문제: "공격 체인 예시"를 나열하지만, Day 11에서 배웠을 "Falco·Audit Log의 기본 차이"를 전제하지 않음. 학생이 "왜 Falco와 Audit Log 둘 다 필요한가", "각각이 감지하는 범위가 다른가"를 모른 채 문제를 본다. 스토리가 Day 12 내에서 자폐적(self-contained)이어서 전 차수와의 연결이 약함.
  - 보강: 라인 14-15 이후, 1문단 추가: "Day 11에서 배운 Falco(커널 syscall 감시, 실시간 알림)와 Audit Log(API 서버 요청/응답 기록, 사후 분석)의 역할 분담을 상기하자. 이번 Day 12는 둘을 실전에서 함께 사용하여 공격 체인 전단계를 추적하는 전략이다."
- **🔴 HIGH** `실습재현불가` _라인 103-124 (검증 기대 출력, 예시)_
  - 문제: "기대 출력 (예시-환경/도구따라다름, dev/staging에 Falco 미설치)" 주석이 있지만, 실제로 dev/staging에 Falco가 설치되지 않았음을 암시. 학생이 이 명령을 실제로 실행해도 결과를 볼 수 없다면 "실습 재현"이 불가능. CLAUDE.md §3는 tart 클러스터를 실습장으로 쓴다고 명시했는데, Falco 설치 상태를 명시하지 않음.
  - 보강: 파일 처음에 "실습 전제: platform 클러스터에는 Falco+Audit Log가 설치되어 있고, dev/staging은 실습 대상이다. Falco를 dev에 설치하는 절차는 [../04-tart-infra-practice.md] 참조" 같은 주석 추가. 또는 문제 1을 "dev 클러스터에서 Falco를 수동 설치하는 것부터 시작"으로 재구성.
- **🔴 HIGH** `정확성오류` _라인 442-450 (트러블슈팅 시나리오 3)_
  - 문제: "NetworkPolicy는 kubectl exec 트래픽을 차단하지 않는다" → "kubectl exec는 kubelet이 직접 컨테이너에 연결하므로 NetworkPolicy 영향을 받지 않는다"는 설명이 부정확. NetworkPolicy는 Pod-to-Pod/Pod-to-external 네트워크 트래픽만 제어하고, kubelet ↔ Pod 통신(API 호출 아님, 직접 컨테이너 프로토콜)을 차단하지 않는 것이 맞지만, 표현이 "타임아웃 원인은 다른 곳"이라고 혼란을 줌.
  - 보강: 라인 446-450을 다시 쓰기: "NetworkPolicy는 Pod 간 네트워크 인터페이스(eth0 등) 트래픽만 제어한다. kubectl exec는 kubelet이 컨테이너 런타임(예: containerd)의 exec 엔드포인트에 직접 호출하므로(gRPC, localhost), Pod의 eth0을 통과하지 않는다. 따라서 NetworkPolicy와 무관하게 exec가 동작한다. kubectl exec 타임아웃은 kubelet ↔ Pod 연결성(예: 노드 네트워크) 또는 container runtime 문제다."
- **🔴 HIGH** `맥락점프` _라인 316-343 (문제 9)_
  - 문제: "패키지 매니저 + 바이너리 쓰기"를 "불변성 위반"이라고 태그하지만, 불변 컨테이너(readOnlyRootFilesystem)와의 관계가 명시되지 않음. 학생은 "이게 왜 문제인가", "이 룰이 보안 정책 어디에 맞는가"를 모른 채 YAML만 복사.
  - 보강: 문제 9 직전 1문단: "Day 1에서 배운 '불변 인프라' 원칙을 상기하자. 프로덕션 컨테이너는 실행 후 바뀌면 안 되는데(이미지로 재빌드 후 재배포), 패키지 설치나 바이너리 덮어쓰기는 직접 컨테이너를 변경한다. Falco는 이 '변경 행위' 자체를 감지하여 위반 정책을 알린다."
- **🟡 MED** `용어비약` _라인 594-599 (Falco 규칙 문법)_
  - 문제: list: shell_binaries의 각 항목([bash, sh, zsh ...])이 무엇인지(셸의 종류) 설명 없음. proc.name이 바이너리 이름(예: /bin/bash가 아니라 bash)을 의미하는지 명시 필요.
  - 보강: 라인 595 후 1줄: "shell_binaries는 컨테이너에서 인터랙티브 셸로 사용되는 바이너리 이름들이다. proc.name은 syscall execve에서 실행된 프로세스의 짧은 이름(basename, 경로 제외)이다. 예: /bin/bash 실행 → proc.name = 'bash'."
- **🟡 MED** `구조` _라인 1-15 (헤더·목표)_
  - 문제: "Day 12: Monitoring, Logging & Runtime Security (2/2)"에서 "(2/2)"는 Day 11이 (1/2)였다는 뜻인데, CLAUDE.md는 daily/day11.md의 내용을 요구하지 않음. 학생은 day12만 읽을 때 "지난 Day 11에서 뭘 배웠나"를 모른다.
  - 보강: 라인 7 "오늘의 학습 목표" 섹션에 추가: "선수지식: Day 11에서 Falco의 기본 아키텍처(eBPF syscall 감시 → 규칙 매칭 → 알림), Audit Log의 정책/필터링, 기본 분석(jq 사용)을 배웠다고 가정한다. 모르면 [daily/day11.md] 또는 [01-concepts.md#Falco] 참조."
- **🟡 MED** `이해난이도` _라인 574-646 (심화 학습)_
  - 문제: 심화 학습 섹션(Falco 규칙 문법 상세)이 매우 길고 상세(73줄)한데, 기본 문제 1-10은 이 상세함의 10% 수준만 필요. 학생이 "어디까지가 시험 범위인가"를 판단하기 어렵다. 또한 574-617은 "규칙 문법"이고 618-646은 "3가지 예제"인데 경계가 명확하지 않음.
  - 보강: 라인 573 직후에 "CKS 시험 범위 vs 심화 학습" 표를 추가:

| 내용 | 시험 범위 | 비고 |
| --- | --- | --- |
| rule/desc/condition/output/priority | 필수 | 기본 문제 1-9 |
| macro/list 재정의 | 선택 | 심화, 대부분 기본 매크로 사용 |
| 복잡한 조건식(and/or/startswith) | 필수 | 필터 방식 |
| Audit Policy YAML 세밀한 설정 | 선택 | 알면 좋음 |

이렇게 학생이 "지금 공부해야 할 것"과 "심화"를 구분할 수 있다.
- **🟡 MED** `정확성오류` _라인 758-779 (sysdig 설명)_
  - 문제: 라인 758: "sysdig -c container.name=nginx-web"은 틀린 문법. sysdig의 -c 옵션은 chisel(내장 스크립트) 실행이고, 필터는 CLI 인자로 전달된다. 정확한 문법은 `sysdig -c <chisel> <필터>` 또는 `sysdig <필터>` (without -c).
  - 보강: 라인 756-774를 수정:
```bash
# sysdig 필터 문법 (no -c for filters, -c only for chisels)
sysdig -ccontainer.name=nginx-web  # ← 이건 틀림

# 올바른 방법 1: 필터만
sysdig 'container.name=nginx-web'

# 올바른 방법 2: chisel 사용
sysdig -c topconns_by_container

# 올바른 방법 3: 필터 + 출력 포맷
sysdig 'container.name=nginx-web and evt.type=execve' -o '%evt.type %proc.name %proc.args'
```
- **🟡 MED** `정확성오류` _라인 406-407 (falco.yaml rules_file 순서)_
  - 문제: "local.yaml이 뒤에 있어야 기본 룰을 오버라이드한다"는 설명이 불완전. Falco는 *마지막으로 읽은 같은 이름의 룰*이 이전 정의를 덮어쓴다(Merge). 즉 local.yaml이 뒤에 로드되어야 한다는 것이 맞지만, 추가 조건이 있다.
  - 보강: 라인 406-408을 다시 쓰기: "Falco는 rules_file 목록을 순서대로 로드하며, 같은 이름의 rule/macro가 나중에 정의되면 이전 정의를 덮어쓴다(override/merge). falco_rules.local.yaml은 반드시 falco_rules.yaml **뒤에** 위치해야 기본 룰을 수정할 수 있다. 단, local.yaml에 정의된 rule은 **desc/condition 전체를 다시 써야** 부분 수정(예: priority만 바꾸기)이 적용된다."
- **⚪ LOW** `용어비약` _라인 496 (감사 로그 동작 원리)_
  - 문제: "audit.log(JSON Lines 형식)"을 설명하는데, JSON Lines = 줄당 1개 JSON 객체를 암시하지만, 학생이 이 포맷을 처음 본다면 혼동 가능. jq로 처리하는 방식과 차이를 명시하지 않음.
  - 보강: 라인 496 후 1줄: "JSON Lines(JSONL)는 한 줄에 하나의 완전한 JSON 객체를 담은 형식이다. 일반 JSON 배열(`[{...}, {...}]`)과 달리, 파일이 커져도 스트리밍 처리(한 줄씩 읽음)가 가능하다. jq에서는 `cat audit.log | jq ...`로 각 줄을 자동 해석한다."
- **⚪ LOW** `이해난이도` _라인 208-241 (문제 5 풀이)_
  - 문제: 문제 5는 "의심 Pod를 격리하고 증거를 수집하라"는 종합 문제인데, kubectl exec 실행 (라인 232)이 "격리 후"에 있다. NetworkPolicy 적용 후 exec이 작동하는지 확인하지 않으므로, 학생은 "exec이 성공할까?"라는 의문을 가질 수 있다(실제로는 작동, 라인 442-450 참조).
  - 보강: 라인 215 후에 주석 추가: "# NetworkPolicy는 Pod의 네트워크 인터페이스만 제어하고, kubectl exec(kubelet → container runtime 직접 호출)은 제어하지 않으므로 격리 후에도 작동한다."

### daily/day13.md · 가독성 4/5 · 스토리 3/5 · 합격✅

- **🔴 HIGH** `용어비약` _문제1 ~2줄, 문제2 ~6줄, 문제3 ~15줄_
  - 문제: 처음 등장하는 기술 용어가 충분히 풀이되지 않음. 예: '문제1 default deny NetworkPolicy'는 '정책이 없으면 모두 허용된다'는 전제를 설명하지 않음. '문제2 DNS + Egress'는 'podSelector 매칭 때 AND/OR 관계'를 명시하지 않아 혼동 가능. '문제3 kube-bench'는 'CIS Benchmark가 무엇인지' 정의 부재
  - 보강: 각 문제의 '시험 출제 의도' 섹션 앞에 한 문단 추가: (1) 용어 정의 (예: 'NetworkPolicy의 기본값은 "allow all" - 명시적 정책이 없으면 모든 트래픽이 허용됨') (2) 선행 개념 (예: 'label selector의 AND/OR 결합 규칙: to와 ports는 AND, 여러 규칙은 OR') (3) 시험과의 연결 ('CIS Benchmark = 업계 표준 보안 체크리스트로, 기업 감사에서 요구')
- **🔴 HIGH** `용어비약` _문제5 (ServiceAccount 토큰), 문제6 (Audit Policy), 문제7 (AppArmor)_
  - 문제: 'automountServiceAccountToken' 필드가 왜 존재하는지 배경 설명 부재. '토큰 = API Server 인증 자격증'이라는 설명이 필수. Audit Policy의 '4가지 레벨(None/Metadata/Request/RequestResponse)'도 '각각 몇 바이트 로그를 생성하는가' 실제 크기 비교 없음. AppArmor '프로파일 문법'이 Linux man page 수준으로 깊지만, 왜 '#include' '단락' 'deny' 같은 구문이 필요한지 설명 부재
  - 보강: 각 문제마다 개념 설명 추가: (1) ServiceAccount 섹션: 'SA 토큰 = /var/run/secrets/..에 자동 마운트되는 JWT. 공격자가 이를 탈취하면 API Server 접근 가능 → 불필요한 Pod는 토큰을 마운트하지 않음(defense in depth)' (2) Audit Policy: '각 레벨당 대략 몇 KB 로그 생성 → 스토리지 비용 고려' (3) AppArmor: 'deny <path> w = 해당 경로의 쓰기 거부(커널 enforcer가 syscall 수준에서 차단)'
- **🟡 MED** `스토리라인누락` _전체 도입부(1~36줄)_
  - 문제: CKS 자체의 등장 배경이 없음. '왜 Kubernetes 보안이 필요한가' '기존 Docker/Linux 보안만으로는 부족한 이유' '멀티테넌트 클러스터의 위협 모델'이 명시되지 않아, 학생이 6개 도메인(RBAC/NetworkPolicy/AppArmor/...)을 개별 기술로만 봄
  - 보강: 도입부에 3~4문단 추가: (1) 'K8s 클러스터 = 수천 개 Pod이 공유 커널·네트워크에서 실행 → 한 Pod의 권한 상승이 전체 클러스터를 장악' (2) '직전 기술(Docker seccomp/AppArmor) vs K8s 추가 계층(RBAC/NetworkPolicy/PSA)의 차이' (3) '멀티테넌트 시나리오: 금융사의 여러 팀이 한 클러스터를 공유할 때 격리 요구사항' 제시
- **🟡 MED** `용어비약` _문제9 (SUID 바이너리), 메커니즘 설명_
  - 문제: SUID 비트의 내부 동작('kernel의 do_execve() 경로에서 inode.mode의 S_ISUID 확인')을 설명했으나, 실무 학생 입장에서는 '왜 /usr/bin/passwd가 SUID인가' '실제로 권한 상승이 어떻게 일어나는가' 구체 사례 부재
  - 보강: 섹션 앞에 실제 사례 3~4줄 추가: '/usr/bin/passwd는 SUID(4755)이므로, 일반 사용자가 실행해도 effective UID=0(root)으로 실행되어 /etc/shadow를 수정 가능. 그런데 SUID 바이너리에 buffer overflow 취약점이 있으면 공격자가 그 프로세스를 조종하여 root 권한 탈취(로컬 권한 상승, LPE) → Restricted SecurityContext의 allowPrivilegeEscalation=false로 이 경로를 차단(kernel no_new_privs 플래그)'
- **🟡 MED** `맥락점프` _문제 1 → 2 전환(390줄 근처)_
  - 문제: 문제1(기본 Default Deny)에서 문제2(DNS + Egress + AND/OR 규칙)로 바로 점프. 중간 난이도가 없어 급격히 복잡해짐. 초보 학생은 '문제1은 풀었는데 문제2는 왜 안 풀릴까' 혼동 가능
  - 보강: 문제1.5 추가(선택, 3점 상당): '기본 Ingress 정책 - app=web Pod만 80 포트 입장 허용' 정도의 중간 난이도 문제. 또는 문제1 설명에 'Egress 규칙 추가 시 to와 ports의 관계'를 미리 넌지시 언급
- **🟡 MED** `스토리라인누락` _문제3 (kube-bench), 문제6 (Audit Policy)_
  - 문제: '왜 API Server 설정을 수정해야 하는가'의 이야기가 부재. API Server는 etcd 데이터 게이트웨이이고, 이 설정을 바꾸면 '클러스터 전체가 먹통'될 수 있다는 리스크를 강조하지 않음. 학생이 '그냥 플래그 추가하면 되는 거네'로 가볍게 생각할 수 있음
  - 보강: 문제3 도입에 2줄 추가: 'kube-bench 실패 = CIS 권고사항 미흡, 즉 보안 설정이 약함을 의미. 이를 고치려면 API Server의 정적 파드 매니페스트를 수정해야 하는데, YAML 오류 시 API Server가 죽어 나머지 문제를 풀 수 없다는 지극히 위험한 작업 → 백업, 다량의 volume 설정, 2~3분 대기 등 매우 신중해야 함' 추가
- **🟡 MED** `실습재현불가` _전체 12문제_
  - 문제: 모든 문제에 '실제 터미널 스크린샷'이 없음. 명령어와 예상 출력은 text 블록으로 제시되어 있으나, CLAUDE.md §4①의 규칙 'text 출력 블록 금지, 반드시 실제 스크린샷'을 위반. 학생이 '실제로 이 명령이 작동하는가' 확신할 수 없음
  - 보강: 각 문제의 '검증' 단계에서 실제 dev/staging 클러스터에서 수행한 kubectl 명령의 터미널 스크린샷(PNG)을 삽입. 예: '문제1 검증 - kubectl get networkpolicy -n secure-app' 명령 후 '정책이 생성됨을 보여주는 실제 터미널 화면'. 단, 클러스터가 현재 가동 중이지 않다면 '(미캡처-환경 제약)' 표기
- **🟡 MED** `정확성오류` _문제2, egress 규칙(479줄)_
  - 문제: 주석에 'to를 생략하면 모든 IP에 대해 53번 포트를 허용한다'고 했는데, 다음 줄에서 'to를 지정하되 podSelector만 쓰면 같은 네임스페이스의 Pod만'이라고 하여 혼동 가능. 'to가 없는 경우' vs 'to를 완전히 생략하는 경우'의 의미가 불명확
  - 보강: 'to를 아예 필드에서 생략' vs 'to: [] (빈 배열)' 사이의 의미 차이를 1문단으로 명확히. 예: 'to 필드를 아예 쓰지 않으면 = 모든 목적지에 이 규칙 적용. to를 명시하되 podSelector만 쓰면 = 같은 namespace의 Pod만 매칭. to: [] (빈 배열)은 기술적으로 동일하나 명시적으로 권장하지 않음(모호함)'
- **⚪ LOW** `용어비약` _1.3 도메인별 핵심 출제 주제(80~126줄)_
  - 문제: 리소스 이름이 축약되어 있음. 'Pod exec, Pod log'는 '정확히는 subresource pods/exec, pods/log를 의미'한다는 설명 부재. 'Istio mTLS'는 '실제로는 PeerAuthentication 리소스와 istio-proxy sidecar의 상호작용'임을 명시하지 않음
  - 보강: 표 하단에 주석 추가: '* subresource: pods/exec, pods/log, pods/status 등은 RBAC에서 resources: ["pods/exec"]로 표기. * Istio mTLS: 실제 구현은 PeerAuthentication(정책) + envoy(mTLS 실행)의 조합'
- **⚪ LOW** `이해난이도` _2.2 실전 핵심 팁 20가지, 특히 팁 10 (183줄)_
  - 문제: 'kubectl explain <resource>.spec'을 '적극 활용하라'고 했으나, 이 명령이 정확히 뭐하는지(YAML 스키마 조회) 설명 부재. 학생이 '이게 뭐하는 명령인가' 알아야 실제로 시험 중 쓸 수 있음
  - 보강: 팁10에 괄호 추가: 'kubectl explain pod.spec = Pod 스키마의 spec 필드를 조회(매니페스트 작성 시 필드명·타입 확인용). 예: kubectl explain pod.spec.securityContext로 SecurityContext의 하위 필드를 빠르게 검색'
- **⚪ LOW** `스토리라인누락` _2.3 실수 10(242줄)_
  - 문제: Falco 룰을 local.yaml에 작성하는 이유('default가 업데이트될 때 덮어씌워질 수 있음')가 설명되지 않음. 학생이 '왜 local.yaml?'으로 궁금해할 수 있음
  - 보강: 실수10 해설에 1줄 추가: '/etc/falco/falco_rules.yaml은 Falco 패키지 업데이트 시 덮어씌워질 수 있으므로, 항상 local.yaml(패키지 무시)에 커스텀 룰을 작성 (best practice: base + local 분리)'
- **⚪ LOW** `용어비약` _3. tart-infra 클러스터 정보(280~294줄)_
  - 문제: 테이블의 '주요 구성'이 너무 간결함. dev 클러스터의 'CiliumNetworkPolicy 11개'는 '어떤 정책들인가' 학생이 궁금할 수 있는데 참조 링크 부재
  - 보강: '주요 구성' 열에 링크 추가: dev = 'Cilium CNI (kubeProxyReplacement=true), 11개 CiliumNetworkPolicy([manifests/network-policies](../../../manifests/network-policies/) 참고), Istio mTLS STRICT, HPA 활성화'
- **⚪ LOW** `이해난이도` _문제7 AppArmor 프로파일 문법(944~966줄)_
  - 문제: 프로파일 구문이 Linux man apparmor.d 그대로인데, 예를 들어 '#include <abstractions/base>'가 무엇인지(기본 허용 액션 세트) 설명이 약함. 'deny /** w' vs 'file,' 등의 우선순위가 명시되지 않음
  - 보강: 프로파일 앞에 3~4줄 추가: 'AppArmor 프로파일 문법: (1) #include = 기본 추상화(파일읽기·네트워크등) 로드 (2) 정책 순서 = 위에서 아래로 평가, 더 구체적인 규칙이 일반적 규칙을 오버라이드 (3) deny는 allow를 명시적으로 차단(whitelist 모드에서 blacklist 추가)'

### daily/day14.md · 가독성 4/5 · 스토리 3/5 · 합격✅

- **🔴 HIGH** `실습재현불가` _문제 13 (RuntimeClass), 문제 14 (Trivy), 문제 15 (ImagePolicyWebhook), 문제 19 (Audit Log) 등 대부분_
  - 문제: 모든 풀이에 '실제 터미널 스크린샷 이미지'가 없고 텍스트 블록(```text)만 있음. CLAUDE.md §4①에서 '명령 실행 결과는 반드시 실제 캡처 이미지'라고 명시했으나 미준수. 학생이 '실제로 이렇게 나온다'는 시각적 증거를 못 봄.
  - 보강: 각 문제의 기대 출력 블록(예: line 104-107 gVisor 커널 버전 출력, line 116-120 RuntimeClass 목록, line 374-377 ImagePolicyWebhook 거부 메시지, line 711-713 Falco 로그) 위에 실제 터미널 캡처 PNG 이미지 삽입. 최소 검증 명령 5개(문제당 2~3개)마다 1개 스크린샷 필수. CLAUDE.md의 규약을 따라 '실제 tart 클러스터에서 실행한 화면'을 캡처하여 `images/day14_*.png` 폴더에 저장 후 마크다운 `![](images/...)` 삽입.
- **🔴 HIGH** `용어비약` _문제 13 (RuntimeClass), 문제 15 (ImagePolicyWebhook)_
  - 문제: gVisor의 Sentry/Gofer 구성요소(line 57-58)와 ImagePolicyWebhook의 kubeconfig 참조(line 315-334) 설명이 있으나, '왜 gVisor는 사용자 공간 커널이 필요한가(컨테이너 탈출 공격 원리)', '왜 ImagePolicyWebhook은 외부 webhook 서비스와 통신해야 하는가(정책 중앙화 이유)'가 명시 안 됨. 학생은 '이것을 해야 한다'는 명령어는 따라 하지만 왜 그 설계인지 못 이해.
  - 보강: §4④의 스토리라인 4요소(①등장배경 ②직전기술한계 ③무엇이나아졌나 ④트레이드오프)를 각 문제의 '시험 출제 의도' 단계에서 명시. 예: 문제13에 '(배경) 일반 컨테이너(runc)는 호스트 커널 취약점으로 namespace 탈출 가능 → (이전) 단순 namespace 격리는 불충분 → (개선) gVisor 사용자 공간 커널이 70% syscall을 자체 처리해 탈출 면적 축소 → (트레이드오프) 성능 오버헤드 5~10%'. 문제15에 '(배경) 공급망 공격(악의적 이미지 공개) → (이전) 레지스트리 url을 수동으로 whitelist → (개선) webhook을 통한 정책 중앙화 (신뢰할 수 있는 빌드만 배포) → (트레이드오프) 정책 서버 다운 시 defaultAllow 설정 위험성'.
- **🔴 HIGH** `맥락점프` _문제 14 (Trivy)에서 문제 15 (ImagePolicyWebhook)로의 전환, 문제 17 (Dockerfile)의 명령형 vs 선언형 혼재_
  - 문제: 문제 14는 '이미 배포된 Pod의 이미지를 스캔해서 취약점 있는 Pod를 삭제' (탐지 후 제거). 문제 15는 '신규 Pod 배포 시 webhook이 정책으로 차단' (배포 사전 방어). 둘의 관계(Trivy는 사후·ImagePolicy는 사전)와 CIS의 20% 도메인 내에서의 위치(공급망) 연결이 없음. 또한 문제 17 Dockerfile은 '~을 저장하라'라는 파일 시스템 명령인데 `kubectl apply`나 image build 같은 실제 빌드 프로세스가 안 나옴.
  - 보강: 문제 14~16을 소개하는 대목에서 '공급망 보안의 3단계 (①배포 전 정책-ImagePolicyWebhook ②배포 후 스캔-Trivy 의존성 ③런타임 격리-RuntimeClass)'라고 명시해서 순서 관계 설정. 문제 17 Dockerfile에서 '이 Dockerfile을 실제로 docker build -t myapp . && trivy image myapp:latest로 스캔하면 CRITICAL이 줄어든다'는 검증 명령 추가.
- **🟡 MED** `이해난이도` _문제 15 (ImagePolicyWebhook) line 250-416_
  - 문제: 학생이 처음 보는 주제. AdmissionConfiguration, kubeconfig, webhook 호출 체계, defaultAllow fail-open/fail-closed, API Server 매니페스트 3가지 수정(enable-admission-plugins + admission-control-config-file + volume/volumeMount)이 한 번에 나옴. mermaid 다이어그램(line 268-287)이 있지만 '어떻게 kubeconfig가 webhook에 인증하는가', 'webhook이 없을 때 defaultAllow=false면 모든 Pod 생성이 거부되는가'라는 핵심 함정을 설명 안 함.
  - 보강: 동작 원리 섹션 직후에 '핵심 함정' 소제목 추가: ① kubeconfig는 API Server가 webhook 서버를 인증할 때 쓰는 클라이언트 인증서를 지정 (API Server ← webhook 연결이 아니라 webhook이 API Server를 신뢰하게 함, 주 방향 명시) ② defaultAllow 설정이 왜 중요한가 (webhook 서비스가 없으면 모든 요청이 실패하는데, defaultAllow=true면 허용으로 넘어가고 false면 거부로 넘어감 = fail-closed = 보안 지향) ③ 트레이드오프: 정책 서버 장애 시 모든 Pod 배포 불가 (가용성 vs 보안).
- **🟡 MED** `정확성오류` _문제 15 line 322 imagepolicy-kubeconfig.yaml에서 server: https://image-policy-webhook.default.svc:443/image-policy_
  - 문제: webhook 서비스의 정확한 FQDN과 포트를 학생이 어떻게 알아야 하는가가 명시 안 됨. 실제 시험에서 webhook 서비스가 어느 네임스페이스의 어느 이름으로 배포되어 있는지 확인하는 명령 (kubectl get svc -A | grep webhook) 같은 것이 없음. 또한 FQDN이 기본값(default.svc)이라고 가정했는데 staging 클러스터에는 webhook 서비스가 없을 수도 있음.
  - 보강: 풀이 섹션에 ① webhook 서비스 조회 명령 추가: `kubectl get svc -A | grep image-policy` 또는 `kubectl get svc -n admission image-policy-webhook` ② 기대 출력(현재 서비스가 없으면 'No resources found' 또는 실제 배포된 서비스의 FQDN과 포트 보여주기) ③ 주석: '시험에서는 webhook 서비스가 이미 배포되어 있으며, kube-bench나 문제 설명에서 이름과 네임스페이스를 알려준다. 없으면 kubectl describe를 사용해 AdmissionWebhookConfiguration을 찾아 URL을 확인한다'는 팁 추가.
- **🟡 MED** `스토리라인누락` _문제 18 (Falco) line 581-739, 특히 §4④의 '등장배경' 부분_
  - 문제: Falco는 뭐 하는 도구인가(런타임 탐지)는 있지만, '왜 kubectl audit log(API 수준)와는 다른가', '왜 시스템콜 수준 모니터링이 필요한가'가 없음. 예: Pod 내부에서 `/bin/sh` 실행 → API log에는 안 남음(kubelet이 기록 안 함) → Falco만 탐지 가능이라는 차이가 명시 안 됨.
  - 보강: 'Falco vs Kubernetes Audit Log' 비교 표 추가: Falco는 syscall 수준 (프로세스 생성, 파일 접근, 네트워크 연결)을 실시간 탐지하고, Audit Log는 API 수준 (Pod 생성, Secret 접근)을 기록한다는 차이. 예시: '`kubectl exec pod -- sh`로 대화형 셸 실행 → Audit에는 exec 이벤트로만 남지만(verb=create, resource=pods/exec) → Falco의 "Detect Shell in Container" 룰은 실제 /bin/sh 프로세스 생성을 탐지해 명령행까지 포착'.
- **🟡 MED** `스토리라인누락` _문제 20 (인시던트 대응) line 846-1018_
  - 문제: 절차(증거수집→격리→분석→제거)는 다이어그램으로 있지만, '왜 Pod를 먼저 삭제하면 안 되는가'를 구체적으로 설명 안 함. 학생은 '아, 격리하네' 하고 코드를 쓰지만, 실제 침해 상황에서 즉시 킬할 충동을 왜 저항해야 하는지 이해 못 함.
  - 보강: '증거 보존의 중요성' 섹션 추가: '(배경) Pod 삭제 시 컨테이너 프로세스 메모리·열린 파일 디스크립터·환경 변수가 모두 사라짐 → (직전기술) 전통 시스템 포렌식은 디스크 이미지 백업으로 복구 가능 but 컨테이너는 COPY-ON-WRITE이므로 런타임 상태 추적 불가 → (개선) 격리로 공격자 추가 활동 차단하면서 Pod는 Running 유지해 증거 보존 → (트레이드오프) 격리된 Pod가 자원 낭비할 수 있으므로 제한시간(예: 1시간) 설정 후 강제 삭제)'. 그리고 line 991-992의 '트러블슈팅'에 '증거 수집 명령이 실패할 때(kubectl exec가 안 되면)' 추가 절차: crictl inspect, 호스트에서 ps/netstat, 이미지 hash 확인 등.
- **🟡 MED** `구조` _문제 13~20 전체 배치_
  - 문제: 문제들이 시험 순서(1~20)로는 배열되어 있으나, CKS 도메인별 학습 경로(Cluster Setup 3% → Hardening 15% → Microservice 20% → Supply Chain 20% → Runtime 20%)와 맞지 않음. 예: RuntimeClass(문제13, 4점, Microservice)를 먼저 다루는데, 그 선수 개념인 SecurityContext(day 7, 이미지 격리)가 앞에 있으므로 다행이지만, Falco(문제18)와 Audit Log(문제19)의 순서가 바뀌면 더 자연스러움.
  - 보강: 문제 앞에 '도메인별 배치도' 추가: ① Cluster Setup (문제 1~3) ② Cluster Hardening (문제 4~6) ③ System Hardening (문제 7~9) ④ Microservice Vulnerabilities (문제 10~13) ⑤ Supply Chain (문제 14~17) ⑥ Runtime Security (문제 18~20). 각 문제 도입부에 '이 문제는 CKS 도메인의 몇 %를 차지하며, 다음 문제와 어떤 관계가 있는가'를 명시.
- **⚪ LOW** `용어비약` _문제 16 (이미지 다이제스트) line 420-489_
  - 문제: mermaid 다이어그램(line 433-447)에서 '태그가 변경될 수 있다'고는 했지만, '실제 Docker/Kubernetes 환경에서 tag 재지정이 어떻게 동작하는가' (예: nginx:1.25를 새로운 이미지로 덮어쓰면 기존 이미지는 orphan이 되고 새 hash가 할당)가 없음.
  - 보강: 다이어그램 아래에 '태그 재지정 시나리오': '①오늘 nginx:1.25@sha256:abc123을 pull해서 실행 중 ②내일 공격자가 docker.io의 nginx:1.25를 악의 코드로 덮어쓰기(tag는 같지만 content hash는 xyz789) ③새로운 Node에서 nginx:1.25를 pull하면 xyz789(악의 코드)가 받아짐 ④결과: 같은 tag인데 다른 이미지 실행'.
- **⚪ LOW** `실습재현불가` _문제 17 (Dockerfile) line 493-577_
  - 문제: '/tmp/Dockerfile-secure로 저장하라'는 명령은 있지만, '이 Dockerfile을 실제로 docker build해서 trivy로 스캔한 결과가 개선되는가'를 보여주지 않음. 학생은 Dockerfile만 쓰고 실제 빌드/검증이 없음.
  - 보강: 풀이 말미에 '검증' 섹션 추가: `docker build -t myapp:insecure -f <원본 Dockerfile> . && trivy image myapp:insecure` vs `docker build -t myapp:secure -f Dockerfile-secure . && trivy image myapp:secure` 비교 출력 (CRITICAL 감소 확인). 또는 최소한 '시험 환경에서는 Dockerfile 문법 검증(RUN, USER, HEALTHCHECK 등이 올바른가)과 보안 체크리스트 항목이 정답 기준'이라고 명시.
- **⚪ LOW** `이해난이도` _§7.2 (핵심 명령어) line 1194-1206, 특히 etcdctl 예제_
  - 문제: etcdctl 명령(line 1229-1233)이 암호화된 secret 값을 읽는 예제인데, 실제로 etcd에 저장된 형식(/registry/secrets/<ns>/<name>)과 암호화 여부를 구분하지 않음. 학생이 `etcdctl get ...`으로 조회했을 때 '이 바이너리 blob이 정말 암호화된 건가'를 판단할 수 없음.
  - 보강: etcdctl 예제 직후에 '주의': 'etcdctl get /registry/secrets/default/mysecret을 실행하면 ①암호화 미적용: plain text base64 ②암호화 적용: 바이너리 blob (k8s:enc:<algorithm>: 접두어)로 보인다. CKS 시험에서는 이 차이로 "Secret이 암호화되어 있는가"를 검증한다.'는 팁 추가.
