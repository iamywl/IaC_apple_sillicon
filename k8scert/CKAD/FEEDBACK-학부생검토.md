# CKAD 교재 — 학부 3~4학년 관점 검토 피드백

> 생성: 2026-06-12 · 파일당 1 에이전트 병렬 검토 · 기준 CLAUDE §4④

- 단독합격 **5/19** · 평균 가독성 **3.6/5** · 평균 스토리라인 **2.9/5**
- 부족분 총 **209** (HIGH 74/MED 96/LOW 39) · HIGH 카테고리: 용어비약 19, 실습재현불가 17, 맥락점프 13, 스토리라인누락 12, 정확성오류 11, 이해난이도 2

| 파일 | 합격 | 가독성 | 스토리 | H/M/L |
|:--|:--:|:--:|:--:|:--:|
| 01-concepts.md | ❌ | 3 | 3 | 6/3/1 |
| 02-examples.md | ✅ | 4 | 4 | 3/5/2 |
| 03-exam-questions.md | ✅ | 4 | 3 | 3/4/0 |
| 04-tart-infra-practice.md | ❌ | 3 | 3 | 3/4/1 |
| 05-supplement.md | ✅ | 4 | 4 | 1/6/5 |
| daily/day01.md | ❌ | 3 | 2 | 5/6/1 |
| daily/day02.md | ✅ | 4 | 4 | 0/3/7 |
| daily/day03.md | ❌ | 4 | 3 | 4/6/2 |
| daily/day04.md | ❌ | 3 | 1 | 4/5/0 |
| daily/day05.md | ❌ | 4 | 3 | 6/3/0 |
| daily/day06.md | ✅ | 4 | 3 | 5/5/3 |
| daily/day07.md | ❌ | 4 | 4 | 1/6/3 |
| daily/day08.md | ❌ | 3 | 2 | 5/7/3 |
| daily/day09.md | ❌ | 4 | 3 | 3/7/2 |
| daily/day10.md | ❌ | 3 | 2 | 8/4/2 |
| daily/day11.md | ❌ | 3 | 3 | 5/6/2 |
| daily/day12.md | ❌ | 3 | 2 | 5/4/1 |
| daily/day13.md | ❌ | 4 | 4 | 4/5/0 |
| daily/day14.md | ❌ | 4 | 3 | 3/7/4 |

---

### 01-concepts.md · 가독성 3/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `용어비약` _1.1 Dockerfile line 14_
  - 문제: UnionFS and layered filesystem introduced without simple explanation for students new to Docker
  - 보강: Add: UnionFS stacks directories; each RUN/COPY line creates a layer. Intermediate build artifacts in every layer inflate image size and slow pulls
- **🔴 HIGH** `스토리라인누락` _1.2 Init Container line 67_
  - 문제: Starts with kubelet receiving spec without explaining when scheduler places Pod or how API server delivers to kubelet
  - 보강: Begin with: scheduler places Pod on node, API server sends spec to that kubelet, kubelet then executes init containers sequentially
- **🔴 HIGH** `정확성오류` _3.1 Liveness Probe line 807_
  - 문제: Explains httpGet probe detection but omits how probe failure leads to kubelet writing Pod.condition.Ready=False, then kube-proxy removes endpoint
  - 보강: Clarify: kubelet runs probe, writes result to Pod.status.conditions[].Ready, kube-proxy watches this field and updates Service endpoints
- **🔴 HIGH** `실습재현불가` _1203-1236 ConfigMap example_
  - 문제: All command outputs rendered as ```text blocks, violating CLAUDE.md requirement for real terminal screenshots
  - 보강: Run actual kubectl on dev cluster, capture terminal screenshot, save as images/configmap-result.png, embed as markdown image
- **🔴 HIGH** `이해난이도` _2.1 Deployment line 437_
  - 문제: ReplicaSet purpose unclear: why Deployment needs intermediate ReplicaSet object for rolling updates and rollback
  - 보강: Explain: each template version gets its own ReplicaSet to track Pod history. Enables gradual Pod transition between versions and instant rollback by reactivating prior ReplicaSet
- **🔴 HIGH** `맥락점프` _4.2 Secret line 1260_
  - 문제: Correctly states base64 is encoding not encryption, but then states plaintext is stored as base64-encoded, risking student misunderstanding of reversibility risk
  - 보강: Emphasize: base64 is reversible text encoding. Anyone with etcd or node disk access can run `base64 -d` to recover plaintext. Requires etcd encryption or external vault
- **🟡 MED** `구조` _3.1 Liveness + 3.2 Readiness + 3.3 Startup lines 806-1031_
  - 문제: Three probe types have overlapping mechanics (startup blocks liveness/readiness; readiness denies traffic) but detailed explanation scattered, causing duplication
  - 보강: Create single unified mechanism section: kubelet executes probe, writes Pod.status.condition, kube-proxy/kubelet observes and reacts. Show timing diagram once. Keep use-case sections separate
- **🟡 MED** `용어비약` _4.3 ServiceAccount line 1299_
  - 문제: TokenRequest API, projected volume, bound token appear in one sentence without explanation; no transition story from pre-1.24 auto-Secret to 1.24+ model
  - 보강: Add: pre-1.24 auto-created long-lived Secret. 1.24+: kubelet calls TokenRequest API (requests short-lived audience-bound token) and mounts via projected volume (multi-source mounts)
- **🟡 MED** `이해난이도` _2.3 Canary line 605_
  - 문제: States replica ratio equals traffic ratio but omits explanation that Service round-robins equally across all endpoint Pod IPs
  - 보강: Clarify: Service lists all Pod IPs in Endpoints; kube-proxy does round-robin distribution. Thus 9 stable + 1 canary Pod = all 10 endpoints equally weighted = 10 percent traffic to canary
- **⚪ LOW** `맥락점프` _1.4 ConfigMap Volume line 319_
  - 문제: Subpath prevents auto-update but reason (no symlink refresh) not explained; overlay filesystem concept introduced without definition
  - 보강: Detail: without subPath, ConfigMap mounted via symlinks that kubelet atomically updates. With subPath, direct file mount, no symlink-based refresh. Trade-off: auto-update speed vs file existence

### 02-examples.md · 가독성 4/5 · 스토리 4/5 · 합격✅

- **🔴 HIGH** `실습재현불가` _§4 (Probe 전체) ~ §13 (시험 팁 말미)_
  - 문제: 모든 검증 명령의 출력이 ```text 텍스트 블록인데, CLAUDE.md §4①의 '절대 규칙'에 명시된 바에 따르면 '명령 실행 결과는 무조건 실제 터미널 스크린샷 이미지여야 하며, 텍스트 블록은 금지'임. 학부생이 이 파일만으로는 '이 명령을 정말 실행했을 때 이렇게 나오는가'를 증명할 수 없음
  - 보강: 모든 검증 명령(kubectl apply, get, describe, logs 등)의 실제 클러스터 출력을 터미널 스크린샷으로 캡처하여 `images/` 디렉토리에 저장 후 마크다운 `![설명](images/파일명.png)`으로 삽입. 예: §4의 'kubectl describe pod liveness-http | grep -A 10 Liveness'의 출력을 실제 스크린샷으로. 다만 짧은 단발 조회(kubectl run <단일 명령>)는 텍스트 블록 허용
- **🔴 HIGH** `용어비약` _§1 (Dockerfile), line 40-43: CGO_ENABLED, GOOS, capabilities 설명_
  - 문제: 학부생이 이 용어들을 처음 본다면 '이게 뭔데?'라고 막힘. 예를 들어:
1. 'CGO_ENABLED=0 → C 라이브러리 의존성 제거 → 정적 바이너리'의 인과관계가 설명 없음 (cgo가 뭔지, C 라이브러리 링킹이 뭔지 전제)
2. 'GOOS=linux' → '타겟 OS 지정'은 맞지만, '빌드 호스트의 OS를 따름 (macOS에서 빌드하면 linux에서 실행 불가)'의 "왜"가 설명 안 됨 (CPU 아키텍처, ELF vs Mach-O 포맷)
3. capability는 리눅스 권한 메커니즘인데, Pod 컨텍스트에서 왜 필요한지 배경이 없음 (root UID는 있지만 특정 시스템 콜만 차단하는 세밀한 제어가 필요)
  - 보강: 각 용어 첫 등장 시 1-2문장 직관 추가:
- 'CGO_ENABLED=0: Go의 cgo(C와 Go 상호호출)를 비활성화. cgo는 C 라이브러리를 동적 링크하는데, alpine 같은 작은 런타임 이미지에는 libc가 없으므로 링크 실패 방지'
- 'GOOS=linux: 바이너리 포맷(x86-64, ARM 등 머신코드)은 OS별로 다르므로, macOS에서 빌드한 바이너리는 linux에서 실행 불가'
- 'Linux capability(숨겨진 권한): root는 UID 0이지만 모든 권한을 가짐. 근데 nginx는 1024 이하 포트 바인딩만 필요하니까, 이 권한만 주는 것이 보안(CAP_NET_BIND_SERVICE)'
- **🔴 HIGH** `맥락점프` _§2 (Multi-container Pod) → §3 (Probe) 전환점, line 343-360_
  - 문제: Multi-container는 sidecar/adapter/init 패턴이므로 "관련 프로세스를 함께 배포"하는 것. Probe는 "개별 프로세스가 정상인지 헬스 체크". 두 주제가 "Pod 내 컨테이너"라는 공통점만 있고, 논리적 연결이 없음. 학부생이 '어? 왜 갑자기 health check가 나와?'라고 느낄 수 있음
  - 보강: §3 서두에 1-2문장 전환: '지금까지 여러 컨테이너를 한 Pod에 함께 배포하는 방법을 배웠다. 하지만 컨테이너가 실행 중이라고 해서 애플리케이션이 정상 동작하는 건 아니다(데드락, 메모리 누수, 외부 서비스 장애). Probe는 이런 "살아있지만 비정상" 상태를 감지하여 자동 복구하는 쿠버네티스 헬스 체크 메커니즘이다.'
- **🟡 MED** `이해난이도` _§2 (Init Container), line 180 "restartPolicy: Always(기본값)이면 실패한 Init Container를 재실행한다"_
  - 문제: Init Container는 메인 컨테이너가 시작되기 전에만 실행되고, 실패하면 Pod 전체가 재시작됨. 이 문장은 '실패한 Init을 재실행'이라고 했는데, 정확히는 '실패한 Init의 상태를 reset하고 Pod 재시작 시 Init부터 다시 실행'이라는 뉘앙스의 차이가 있음. 학부생이 '어? 그럼 Init이 무한 루프면 자동 복구되나?'라고 오해할 수 있음
  - 보강: 문장 명확화: '실패한 Init Container가 있으면 kubelet은 Pod의 restartPolicy에 따라 처리한다: Always(기본)이면 전체 Pod을 재시작하여 Init부터 다시 실행(무한 루프 가능성 있음), Never이면 Pod이 Failed 상태로 머무름, OnFailure이면 재시작 횟수 제한까지 재시도.'
- **🟡 MED** `정확성오류` _§6 (SecurityContext), line 1036 "readOnlyRootFilesystem 사용 시: nginx는 `/var/cache/nginx`, `/var/run`, `/tmp`에 쓰기가 필요하다"_
  - 문제: nginx가 /tmp에 쓰기를 필수로 하진 않음. 실제로는 /var/cache/nginx(캐시), /var/run(PID/소켓) 정도만 필수. /tmp는 임시 버퍼용으로 사용할 수 있지만 선택사항. 예제에서 /tmp를 마운트한 것은 좋은 관행이지만, '필수'라고 단정하면 다른 애플리케이션에서 착각할 수 있음
  - 보강: 문장 정정: 'nginx는 /var/cache/nginx(캐시), /var/run(PID/소켓)에 쓰기가 필수이며, 임시 버퍼를 위해 /tmp도 마운트하는 것이 권장됨.'
- **🟡 MED** `스토리라인누락` _§8 (Service) → §9 (Ingress), line 1519-1526_
  - 문제: Ingress의 등장 배경은 '포트 관리 복잡도'만 설명함. 하지만 더 깊은 이유가 있음: Service는 Pod IP를 추적하지만, 실제로는 L4(포트) 기반이므로 각 애플리케이션이 다른 포트를 써야 함. HTTP라는 L7 프로토콜 특성(Host 헤더, Path)을 활용하면 80/443만으로 모든 서비스를 라우팅 가능 → 더 효율적. 이 원리가 설명되지 않으면 'Ingress는 LB의 상위호환'으로만 이해됨
  - 보강: 등장 배경 보충: '...수십 개의 Service가 있으면 포트 관리가 복잡해진다. 더 큰 문제는 HTTP 애플리케이션은 요청 메타데이터(Host 헤더, URL 경로)를 가지는데, Service는 이를 인식하지 못하고 port/targetPort만 분석하므로, 같은 포트(80)에서 여러 도메인을 호스팅할 수 없다. Ingress는 HTTP를 직접 파싱하여 호스트명과 경로로 라우팅하므로, 단일 공개 IP(80/443)에서 무수히 많은 서비스를 운영할 수 있다.'
- **🟡 MED** `구조` _§13 (시험 팁), line 2251 onwards_
  - 문제: 시험 팁 섹션이 실제로는 '실행 팁 (alias, dry-run, explain, 조회, 편집)'을 모은 것인데, 이것이 앞 12개 섹션의 '개념 학습'과 섞여 있음. 학부생이 처음부터 끝까지 읽을 때는 '앞에서 배운 명령들은 어떻게 빠르게 칠까?'라는 맥락이 필요한데, 이 파일은 개념 예제 모음이라서 급작스러움
  - 보강: 구조 개선 (선택): 파일을 두 부분으로 나누거나, 또는 §13을 '02-examples-advanced-tips.md'로 분리. 또는 현 위치 유지하되, 서두에 '본 섹션은 앞의 개념들을 시험 환경(2시간 15~20문제)에서 빠르게 적용하는 테크닉을 다룬다'고 명시
- **🟡 MED** `용어비약` _§7 (Deployment), line 1099-1111 "Deployment 내부 동작 흐름"_
  - 문제: 흐름 설명이 맞지만, 5단계 중 'API 서버 → etcd' 저장과 'kube-controller-manager의 Deployment controller'가 분리되어 있음. 학부생이 'Deployment controller가 어디서 도는가?'를 모를 수 있음. 또한 '새로운 ReplicaSet을 생성한다'라고 했는데, ReplicaSet이 뭔지 이전에 설명한 적이 있는가? (§7은 Deployment만 다루므로 없음)
  - 보강: ReplicaSet 간단 정의 추가: '...ReplicaSet은 Pod 복제본 수를 유지하는 쿠버네티스 오브젝트(§7에서 상세 설명)...' 또는 '§1.1 Deployment 이전에 ReplicaSet 개념을 1-2문단 추가 (별도 섹션 또는 각주)'
- **⚪ LOW** `용어비약` _§3 (Probe), line 359 "kubelet이 각 노드에서 직접 Probe를 실행한다. API 서버나 controller-manager가 아닌 kubelet이 담당한다"_
  - 문제: 왜 kubelet이 하고 API 서버가 아닌가? 학부생은 '그런가 보네' 하고 넘어감. 실제로는 kubelet이 각 노드에 있기 때문에 Pod에 직접 접근 가능하고, API 서버는 클러스터 중앙에 있어서 네트워크 오버헤드가 클 수 있다는 배경이 있음
  - 보강: 부연 설명: '...kubelet이 담당한다는 점이 중요하다. kubelet은 각 노드의 컨테이너 런타임 옆에 있어 Pod에 직접 접근 가능하며, Probe 결과를 API 서버에 보고한다. 반대로 API 서버가 중앙에서 모든 Pod에 Probe를 보냈다면 네트워크 비용이 크고 지연이 커진다.'
- **⚪ LOW** `이해난이도` _§7 (Deployment), line 1156-1157 "readinessProbe ... initialDelaySeconds: 5"_
  - 문제: 예제 YAML에서 readiness의 initialDelaySeconds가 5초인데, 같은 Deployment의 liveness는 10초. 왜 다른가? 문제의 맥락상 특별한 이유가 없는 것 같음. 학부생이 '이게 최선의 값인가?'라고 의심할 수 있음
  - 보강: 주석 또는 설명 추가: '# readiness는 빠르게 트래픽을 시작하기 위해 짧게(5초), liveness는 오정탐을 줄이기 위해 길게(10초) 설정한 예시. 실무에서는 애플리케이션 초기화 시간에 따라 조정'

### 03-exam-questions.md · 가독성 4/5 · 스토리 3/5 · 합격✅

- **🔴 HIGH** `스토리라인누락` _문제 1~40 전체_
  - 문제: 각 기술이 등장한 역사적 배경, 이전 기술의 한계, 개선점, 트레이드오프가 전무함. '이 기술을 왜 배워야 하는가'의 맥락이 없음. CLAUDE.md의 §4④ 스토리라인 필수 요건 미충족
  - 보강: 각 도메인(Design/Build, Deployment 등) 또는 문제군(1~8, 9~16 등)의 앞머리에 '등장 배경'섹션 추가. 예: '01~08 Design & Build 시작 전' → 'Dockerfile의 진화(FROM → ENTRYPOINT → 멀티스테이지의 필요성)', 'Init Container가 나온 이유(서비스 의존성 관리의 어려움)', '사이드카 패턴의 탄생(로깅의 횡단 관심사)'. 각 섹션 300~500자
- **🔴 HIGH** `실습재현불가` _모든 검증 섹션의 ```text 블록_
  - 문제: CLAUDE.md §4① '명령 실행 결과는 실제 터미널 스크린샷 PNG 이미지만 허용, 텍스트 블록 금지'인데, 파일의 모든 검증 출력이 ```text 마크다운 블록으로만 제시됨. 학생이 '실제로 이렇게 나온다'는 화면 증거가 없음
  - 보강: 현재 ```text 블록을 모두 삭제하고, 대신 실제 클러스터(dev/staging)에서 명령을 실행해 스크린샷을 캡처한 뒤 `k8scert/CKAD/images/` 폴더에 저장하고 마크다운 `![](images/...)` 형식으로 삽입. 예: `![문제 1 검증 - Dockerfile 빌드 출력](images/prob01-docker-build.png)`. 캡처할 명령: kubectl get pod, kubectl describe, kubectl logs, docker build, docker history 등
- **🔴 HIGH** `용어비약` _문제 2 (Init Container), 문제 5 (Ambassador 패턴), 문제 6 (emptyDir medium: Memory), 문제 11 (Canary 배포), 문제 25 (SecurityContext), 문제 36 (NetworkPolicy)_
  - 문제: 이 기술들이 처음 등장할 때 사전 개념이 부족함. 예: Init Container 설명 전에 '왜 마이크로서비스 환경에서 서비스 의존성을 해결해야 하는가', Ambassador 패턴 전에 '프록시란 뭔가, 로드밸런싱 vs 라우팅의 차이', medium: Memory 전에 'tmpfs의 I/O 특성(RAM 기반)', Canary 전에 'rolling update의 단점(순식간 트래픽 급증)', SecurityContext 전에 'Linux UID/GID/capability의 개념', NetworkPolicy 전에 'CNI 플러그인이 뭔가, iptables/ipvs의 역할'이 필요
  - 보강: 학부 3~4학년이 사전지식 없이 이해할 수 있도록 각 문제의 '핵심 원리' 앞에 한 단락의 '개념 입문'을 추가. 예: [문제 2] 앞에 '마이크로서비스: 여러 서비스가 서로를 호출하는 구조. 의존성: A가 B가 준비될 때까지 기다려야 한다는 뜻. Init Container는 메인 컨테이너 시작 전에 '환경 체크' 역할을 하는 임시 컨테이너다.'와 같은 30~50자 직관
- **🟡 MED** `이해난이도` _문제 15 (HPA), 문제 27 (QoS), 문제 31 (Downward API), 문제 36 (NetworkPolicy)_
  - 문제: 복합 개념이지만 설명이 단편적임. HPA는 metrics-server 의존성/계산 공식 설명이 너무 짧음. QoS는 eviction 순서가 언급만 되고 왜 그런지(우선순위 스케줄링) 설명이 없음. Downward API는 'fieldRef vs resourceFieldRef' 차이가 불명확. NetworkPolicy는 'AND vs OR' 연결 규칙이 복잡하지만 예제가 3줄
  - 보강: 복합 개념에 대해 '내부 동작' 섹션을 1~2단락 확대. 예: [HPA] '1. metrics-server가 15초마다 kubelet의 cAdvisor에서 메트릭 수집(CPU/메모리 실사용 사실상 데이터) → 2. HPA controller가 이 데이터로 공식(desiredReplicas = ceil(currentReplicas * (currentMetricValue / targetMetricValue))) 적용 → 3. ReplicaSet의 replicas 필드 변경 → 4. kubelet이 Pod 추가/제거. 이 모든 과정이 requests 기준이므로 requests가 없으면 분모가 없어 계산 불가'와 같이
- **🟡 MED** `맥락점프` _문제 9 (RollingUpdate)에서 문제 11 (Canary)로, 문제 25 (SecurityContext)에서 문제 26 (ServiceAccount)로, 문제 33 (Service)에서 문제 36 (NetworkPolicy)로의 전환_
  - 문제: 연속된 문제 간의 맥락 연결이 약함. 문제 9의 롤링 업데이트와 문제 11의 카나리가 서로 어떤 관계(무중단 배포 전략의 스펙트럼)인지 명시 안 됨. 문제 25의 컨테이너 보안과 문제 26의 API 권한 관리가 '최소 권한 원칙'으로 연결되지 않음. 문제 33의 Service 엔드포인트와 문제 36의 NetworkPolicy가 같은 트래픽 경로를 제어한다는 점이 불명확
  - 보강: 각 도메인/섹션 경계에 '이 섹션 학습 순서와 관계'를 한 줄 추가. 예: [Deployment 도메인 시작 전] '9~12: 업데이트 전략(Rolling, Canary, Blue-Green) 비교 → 13~16: 패키지/설정 도구(Helm, Kustomize, HPA, annotation) 활용'. [Networking 도메인 시작 전] '33~35: Service와 Ingress(트래픽 수신) → 36~40: NetworkPolicy와 DNS(트래픽 제어/서비스디스커버리)'
- **🟡 MED** `정확성오류` _문제 18 (StartupProbe) 출력, 문제 20 (kubectl debug) 상세, 문제 25 (SecurityContext capabilities)_
  - 문제: 문제 18에서 '최대 대기 시간 = periodSeconds * failureThreshold = 10초 * 30회 = 300초(5분)' 맞지만, initialDelaySeconds 대비 설명이 없음. 문제 20에서 'ephemeral container 이름이 debugger-abc12'라고 하는데 실제로는 kubectl이 자동 생성하는 이름의 형식을 명확히 안 함. 문제 25에서 CapBnd: 0x400 설명이 '이것이 NET_BIND_SERVICE(비트 10번)를 의미한다'는 16진 변환 과정이 학부생 수준에서 명확하지 않음
  - 보강: [문제 18] initialDelaySeconds 기본값 0 명시. [문제 20] 'kubectl debug가 debugger-XXXXX 이름을 자동 생성하며, Pod annotation에도 등록됨' 추가. [문제 25] 'Linux capability 번호 체계(0=CAP_CHOWN, 1=CAP_DAC_OVERRIDE, ..., 10=CAP_NET_BIND_SERVICE)' 간단 설명 또는 '0x400 = 10번째 비트 = NET_BIND_SERVICE' 1줄 설명 추가
- **🟡 MED** `구조` _문제 소개 부분(도메인별 배분)_
  - 문제: 처음 '도메인별 배분' 표에서 '문제 1~8', '9~16' 등으로 대략 안내하지만, 실제 마크다운에는 섹션 제목(## Application Design and Build 등)만 있고 각 섹션 시작에 '이 섹션의 학습 목표 | 소요 시간 | 전제 지식'이 없음
  - 보강: 각 대도메인(Design & Build, Deployment, Observability, Config & Security, Networking) 시작 전에 한 문단 추가: '# Application Design and Build (문제 1~8) 
> 학습 목표: 컨테이너 이미지 최적화, 멀티 컨테이너 패턴, 상태 관리 기초 이해 | 예상 소요: 120분 | 전제지식: Docker Dockerfile 기본문법, Pod/컨테이너 개념'

### 04-tart-infra-practice.md · 가독성 3/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `용어비약` _Lab 1.1 (119줄), Lab 4.8 (2742줄) 등 전체 산재_
  - 문제: 처음 등장하는 용어(MutatingAdmissionWebhook, Envoy, mTLS, xDS, iptables, capabilities) 1줄도 풀이 없음. 사전지식 가정
  - 보강: 각 용어 첫 등장 시 다음 구조: '[용어] (기술 분류/역할): [직관적 1줄] -> [정의 1줄] -> [예시]'. 예: 'Envoy (프록시 소프트웨어): 차량의 외교관처럼 트래픽 흐름을 제어한다 -> Istio가 각 Pod 옆에 배치하는 프록시로, 애플리케이션 코드 수정 없이 mTLS, 메트릭 수집 등을 수행한다 -> 예: Pod A의 nginx가 http://localhost:80으로 요청 -> Envoy가 10.0.1.5:80으로 프록시'
- **🔴 HIGH** `스토리라인누락` _Lab 2.4 Canary 배포 (2523-2542줄)_
  - 문제: '정밀도가 낮다' 한 문장만 있고, 구체적 사례 없음. 학생이 '왜 Istio를 써야 하나?'를 이해 못함
  - 보강: 현재: 'DaemonSet 방식은 정밀도가 낮다' / 개선: 'DaemonSet 방식은 Pod 수 비율로만 분배 가능하다. 예: 10% canary를 보내려면 stable 9 + canary 1 = 총 10개 Pod 필요(리소스 낭비). Istio weight는 Pod 수와 무관하게 stable 1 + canary 1에서 weight 90:10으로 분배 가능(효율적)'
- **🔴 HIGH** `맥락점프` _Lab 1.5 Volume (1398줄) vs Lab 4.1 ConfigMap (3873줄) 거리 2500줄_
  - 문제: ConfigMap이 이미 Lab 1.5에서 사용되지만, 'ConfigMap은 설정 주입 리소스'라는 개념은 Lab 4에서 소개. 학부생이 '1.5에서 configMapRef를 쓰는데, 그게 뭐라고?'라고 막혔
  - 보강: 실습 2(Deployment) 앞에 '실습 1B: 설정 리소스(ConfigMap/Secret)' 섹션 추가(2-3개 Lab), 또는 Lab 1.5 직후 'ConfigMap 개요'(200줄) 컴팩트 삽입. 사용 먼저, 개념 나중 순서로 재배치
- **🟡 MED** `이해난이도` _Lab 4.8 capabilities (4360-4373줄)_
  - 문제: 'CapInh: 0x400 = bit 10 = NET_BIND_SERVICE' 2진 비트 연산과 capability 마스크 해석 요구. CKAD는 이 깊이를 묻지 않음. 대신 '어떤 capability를 drop하면 어떤 조작이 불가능해지나?'만 물음
  - 보강: Lab 4.8 전체 재작성: 구체적 사례 중심으로(예: 'CAP_NET_BIND_SERVICE 없으면 1024 미만 포트에 바인딩 불가, CAP_SYS_TIME 없으면 시스템 시간 변경 불가') 하고, /proc/1/status 16진수 파싱은 '참고'로 축소
- **🟡 MED** `실습재현불가` _전체 검증 섹션(약 200개), 예: 45-58줄, 205-223줄, 2042-2055줄_
  - 문제: 모든 명령 출력이 ` ```text ` 텍스트 블록 형식. CLAUDE.md 규약위반(§4①: 실제 터미널 스크린샷만 허용, 텍스트 블록 금지). 학부생이 자신의 결과와 정확히 비교 불가(폰트, 배경, 타이밍 차이 처리 불가)
  - 보강: 현재 ` ```text ` 블록 200개를 스크린샷으로 교체. 방법: (1) 실제 tart 클러스터에서 각 명령 실행 (2) screencapture로 PNG 캡처 (3) k8scert/CKAD/images/ 저장 (4) ` ![](images/lab-X-step-Y.png) ` 삽입. 큰 파일이므로 Python/bash로 자동화 가능(예: for i in {1..6250}; do grep -n '```text' ... | capture_screenshot)
- **🟡 MED** `정확성오류` _2280-2282줄, 1704줄_
  - 문제: (1) 'maxSurge=1, maxUnavailable=0 -> 최소 3개 Pod 유지' 설명 후, 검증에는 한순간 4개 Pod 동시 실행. 혼동 가능 (2) 'sizeLimit 초과 시 약 2분 후' -> 실제는 kubelet의 evictionScannerInterval(기본 2분) 변수이므로 학부생이 '정확히 120초인가?'라고 의심
  - 보강: (1) '...최소 3개 Running 유지되되, 새 Pod Ready 직후 구 Pod 종료 전까지 최대 4개(3+1) 동시 실행' 명확히 (2) '...kubelet의 디스크 체크 주기(기본 evictionScannerInterval=10s, 실제 evict는 누적 여러 주기 후)에 따라 약 1-5분 내 evict' 범위 확장
- **🟡 MED** `구조` _Lab 1.6 Dockerfile 최적화 (1741-1883줄)_
  - 문제: 실습(Step)이 없음. 모두 '확인 명령어' 수준(Step 1: 이미지 목록 확인, Step 2: 크기 비교, Step 3: 분석). 4겹 구조의 '직접 해보기' 부재. CKAD는 '직접 Dockerfile 작성'을 묻지 않으므로 이 Lab의 위치와 깊이 부적절
  - 보강: Lab 1.6 축소(내용 절반) 또는 Lab 1.4 끝에 '비고' 문단으로 통합. 혹은 'Lab 1.6: 이미지 레이어 분석 (읽기 전용)' 명시하고, 실습 없음을 기입
- **⚪ LOW** `용어비약` _Lab 3.6, 3.7 ephemeral container (3744-3793줄)_
  - 문제: 'distroless 이미지'라는 용어가 첫 등장 시 정의 없음. 'distroless (배포판 없는 최소 이미지): 애플리케이션 런타임만 포함하고 OS 도구(sh, curl 등)가 없음'으로 1줄 추가 필요
  - 보강: Lab 3.7 '등장 배경' 섹션에서 distroless 첫 언급 직후: 'distroless (배포판 없는 최소 이미지, 예: gcr.io/distroless/base): 애플리케이션 런타임만 포함하고 셸과 OS 진단 도구가 없어 kubectl exec로 디버깅 불가' 1줄 삽입

### 05-supplement.md · 가독성 4/5 · 스토리 4/5 · 합격✅

- **🔴 HIGH** `실습재현불가` _Part 1 (1.1-1.6), Part 2 (예제 1-10)의 모든 검증 섹션_
  - 문제: 검증 명령어의 기대 출력이 모두 ```text``` 블록의 텍스트다. CLAUDE.md §4①에서 '명령의 실행 결과는 실제 터미널 스크린샷 이미지만 허용'이라고 했으나, 여기는 텍스트 블록만 있다. 학부생 입장에서 '이 명령을 정말 실행했을 때 이렇게 나올까?'를 신뢰할 수 없음.
  - 보강: 모든 검증 섹션을 실제 dev/staging 클러스터에서 실행하고 터미널 스크린샷(PNG)을 캡처해 k8scert/CKAD/images/ 폴더에 저장한 후, 마크다운에서 `![](images/01-statefulset-get.png)` 형식으로 삽입. 텍스트 블록은 제거.
- **🟡 MED** `스토리라인누락` _Part 2 예제 2-8 전반_
  - 문제: DaemonSet, CronJob, HPA, Job, PVC, NetworkPolicy, Probes 각 예제에서 '등장 배경' 섹션은 있으나 '이전 기술과의 한계 비교'가 명확하지 않음. 예: Job의 배경에서 'Deployment로는 안 되는 이유'가 간략함. CronJob도 '기존 외부 스케줄러의 한계'가 구체적이지 않음.
  - 보강: 각 예제 배경에 '이전에는 이렇게 했다 → 문제점: OOO → 새 기술이 OOO로 해결' 형식의 1-2문장 추가. 예: 'Deployment로 batch 작업을 하면 Job이 완료되어도 Pod가 계속 재시작되므로 리소스 낭비. Job은 completions 조건에서 종료되고 재시작하지 않는다.'
- **🟡 MED** `스토리라인누락` _Part 3 문제 1-8 (Application Design)_
  - 문제: 각 문제의 풀이에 '등장 배경' 섹션이 있으나 매우 간략함(1-2문장). StatefulSet 문제 1에서 'MySQL 인스턴스가 고유한 데이터 디렉터리를 가져야 한다'는 설명은 있으나, Deployment로 할 수 없는 이유(Pod 이름이 무작위, 스토리지 재연결 보장 없음 등)가 명확하지 않음.
  - 보강: Part 3 각 문제의 '등장 배경' 섹션을 '배경(1문) + 직전 기술 한계(2문) + 개선점(1-2문)' 구조로 확장. 예: 'Init Container 문제에서: "메인이 준비 안 된 상태에서 뜨는 문제 → 그냥 재시도하면 반복 실패 → Init Container는 순차 실행으로 사전 조건 검증"'
- **🟡 MED** `용어비약` _Part 1 1.2 DaemonSet 내부 동작 상세 섹션_
  - 문제: '1.12 이후로는 nodeAffinity를 사용하여 스케줄러를 통해 배치한다'는 설명이 있으나, nodeAffinity와 nodeName의 차이가 학부생 수준에서 불명확. 또한 'taint/toleration 처리'라는 용어가 갑자기 등장하는데, DaemonSet 섹션에서 taint/toleration이 아직 정의되지 않음(1.3에서 정의).
  - 보강: 1.2에서 nodeAffinity/nodeName 차이를 한 줄로: 'nodeName은 스케줄러를 건너뛰고 직접 할당, nodeAffinity는 스케줄러가 조건을 평가 후 할당하므로 리소스와 taint를 존중함.' Taint/toleration 언급은 1.3 링크로 미루거나, 간단히 '노드의 스케줄링 조건'으로만 표현.
- **🟡 MED** `맥락점프` _Part 1 1.3 Taints and Tolerations 예제 코드 블록_
  - 문제: Toleration YAML 예제에서 ```yaml 코드 블록이 pod spec 스니펫 형태다. 전체 Pod YAML이 아니므로 학생이 복사해서 `kubectl apply -f`로 바로 실행할 수 없음. Part 2 예제부터는 완전한 YAML을 주는데, Part 1은 일부만 제시해 일관성이 없음.
  - 보강: Part 1 모든 YAML 코드 블록을 완전한 리소스 정의로 변경(Pod 전체, Service 포함). 또는 '이는 .spec.tolerations만 발췌' 같은 명시 추가.
- **🟡 MED** `정확성오류` _Part 1 1.6 ServiceAccount 토큰 자동 마운트 - 내부 동작 원리_
  - 문제: 'token을 /var/run/secrets/kubernetes.io/serviceaccount/token에 파일로 마운트한다'는 설명이 있으나, projected volume의 구체적 동작이 빠짐. Projected volume이 무엇인지 정의 없이 사용됨. 또한 'kubelet이 TokenRequest API를 호출'이라는 표현이 정확하지 않음 — kubelet이 호출하는 게 아니라 admission controller가 주입하는 것.
  - 보강: Projected volume: '여러 출처(ServiceAccount 토큰, CA 인증서, 네임스페이스)의 정보를 하나의 마운트 포인트로 합치는 가상 볼륨' 정의 추가. TokenRequest API 주체를 '서비스어카운트 토큰 컨트롤러(serviceaccount token controller)가 주기적으로 TokenRequest API를 호출해 새 토큰 발급' 으로 수정.
- **🟡 MED** `스토리라인누락` _Part 4 기출 유형 Q1-Q30 전반_
  - 문제: 각 문제의 '등장 배경' 섹션이 많지만, 문제별로 길이와 깊이가 불균형. Q1(Multi-Container) 배경은 2-3문장인데, Q6(SecurityContext) 배경은 2문장도 안 됨. 또한 '이 문제가 CKAD 시험에서 몇 % 비중인지' 같은 맥락이 없음.
  - 보강: 각 기출 문제 앞에 '배경(왜 이 기술이 필요한가) + CKAD 비중(약 X%) + 소요 시간(약 X분)'을 한 줄로 정리.
- **⚪ LOW** `이해난이도` _Part 1 1.4 RBAC 예제의 검증 명령어_
  - 문제: RBAC 검증에서 `kubectl auth can-i delete pods -n demo --as=system:serviceaccount:demo:app-sa` 명령이 등장하는데, --as 플래그가 설명되지 않음. 학생이 이 플래그가 '특정 사용자로 가장해 권한 확인'한다는 것을 알 수 없음.
  - 보강: 검증 섹션 첫 명령 전에 '권한 확인 명령': `kubectl auth can-i <verb> <resource> --as=<user>` 형식으로 1줄 설명 추가.
- **⚪ LOW** `용어비약` _Part 2 예제 3. CronJob - 내부 동작 원리 섹션_
  - 문제: 'startingDeadlineSeconds를 초과하면 Job 생성이 스킵된다'는 설명이 있으나, 이 값의 의미가 불명확. 학생이 '얼마나 설정해야 하나?'를 판단할 수 없음.
  - 보강: startingDeadlineSeconds 설명에: '스케줄 시간을 놓쳤을 경우 이 초 이내면 Job을 생성, 초과하면 스킵. 기본 0(무시). 예: 매 2시간 실행 Job이 5시간 가동 중지됐다면, startingDeadlineSeconds=3600 미만이면 스킵된다.' 예시 추가.
- **⚪ LOW** `용어비약` _Part 3 문제 25 QoS 클래스_
  - 문제: 'OOM score가 높은 프로세스부터 종료'라는 표현이 있으나, OOM score의 계산 방식(메모리 사용량 기반)이 명확하지 않음. Guaranteed가 -997인 이유가 설명되지 않음.
  - 보강: OOM score 계산식 추가: 'OOM score = (memory_used / memory_limit) * 1000. Guaranteed는 requests=limits이므로 초과 사용이 불가능 → -997(최후 순위). BestEffort는 제약이 없어 1000(최우선 종료).' 또는 표의 설명을 확장.
- **⚪ LOW** `구조` _Part 2 예제 7-8 (NetworkPolicy, Probes)의 검증 섹션_
  - 문제: 예제 8 Probes에서 검증이 `kubectl describe pod`로 probe 설정만 확인하는데, 실제로 probe가 동작하는 것(Startup 성공 → Liveness/Readiness 활성화)을 보여주지 않음. 학생이 '정말 작동하나?'를 의심할 수 있음.
  - 보강: 예제 8 검증에 'Pod 로그'를 추가해서 Startup 성공 후 애플리케이션이 정상 작동함을 보여줌. 또는 '실제로는 느린 초기화(sleep 30초)를 해보고 Startup이 대기하는 것을 확인'하는 시나리오 추가.
- **⚪ LOW** `용어비약` _Part 3 문제 8 Dockerfile 최적화 - 다단계 빌드_
  - 문제: 'FROM python:3.11-slim AS builder' 구문이 설명 없이 등장함. 학부생이 '이게 뭐지?'할 수 있음. 다단계 빌드(multi-stage build)의 개념이 정의되지 않음.
  - 보강: Dockerfile 분석 문제 앞에 '다단계 빌드(multi-stage build): 첫 번째 stage(builder)에서 빌드를 수행하고, 두 번째 stage(최종 이미지)에서 빌드 산출물만 복사. 이렇게 하면 빌드 도구 등 불필요한 파일을 최종 이미지에서 제외 가능.' 1-2문장 설명 추가.

### daily/day01.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `용어비약` _1.2 공학적 정의 문단 (line 22-23)_
  - 문제: Linux Network Namespace, IPC Namespace, UTS Namespace, cgroup, veth pair가 풀이 없이 등장. 학부생이 이들 개념을 알 수 없음
  - 보강: 각 용어 첫 등장 시 한 줄 풀이 추가: 'Namespace = OS 레벨에서 프로세스 자원(네트워크·파일시스템·PID)을 분리하는 리눅스 기능. veth pair = 가상 네트워크 인터페이스 쌍으로 컨테이너가 호스트 네트워크와 연결되는 방식. cgroup = 프로세스 그룹의 리소스(CPU, 메모리) 사용량을 제한하는 리눅스 커널 메커니즘'
- **🔴 HIGH** `스토리라인누락` _1.1 등장 배경 및 1.3 pause 컨테이너 설명 (line 20, 26)_
  - 문제: pause 컨테이너의 설계 이유는 설명하지만, 대안(컨테이너가 각자 네임스페이스를 가지면?)과 트레이드오프(복잡성·성능·재시작 문제)가 명시되지 않아 '왜 이 설계일까'라는 질문에 답이 없음
  - 보강: 'pause 컨테이너 없이 각 앱 컨테이너가 독립 네임스페이스를 가진다면: 재시작 시마다 새 IP가 할당되고, Service가 이전 IP로 트래픽을 보내 연결 끊김 발생. 이 문제를 해결하려고 pause 컨테이너(네임스페이스 소유자)가 반영구 존속하고, 앱 컨테이너만 조용히 재시작하는 구조로 설계됨' 추가
- **🔴 HIGH** `맥락점프` _1.3 Pod 생성 흐름 다이어그램 (line 89-107)_
  - 문제: API Server-Scheduler-Kubelet이 갑자기 등장. 1절에서 이들 컴포넌트를 소개한 적이 없어 학생은 '이게 뭐지?'라고 헤맸을 것. CKAD 문서이므로 기본 K8s 아키텍처를 전제했으나, 명시적 도입 문단 없음
  - 보강: 1.1과 1.3 사이에 0.5절 '쿠버네티스 아키텍처 (이 단원의 전제)' 추가: control-plane(API Server, Scheduler, Controller Manager)과 worker node(kubelet, container runtime)의 역할을 간단히 설명. 또는 1.3 다이어그램 위에 '아래는 쿠버네티스 내부 흐름으로, API Server는 모든 요청의 진입점, Scheduler는 Pod를 어느 노드에 배치할지 결정, kubelet은 해당 노드에서 컨테이너 실행을 담당한다' 추가
- **🔴 HIGH** `실습재현불가` _실습 섹션 전체 (line 322-472)_
  - 문제: 'dev 클러스터의 nginx Pod를 분석한다'고 하지만, 학생이 demo 네임스페이스에 nginx를 어떻게 준비하는지 명시 없음. KUBECONFIG 경로가 고정값(~/sideproejct/...) 이므로 자신의 환경에 재현 불가능
  - 보강: 실습 섹션 상단에 '사전 준비' 추가: '# 1. 클러스터 준비\nkubectl create namespace demo\n# 2. nginx Deployment 배포\nkubectl create deployment nginx --image=nginx:1.25 -n demo\nkubectl expose deployment nginx --type=NodePort --port=80 -n demo' 후에야 실습이 진행 가능함을 명시. 또는 '만약 demo 네임스페이스가 없다면: kubectl create namespace demo' 체크박스
- **🔴 HIGH** `정확성오류` _3절 트러블슈팅 (line 255-307)_
  - 문제: '# dev 실측'이라는 텍스트 블록으로 표기된 kubectl 출력. CLAUDE.md §4①에서 '명령 출력은 실제 스크린샷 이미지만, 텍스트 블록 금지'라고 명시했으나, 이 문서는 ` ```text ` 블록 형식 사용. 학생 입장에서 '실제로 이렇게 나오나?'를 확인할 수 없음
  - 보강: 실제 dev 클러스터에서 kubectl describe pod, kubectl get pod -o jsonpath 등을 실행해 터미널 스크린샷 이미지를 `images/` 디렉터리에 저장 후 `![Pod Pending 상태 describe 출력](images/day01-pending.png)` 형식으로 삽입. 텍스트 블록 제거
- **🟡 MED** `이해난이도` _1.2 Pod YAML, resources 섹션 (line 78-84)_
  - 문제: requests와 limits의 차이가 '최소 보장'과 '최대 사용'이라는 한 줄로만 설명됨. 학생은 '그럼 requests를 크게 설정하면 클러스터 낭비인가?', 'limits를 설정하지 않으면?', 'CPU throttling과 메모리 OOMKill은 왜 다른가?'라는 질문에 답할 수 없음
  - 보강: 다음 설명 추가: 'requests는 스케줄링 기준으로만 쓰이고 실행 시에는 강제되지 않음. limits는 커널이 강제함 — CPU는 throttling(속도 제한)으로, 메모리는 OOMKill(프로세스 강제 종료)로. 따라서 limits을 설정하지 않은 Pod는 노드 메모리를 전부 써서 이웃 Pod를 죽일 수 있으므로, 프로덕션에서는 requests=limits으로 설정하는 경우가 많다'
- **🟡 MED** `스토리라인누락` _2절 멀티스테이지 빌드 (line 116-122)_
  - 문제: 빌더 패턴(두 개 Dockerfile, docker cp)의 구체적 구현이 없어, 학생이 '왜 이게 문제였는지' 직관할 수 없음. 이전 해결책을 해본 사람만 '아, 이게 나을 수 있겠네'라고 느낌
  - 보강: 다음 예제 추가: '빌더 패턴(이전 방식)\n```bash\n# 1단계: 빌드 Dockerfile (build.Dockerfile)\nFROM golang:1.21-alpine\nCOPY ... RUN go build -o /app/server ...\n# 2단계: bash 스크립트\ndocker build -f build.Dockerfile -t build-image .\ndocker run --rm build-image cp /app/server /tmp/server  # 호스트로 추출\n# 3단계: 런타임 Dockerfile (runtime.Dockerfile)\nFROM alpine:3.18\nCOPY /tmp/server /usr/local/bin/server\ndocker build -f runtime.Dockerfile -t final-image .\n```\n이 방식은 (1) 두 개 Dockerfile 유지·(2) docker cp로 컨테이너와 호스트 간 파일 조작·(3) 두 번의 docker build·(4) CI 파이프라인이 복잡해짐. 멀티스테이지는 이 모든 것을 Dockerfile 하나로 통합함'
- **🟡 MED** `스토리라인누락` _2.2 Go 멀티스테이지 (line 131-181)_
  - 문제: CGO_ENABLED=0, GOOS=linux, -o /app/server의 역할이 기술되지만, '왜 정적 바이너리(static binary)로 만드는가?'라는 이유가 없음. 'alpine 베이스 이미지에 C 라이브러리가 없으므로'라는 연결고리 생략
  - 보강: CGO_ENABLED=0 주석을 확장: 'CGO_ENABLED=0: C 라이브러리(libc, OpenSSL 등) 의존성을 제거해 정적 바이너리(모든 의존성이 포함된 단일 바이너리)를 생성. 이후 alpine:3.18(초경량, libc 최소화)에서도 실행 가능해짐. 만약 CGO_ENABLED=1로 빌드하면 glibc 버전 호환성 문제로 alpine에서 세그멘테이션 폴트 발생 위험'
- **🟡 MED** `용어비약` _2.1 멀티스테이지 정의 (line 119)_
  - 문제: '공격 표면(attack surface)' 용어가 풀이 없음. 보안 경험이 없는 학부생은 이게 무슨 의미인지 모름
  - 보강: '공격 표면(attack surface) = 공격자가 악용할 수 있는 코드/도구/설정의 총량. 빌드 도구(gcc, npm, pip 등)를 최종 이미지에 포함하지 않으면, 컨테이너 침투 시 공격자가 악용할 수 있는 도구가 적어짐' 추가
- **🟡 MED** `용어비약` _2.5 표 (line 232-238)_
  - 문제: 'distroless', 'scratch' 이미지가 표에 나오지만 설명 없음. 'RUN 명령 체이닝'의 '레이어 수 감소'가 왜 크기를 줄이는지 원리 설명 없음
  - 보강: 'distroless = 프로그램 실행에 필수적인 최소 파일(libc, ca-certificate 등)만 포함한 이미지(google-distroless), 패키지 매니저·셸·빌드도구 전무. scratch = 완전 빈 베이스 이미지로 정적 바이너리만 실행 가능' 추가. 'RUN 명령 체이닝 원리 = 각 RUN은 새 레이어 생성. 레이어 = 압축된 파일시스템 변경분. RUN apt-get update && apt-get install ... && rm -rf /var/lib/apt/lists/*를 한 번에 실행하면 1 레이어이고, 나눠 실행하면 3 레이어로, 최종 이미지에는 temp 파일도 모두 누적됨. 체이닝하면 temp 파일 제거가 같은 레이어에서 이뤄져 최종 이미지에 남지 않음' 추가
- **🟡 MED** `용어비약` _1.2 restartPolicy (line 61-65)_
  - 문제: 'OnFailure'와 'Never'의 실제 차이를 학생이 언제 쓸지 모름. Job/Pod 맥락에서 기본값이 다른 이유도 설명 없음
  - 보강: 'OnFailure를 쓰는 경우: 배치 작업(성공할 때까지 재시도). Never를 쓰는 경우: 실패하면 수동으로 디버깅 후 재실행할 Pod. 그래서 Job은 보통 OnFailure(재시도 필요), Pod는 보통 Always(서비스 유지)를 기본값으로 함' 추가
- **⚪ LOW** `맥락점프` _3.2 CrashLoopBackOff (line 280-288)_
  - 문제: '이전 크래시'를 보는 이유가 간단히 설명되지만, Pod가 언제 'CrashLoopBackOff' vs '즉시 Crash'로 상태가 정해지는지 못 읽음. backoff 시간 기본값이 뭔지도 없음
  - 보강: 'kubelet은 Pod 재시작에 지수 백오프 적용: 첫 실패는 10초 대기 후 재시작, 그 다음 20초, 40초... 최대 300초까지. 이 와중을 CrashLoopBackOff라고 부름. 즉시 성공하거나 최대 재시도 횟수를 초과해야 상태가 바뀜' 추가

### daily/day02.md · 가독성 4/5 · 스토리 4/5 · 합격✅

- **🟡 MED** `용어비약` _3.1 Pod 생성 흐름 설명(l.403-407)_
  - 문제: Admission Control 항목에서 'LimitRange·ResourceQuota'만 나열하고 정의 없음. 학생이 이 용어를 처음 만났을 가능성 높음. Scheduler의 '필터링/점수 매기기'도 추상적.
  - 보강: 'Admission Control: LimitRange(Pod당 리소스 상한) · ResourceQuota(네임스페이스 점유량 제한) · PodSecurityPolicy(보안 정책) 등이 Pod 승인 조건을 확인하고 거부·수정'으로 1-2줄 풀이 추가. Scheduler는 '노드 용량·affinity·taint 조건으로 후보 필터링 후 가장 적합한 노드를 선택'으로 대체.
- **🟡 MED** `스토리라인누락` _1.1 Init Container 배경(l.20-21)_
  - 문제: 문제를 제시(이미지 비대·로직 결합)했지만 '이전엔 이걸 어떻게 풀었나'가 없음. 학생이 '그럼 이전엔?'이라고 자연스럽게 묻지만 답이 없음.
  - 보강: '앱 시작 전 DB 준비 확인 같은 초기화 로직은 과거 dockerfile RUN 명령이나 entrypoint 스크립트에 섞어 쓰던 방식이 있었으나, 재시작 시마다 불필요한 초기화가 반복되고 앱 컨테이너가 종료되기 전까지 다음 작업을 시작할 수 없었다'로 직전 방식의 한계를 한 문장 추가.
- **🟡 MED** `용어비약` _3.2 Multi-container Pod 내부 네트워크(l.411-427)_
  - 문제: '공유 네트워크 네임스페이스'라는 용어가 정의 없이 등장. Flowchart에 '공유 네트워크 네임스페이스 + 공유 볼륨(emptyDir)' 명시되나 학생이 '네임스페이스가 뭐지? 보안? 리소스 격리?'라고 헷갈림 가능.
  - 보강: 앞서 3.1에서 또는 2.1 후반에 '동일 Pod 내 컨테이너는 Linux 네트워크 네임스페이스(processes·네트워크 인터페이스·라우팅 테이블·방화벽 규칙을 격리하는 OS 메커니즘)를 공유하므로, 각 컨테이너는 같은 IP와 포트 번호 공간을 본다'고 1-2줄 추가.
- **⚪ LOW** `이해난이도` _2.2 Sidecar 로그 수집(l.231-274)_
  - 문제: 예제가 좋으나, app 컨테이너가 >> /var/log/app.log로 기록하고 log-collector가 tail -f를 하는데, 그 사이에 emptyDir 볼륨이 어떻게 파일을 공유하는지의 OS 메커니즘이 설명 없음. '왜 같은 파일이 보이지?'하는 의문에 답 없음.
  - 보강: volumeMounts 설명 근처에 '동일 Pod 내 컨테이너가 같은 볼륨명을 mountPath로 지정하면, OS는 컨테이너 각각의 /var/log를 호스트의 같은 물리 디렉터리에 bind mount하므로, 한 컨테이너의 쓰기가 다른 컨테이너에서 즉시 보인다'는 1줄 추가.
- **⚪ LOW** `맥락점프` _2.3 Git Sync Sidecar(l.277-308)_
  - 문제: GITSYNC_REPO/GITSYNC_ROOT/GITSYNC_DEST/GITSYNC_PERIOD 환경 변수가 갑자기 나타남. 이것이 registry.k8s.io/git-sync 이미지의 내부 변수라는 설명이 없어 학생이 '이건 쿠버네티스 표준인가? 내가 만드는 건가?'라고 헷갈림.
  - 보강: env 섹션 앞에 'git-sync 이미지는 다음 환경 변수로 동작한다' 또는 각 env마다 주석을 추가해 '이것은 git-sync가 정의한 변수이며, pod에서 전달하는 방식'을 명확히.
- **⚪ LOW** `용어비약` _2.4 Ambassador 패턴(l.310-340)_
  - 문제: 'redis-proxy: haproxy:2.9'라는 이미지가 나오는데, HAProxy가 무엇인지·어떤 설정(haproxy-config ConfigMap)이 필요한지 전혀 설명 없음. ConfigMap도 YAML에만 참조되고 실제 내용은 없음.
  - 보강: 예제를 simpler로 바꾸거나, HAProxy 설정 ConfigMap을 완성된 형태로 제시(예: 'frontend localhost:6379 backend real_redis:6379'). 또는 '실제 Ambassador 구성은 고급 주제이므로 개념 이해만 하고, 실습은 Sidecar 로깅으로 충분'이라고 명시.
- **⚪ LOW** `정확성오류` _4.1 Init Container 로그 확인(l.438-443)_
  - 문제: 예시 출력에서 Init Containers: wait-for-db: State: Running으로 표시되어 있으나, init container가 실패 없이 대기 중인 상태는 'Init:0/1' 또는 'Init:CrashLoopBackOff'이지 'Init Containers: ... Running'은 pod describe의 부분이므로, pod status와 describe의 차이를 구분해야 함.
  - 보강: 'kubectl get pod'의 STATUS 열과 'kubectl describe pod'의 Init Containers: 섹션을 명확히 구분. 예를 들어 'pod status가 Init:0/1이라고 나타날 때, describe로 보면 wait-for-db이 Running 상태(계속 대기 중)임을 확인'이라고 명시.
- **⚪ LOW** `실습재현불가` _4.2 Sidecar 로그 검증(l.472-480)_
  - 문제: 'dev 실측 (cap-ckad-d02 sidecar-demo, log-reader 컨테이너의 /var/log/nginx)' 라고 주석 달려 있으나, 학생이 같은 환경(cap-ckad-d02 namespace)이 없을 수 있음. 2.2 실습과 4.2 트러블슈팅의 Pod 이름이 다름(sidecar-logging vs sidecar-demo).
  - 보강: 실습 섹션(tart-infra)의 Pod 이름과 트러블슈팅의 예제 Pod 이름을 일관되게(예: sidecar-logging으로 통일). 그리고 'tart-infra 실습 환경 설정' 섹션의 namespace를 자동으로 준비되는지 명시.
- **⚪ LOW** `용어비약` _2.1 Multi-container 패턴 개요(l.219-228)_
  - 문제: '단일 책임 원칙(SRP)'이라는 용어가 갑자기 등장하고, 이것이 무엇인지 풀이 없음. 또한 'emptyDir 볼륨을 통해 메인과 데이터 공유'라고 했지만, '모든 Sidecar가 emptyDir을 쓰는가? 다른 방식은?'이라는 질문에 답 없음.
  - 보강: '단일 책임 원칙(SRP, Single Responsibility Principle): 각 컴포넌트가 하나의 기능만 담당하도록 설계하는 소프트웨어 원칙'으로 1줄 풀이. Sidecar 설명에 '주로 emptyDir(Pod 생명주기와 동일한 임시 공유 스토리지)을 사용하지만, 영구 스토리지가 필요하면 PVC나 hostPath도 가능'으로 다른 옵션 힌트 추가.
- **⚪ LOW** `스토리라인누락` _1.2 Init Container 실행 순서(l.35-51)_
  - 문제: Flowchart는 잘 그렸으나, '왜 순차 실행인가? 동시 실행은 안 되나?'라는 자연스러운 질문에 답 없음. 특징(1.1)에 '하나씩 실행된다(동시 실행 불가)'라고만 했지, 그 이유(의존성 해결)를 설명 안 함.
  - 보강: 1.2 제목 뒤에 '초기화 단계들이 순차적으로 실행되는 이유는, 2번째 init이 1번째 결과(예: DB 연결 확인)에 의존할 수 있기 때문이다. 예를 들어 DB 마이그레이션은 DB 준비 완료 후에 실행되어야 한다'고 1-2줄 추가.

### daily/day03.md · 가독성 4/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `실습재현불가` _섹션 1.1 emptyDir YAML(라인 28~54)_
  - 문제: YAML 예제의 writer/reader 컨테이너가 sleep 3600으로 '영원히 대기'한다. "실제로 파일을 공유하는지 확인하는 방법"(예: writer가 쓴 파일을 reader가 즉시 읽는 검증)이 없다. 학생은 'cat /data/message'가 실제로 'shared data'를 출력하는지 테스트할 수 없다.
  - 보강: 실습 섹션(섹션 1 말미)에 다음을 추가: "검증: kubectl exec <pod> -c reader -- cat /data/message 로 writer가 쓴 파일을 reader가 읽는 것을 확인한다" + 실제 터미널 스크린샷(exec 명령 결과 'shared data' 출력 이미지). 또는 다중 컨테이너 Pod에서 양쪽 컨테이너가 동일 파일 내용을 보는 증거 화면.
- **🔴 HIGH** `용어비약` _섹션 1.2 PVC, 라인 61~65 '공학적 정의' 단락_
  - 문제: "StorageClass를 통해 PV를 동적 프로비저닝하거나 기존 PV에 바인딩된다"는 표현이 사전지식 없는 학생에게 불명확하다. 'StorageClass'가 무엇이고, '동적 프로비저닝'과 '정적 바인딩'의 차이, 'provisioner'의 역할이 설명되지 않았다. "PVC가 생성되면 PV Controller가 매칭되는 PV를 찾는다"는 내부 동작 설명은 있지만, 일반 독자가 '둘 다 필요한가?'라는 기본 질문에 답할 수 없다.
  - 보강: "공학적 정의" 전에 'StorageClass란' 별도 단락(2~3문장)을 추가: "StorageClass는 '어떤 스토리지 유형(로컬디스크·NFS·클라우드블록)과 설정(크기·보관정책)을 쓸지' 정의하는 템플릿이다. PVC가 StorageClass를 지정하면, 쿠버네티스가 그 정의에 맞춰 PV를 자동 생성(동적 프로비저닝)한다. 정적 방식은 관리자가 PV를 미리 만들고, PVC가 기존 PV를 찾아 묶는다(바인딩)." 표나 다이어그램으로 'PVC → (StorageClass 참조) → (provisioner 호출 또는 기존 PV 검색) → PV 생성 또는 바인딩' 흐름을 시각화.
- **🔴 HIGH** `맥락점프` _섹션 2.1 Job, 라인 109~117 '등장 배경'과 '공학적 정의'_
  - 문제: "Deployment/ReplicaSet은 '항상 N개의 Pod가 실행되어야 한다'는 장수(long-running) 워크로드를 위한 것"이라는 설명이 첫 등장한다. 학생이 'Deployment·ReplicaSet'을 모르면 이 문장이 완전히 이해 불가능하다. 또한 "restartPolicy: Always인 Deployment에 일회성 작업을 넣으면 무한 재시작된다"는 구체적 예시가 도움이 되지만, 왜 '완료 후 재시작'이 문제인지의 이야기가 부족하다.
  - 보강: "등장 배경" 앞에 한 단락 추가: "Pod는 기본 'restartPolicy: Always'이다. 즉, 프로세스가 exit 0으로 끝나도 kubelet이 자동 재시작한다. 이는 nginx 같은 서버를 '항상 실행 중'으로 유지할 때는 좋지만, 백업 스크립트처럼 '한 번 돌아서 끝'인 작업에는 문제다. 실패하면 무한 재시작 루프에 빠진다. Job은 이런 일회성 작업을 위해 새로 나온 워크로드 유형이다." 이렇게 Deployment/ReplicaSet을 설명하지 않고도 Job의 필요성을 독립적으로 이해하게.
- **🔴 HIGH** `정확성오류` _섹션 2.1, 라인 113~114 '공학적 정의' 문장_
  - 문제: "완료(exit code 0)될 때까지 실행을 관리한다"는 표현이 부정확하다. 실제로는 'completions' 개수만큼 성공(exit 0)해야 완료이고, 일부 Pod만 실패해도 Job은 계속 재시도한다. "하나 이상의 Pod를 생성하여 지정된 작업이 성공적으로 완료"는 '몇 개가 성공해야 완료인가'를 명시하지 않는다.
  - 보강: "Job은 Pod를 생성하여, completions 개수만큼 Pod가 exit code 0으로 종료될 때까지 Pod를 계속 생성한다"로 수정. 즉, '필요한 성공 수'를 명시적으로 포함.
- **🟡 MED** `실습재현불가` _섹션 2.3, 라인 169~199 Job 빠른 생성 + 검증_
  - 문제: "검증:" 블록의 출력이 ` ```text ` 텍스트 블록으로 기록되어 있다. CLAUDE.md의 규약 §4①에 따르면 "명령 실행 결과는 실제 터미널 스크린샷 이미지로만"이어야 한다. 학생이 자신의 환경에서 같은 명령을 실행했을 때 이 텍스트 출력을 '증거'로 믿을 수 없다. 특히 'kubectl get jobs' 출력(라인 188)은 '6초 나이' 같은 시간값이 상대적이라 정확한 비교가 불가능하다.
  - 보강: "검증:" 섹션을 다음과 같이 변경: 1) `kubectl create job backup-job --image=busybox:1.36 -- sh -c "echo backup done"` 명령 실행 → **실제 터미널 스크린샷 이미지** 삽입(Job 생성 메시지). 2) `kubectl get jobs` 실행 → **실제 터미널 스크린샷** (Complete 상태 확인). 3) `kubectl logs job/backup-job` 실행 → **실제 터미널 스크린샷** ('backup done' 출력). 텍스트 복사본이 아닌 실제 화면 캡처 필수.
- **🟡 MED** `이해난이도` _섹션 2.1, 라인 116 'backoffLimit 설명'_
  - 문제: "backoffLimit는 연속 실패 횟수가 아니라 누적 실패 횟수이다"는 설명이 너무 짧고 예시가 없다. '누적'이 정확히 무엇을 의미하는지(모든 Pod의 실패를 합산하는 건가? 같은 Pod의 컨테이너 재시작도 포함하는 건가?) 불명확하다.
  - 보강: 구체적 예시 추가: "예: completions=2, parallelism=1, backoffLimit=2라고 하자. Pod-1이 두 번 실패하면 누적 2, Pod-2가 한 번 실패하면 누적 3 → backoffLimit 2를 초과해 Job이 Failed가 된다. 한 번에 하나씩만 시도하므로(parallelism=1) '연속 실패'라는 표현이 오해를 낳는다." 실제 명령 + kubectl describe job 출력(스크린샷)으로 backoffLimit=2 초과로 Failed된 Job을 보여주기.
- **🟡 MED** `이해난이도` _섹션 3.3, 라인 213~214 CronJob Controller 설명_
  - 문제: "100회 이상 연속으로 실행이 누락되면 CronJob Controller가 에러를 기록하고 더 이상 스케줄하지 않는다"는 문장이 추상적이다. '누락'의 정의(스케줄 시점을 지났는데 Job이 생성되지 않은 경우)와 '100회'라는 숫자의 의미(어떤 버전에서? 계산 방식은?)가 명확하지 않다.
  - 보강: ""누락(missed)이란 스케줄 시점이 도래했는데 Job이 생성되지 않은 경우를 말한다. 예: CronJob이 5초마다 스케줄되어야 하는데 30초 동안 Pod가 예약(pending) 상태로 머물면 6번의 스케줄을 놓친다. CronJob Controller는 이를 세어서 100회 이상 누적되면 safety 차원에서 'TooManyMissedSchedules' 경고를 로깅하고 더 이상 Job을 생성하지 않는다. 이 경우 CronJob을 수정(suspend 해제, parallelism 증가, Pod 리소스 요청 완화 등)한 후 다시 enable해야 한다." 설명 추가.
- **🟡 MED** `스토리라인누락` _섹션 3.1 CronJob 등장 배경(라인 207~208)_
  - 문제: "외부 cron 스케줄러나 별도의 오케스트레이션 도구가 필요했다"는 직전 기술 언급이 있지만, 그것의 '구체적 한계'(예: 클러스터 외부에서 관리 → API 인증·권한 문제·모니터링 복잡·클러스터 장애 시 스케줄러도 죽을 가능성)가 설명되지 않았다. 또한 CronJob이 "쿠버네티스 네이티브로 스케줄링 기능을 제공"한다는 장점이 왜 중요한지(API 일관성·자동 복구·권한 통합) 명시적이지 않다.
  - 보강: "등장 배경"에 한 문장 추가: "외부 cron(예: Linux cron, Jenkins)은 클러스터 밖에서 실행되므로 ⓐ Kubernetes API 인증/권한 관리가 복잡하고 ⓑ 클러스터 네트워크 장애 시 스케줄이 실행되지 않으며 ⓒ 모니터링·알림이 K8s와 분리되어 운영 복잡도가 높다. CronJob은 클러스터 내부에서 apiserver를 통해 직접 Job을 생성하므로, RBAC 권한과 Pod 상태 추적이 Kubernetes 생태계와 통합되어 관리 포인트를 줄인다."
- **🟡 MED** `용어비약` _섹션 3.2, CronJob YAML (라인 239 startingDeadlineSeconds)_
  - 문제: "스케줄 시간을 놓쳤을 때 시작 허용 시간"이라는 설명이 모호하다. '놓쳤다'는 것이 정확히 무엇인가(스케줄 시점이 도래했는데 Pod가 pending 상태라서 실행 못한 건가? 아니면 Node가 down돼서 Job 객체 자체를 만들 수 없었나?)와 '시작 허용 시간'의 의미(startingDeadlineSeconds 초 이내면 지연 실행을 허용하겠다는 뜻인가?)가 명확하지 않다.
  - 보강: "startingDeadlineSeconds: 200"의 주석을 다음과 같이 확장: "스케줄 시점부터 이 필드의 초(200초) 범위 내에 Job이 생성되지 않으면, 그 스케줄은 영원히 누락된 것으로 간주한다. 예: 매일 02:00 실행이 정해져 있는데, 클러스터 장애로 02:15에 회복됐다면, startingDeadlineSeconds가 600(10분)이면 그 Job은 이미 누락되어 생성 안 함. 하지만 3600(1시간)이면 02:15에 Job을 만들어 늦게라도 실행한다(concurrencyPolicy에 따라). 보통 매일 실행은 30~300초, 주간 실행은 대기 시간이 길 수 있으니 따로 설정." 예시 + kubectl describe 출력 추가.
- **🟡 MED** `이해난이도` _섹션 4.1 시험 팁(라인 309~324)_
  - 문제: "kubectl run my-pod --image=nginx:1.25 --port=80 --dry-run=client -o yaml > pod.yaml" 명령이 제시되지만, 학생이 이 명령을 '무조건 외워야 한다'는 인상을 줄 수 있다. 또한 `--port` 플래그가 Pod spec.containers[].ports 필드에 무엇을 채우는지 명시되지 않았다.
  - 보강: "시험 팁" 앞에 한 문단: "CKAD 시험은 손 숙련과 속도가 합격의 핵심이다. 이 섹션의 명령형 방식들(kubectl run/create/expose ... --dry-run=client -o yaml)은 '암기해야 하는 주문'이 아니라 '시험장에서 시간을 절약하는 패턴'이다. 각 명령은 `kubectl run --help`, `kubectl create job --help` 등으로 언제든 옵션을 확인할 수 있으므로, '어떤 상황에 어느 명령을 쓰는지' 파악하는 것에 집중하고, 상세 문법은 도움말에 의존하자." 추가.
- **⚪ LOW** `구조` _섹션 1.2 PVC 내부 동작 심화(라인 64~66)_
  - 문제: "accessMode RWO는 단일 노드에서만 읽기/쓰기가 가능하므로, 다른 노드의 Pod가 같은 PVC를 사용하려 하면 스케줄링이 실패한다"는 설명이 'RWO의 제약'을 명확히 했지만, 'RWX(ReadWriteMany)'가 존재한다는 사실을 바로 뒤에 언급(라인 77)하고 있다. 정의 섹션에서 미리 3가지 accessMode를 다 소개해서 대비 효과를 높이면 좋을 것 같다.
  - 보강: "공학적 정의"에서 accessModes를 먼저 3줄 표로 정의: | accessMode | 설명 | 예시 | | RWO(ReadWriteOnce) | 단일 노드만 읽기/쓰기 | 블록 스토리지(EBS, Cinder) | | RWX(ReadWriteMany) | 여러 노드 읽기/쓰기 | NFS, GlusterFS | | ROX(ReadOnlyMany) | 여러 노드 읽기 전용 | 설정 파일 배포 | 그 후 단일 노드 제약 설명.
- **⚪ LOW** `스토리라인누락` _전체 구조: 섹션 간 흐름이 끊김_
  - 문제: Day 3이 '볼륨(1~2) → Job(2~3) → CronJob(3)'으로 진행되는데, 왜 이 3개 주제가 '같은 날'에 묶였는지의 이야기가 없다. CKAD 도메인 맥락에서 'Volume은 데이터 지속성, Job/CronJob은 워크로드 관리'로 별개 영역처럼 보일 수 있다.
  - 보강: 서두(학습 목표 아래)에 한 문단: "오늘 다루는 세 기술은 모두 'Pod를 넘어 클러스터 수준의 리소스 관리'를 다룬다. ⓐ Volume은 '컨테이너 재시작해도 데이터를 유지하려면'의 답이고, ⓑ Job은 '한 번 완료된 작업은 재시작하지 않으려면'의 답이며, ⓒ CronJob은 'Job을 시간 기준으로 자동 반복하려면'의 답이다. 함께 배우면 실제 앱(백업, 데이터 파이프라인, DB 클린업)의 전체 패턴을 구성할 수 있다."

### daily/day04.md · 가독성 3/5 · 스토리 1/5 · 미달❌

- **🔴 HIGH** `스토리라인누락` _전체 - 문제 1-12 및 기술별 도입부_
  - 문제: 각 기술(Job, CronJob, Volume, 패턴들)이 등장한 배경, 직전 해결책, 개선점, 트레이드오프가 전혀 없음. 예: 왜 Pod 대신 Job을 쓰는가? Job과 Pod의 근본 차이는? CronJob과 시스템 cron의 차이는?
  - 보강: 각 주요 기술 섹션 앞에 2-3줄의 배경 스토리 추가. 예: '문제 4 전 - 배경: Pod만으로는 완료까지의 재시도, 병렬 실행, 진행상황 추적을 보장할 수 없다. Job 객체는 이들을 선언적으로 정의하고 컨트롤러가 자동 관리한다. / 문제 5 전: CronJob은 시스템 cron처럼 시각 기준 스케줄을 Kubernetes에서 선언적으로 정의·자동 복구·히스토리 관리하는 방법이다.'
- **🔴 HIGH** `용어비약` _문제 2 (Init Container), 문제 7 (PVC), 문제 10 (localhost:6379 의존성)_
  - 문제: Init Container의 생명주기, PVC와 emptyDir의 차이, storage class, 멀티카테이너가 같은 네트워크 네임스페이스를 공유하는 이유 등이 설명 없이 등장.
  - 보강: (1) 문제 2 전에 'Init Container: Pod가 main container 실행 전 한 번 실행되고 완료되는 컨테이너. 초기화·데이터 준비·퍼미션 설정 등에 사용된다' 한 줄 정의. (2) 문제 7 전에 emptyDir과 PVC 비교표(생명주기·영속성·공유범위·사용 사례) 추가. (3) 1.2 다이어그램 아래에 주석: '주의: Pod 내 모든 컨테이너는 같은 네트워크 namespace를 공유하므로, 같은 포트를 여럿 listen할 수 없다.'
- **🔴 HIGH** `용어비약` _문제 4,5 (backoffLimit, schedule 필드), 문제 10,11 (Ambassador/Adapter의 용어 정의)_
  - 문제: backoffLimit, schedule='*/10 * * * *', concurrencyPolicy 등 필드의 정확한 의미와 내부 동작이 없음. Ambassador/Adapter 패턴의 정의도 YAML 구조만 있고 패턴의 목적·언제 쓰는가가 없음.
  - 보강: (1) 문제 4 끝에 'backoffLimit=2: Job이 실패한 Pod를 최대 2번 다시 생성 시도. 초과하면 Job은 Failed 상태가 되고 더 이상 재시도하지 않는다' 추가. (2) 문제 5에 'schedule="*/10 * * * *": cron 형식(분·시·일·월·요일). */10(분)은 매 10분마다 실행' 설명. (3) 문제 10 전에 'Ambassador 패턴: main 컨테이너가 localhost로만 통신하고, 별도 ambassador 컨테이너가 외부 서비스로 프록시. 장점: main 로깅과 네트워크 처리 분리, 컨테이너 교체 용이' 정의. (4) 문제 11 전에 'Adapter 패턴: 비표준 출력 형식을 표준 형식(예: JSON)으로 변환하는 패턴. 예: 레거시 앱 로그를 모니터링 시스템이 읽을 수 있는 형식으로 변환'.'
- **🔴 HIGH** `스토리라인누락` _문제 4 Job - completions, parallelism과의 관계 및 직전 해결책(Pod for-loop 스크립트)과의 차이_
  - 문제: Job의 completions=1, parallelism=2 등이 무엇을 해결하는가가 없음. 왜 Pod를 여러 번 직접 바라지 않고 Job을 써야 하는가?
  - 보강: 문제 4 및 문제 6 전에 종합 배경 추가: 'Job이 없었던 시절, 배치 작업은 Pod를 직접 생성 후 완료 대기·실패 시 재시도·병렬 실행을 수동으로 관리했다. Job 객체는 completions(목표 완료 수)·parallelism(동시 실행 수)·backoffLimit(자동 재시도)을 선언적으로 정의하고 Job 컨트롤러가 이를 자동 보장한다.'
- **🟡 MED** `이해난이도` _1.1 Pod 생성 흐름도, 1.2 Multi-container 다이어그램_
  - 문제: Pod 생성 흐름에서 '3. API Server 처리 / 인증 -> 인가 -> Admission Control'의 각 단계가 실패하면 어떻게 되는지, Admission Control이 정확히 무엇인지(validating/mutating webhook vs built-in 정책 vs LimitRange) 불명확. Multi-container 다이어그램에서 포트 충돌 가능성 미언급.
  - 보강: (1) Pod 생성 흐름: 각 단계 실패 시 동작 표기(예: '인증 실패 -> 401 Forbidden', '인가 실패 -> 403 Forbidden', 'AC 실패 -> 400 Bad Request / 자동 수정') 또는 'CKA 트러블슈팅 장 참조' 링크. (2) 다이어그램 아래에 주석: '포트 충돌 주의: 같은 Pod 내 다중 컨테이너는 네트워크 namespace를 공유하므로, 같은 포트를 2개 이상 listen할 수 없다.'
- **🟡 MED** `맥락점프` _문제 2(Init Container) 직후부터 emptyDir 문제들(3,8,11)_
  - 문제: Init Container와 emptyDir의 관계가 명시 안 됨. 왜 Init Container 다음 바로 Sidecar emptyDir 패턴이 등장하는가? emptyDir이 뭐라서 Init Container와 함께 쓰는가?
  - 보강: 문제 2 검증 후에 '핵심: Init Container가 데이터를 준비하면, emptyDir(또는 PVC) 볼륨을 통해 main container가 그 데이터를 읽을 수 있다. 이는 Pod의 부팅 단계(init -> main)와 데이터 공유(볼륨)의 조합이다' 해설 추가.
- **🟡 MED** `맥락점프` _복습 체크리스트(§4)와 본문의 괴리_
  - 문제: 'emptyDir과 PVC의 차이를 설명할 수 있다', 'Job의 completions, parallelism, backoffLimit 필드를 설명할 수 있다' 등의 항목이 본문에서 실제로 설명되지 않았음.
  - 보강: (1) 체크리스트 앞에 '다음 항목들은 이 장에서 실제로 배운 내용입니다. 스스로 설명할 수 있는지 확인하세요' 프롤로그 추가. (2) 각 항목이 본문 어느 섹션에서 다루어지는지 링크 추가(예: '[ ] emptyDir과 PVC의 차이 -- 문제 7 + 해설'). (3) 본문에서 실제로 설명하지 않은 항목(예: CronJob timezone)은 체크리스트에서 제거하거나 '확장 학습' 섹션으로 분리.
- **🟡 MED** `실습재현불가` _문제 2~12 전체(CKAD 실기 시험 형식)_
  - 문제: 모든 끝이 YAML 선언형. 실기 시험에서는 kubectl create job/cronjob ... --dry-run=client -o yaml로 기본 틀을 생성 후 수정이 훨씬 빠른데, 이 방법의 예시 없음.
  - 보강: 각 문제 끝의 YAML 예제 뒤에 '빠른 풀이(imperative)' 섹션 추가: 예를 들어 '문제 4: kubectl create job math-job --image=busybox:1.36 -n exam --dry-run=client -o yaml -- sh -c "echo \"2 + 3 = \$((2+3))\"" | kubectl apply -f -'. 시험에서 시간이 부족하면 이 방법으로 기본 틀을 빠르게 생성 후 spec.backoffLimit 등만 추가 편집.
- **🟡 MED** `정확성오류` _문제 12 (CronJob 일시중지), tart-infra 실습 1,2_
  - 문제: (1) suspend=true 시 이미 진행 중인 Job의 처리(완료 대기 vs 즉시 종료) 미명시. (2) 실습 1~2에서 demo namespace에 PostgreSQL/Redis가 실제로 있는지 확인 명령 없음. (3) nc 명령이 busybox:1.36에 있다고 가정(버전마다 도구 다름).
  - 보강: (1) 문제 12 해설에 '참고: suspend=true는 새 Job 생성만 멈추며, 이미 실행 중인 Job은 완료될 때까지 계속된다. 진행 중인 Job을 즉시 종료하려면 kubectl delete job ...' 추가. (2) 실습 1 전에 전제 확인: 'kubectl get pod -n demo', 'kubectl get svc -n demo | grep postgres', 'kubectl run test --image=busybox:1.36 -n demo -- sh -c "which nc || which telnet"' 명령으로 환경 확인. (3) nc 불가 시 대안(예: 'busybox는 기본적으로 nc를 포함하지 않으니, 최신 이미지는 nc 대신 wget/curl을 권장') 명시.

### daily/day05.md · 가독성 4/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `실습재현불가` _라인 153~171 (RollingUpdate Step 1-3), 라인 217 (set image 명령)_
  - 문제: RollingUpdate 과정에서 maxSurge=1, maxUnavailable=1 제약 하에서 새 Pod 생성과 이전 Pod 종료의 정확한 순서(순차 vs 병렬)가 불명확. 학생이 실제 클러스터에서 재현해 보면 다이어그램과 맞지 않을 수 있음. 또한 set image 명령의 컨테이너 이름이 YAML의 container.name과 일치해야 하는데, 여러 실습 섹션에서 container 이름이 일정하지 않음(§1: nginx-web, §1.2: nginx).
  - 보강: RollingUpdate 과정을 더 정밀하게 재술성: '(1) maxUnavailable=1이므로 최소 2개 Pod 유지 필요 (2) maxSurge=1이므로 최대 4개 Pod 허용 (3) 따라서 Step 1: 이전 Pod 1개 종료 시작 → 새 Pod 1개 생성 (또는 동시) → 새 Pod Ready 대기 → 이전 Pod 종료 완료' 순서를 명시. 또는 실제 kubectl logs/describe로 기록된 이벤트 시간을 보여줌. set image 명령은 "container-name=image" 문법을 강조하고 YAML과 일치성을 재확인하도록 함. 예: '주의: container.name이 nginx면 kubectl set image deployment/web-deploy nginx=nginx:1.25이며, 다른 이름이면 그에 맞춰야 함.'
- **🔴 HIGH** `정확성오류` _라인 275~280 (§3.2~3.3 순서 혼란)_
  - 문제: "특정 revision 상세 확인" (라인 256, history --revision=2)과 "롤백" (라인 263, undo --to-revision=1)의 플래그 차이가 명시되지 않음. history는 --revision, undo는 --to-revision인데, 학생이 혼동할 수 있음. 또한 history --revision 명령이 무엇을 반환하는지(상세 YAML vs 요약)를 보여주지 않음.
  - 보강: §3.2와 3.3를 명확히 구분: "3.2 롤아웃 이력 조회(history)" vs "3.3 롤백(undo)"로 제목 재정의. 각 명령의 정확한 출력을 실제 스크린샷으로 보여줌: history (REVISION|CHANGE-CAUSE 표)와 history --revision=N (Pod template 상세)는 다른 출력. undo --to-revision의 --to 플래그는 -으로 강조.
- **🔴 HIGH** `용어비약` _라인 28 (pod-template-hash 처음 정의)_
  - 문제: "pod-template-hash"가 본문에서 처음 명시되지만, 왜 이 필드가 필요한지(동일 template 감지)나 어떤 문제를 해결하는지 설명 없음. 새 template과 이전 template을 구분하는 메커니즘을 이해하지 못하면 revisionHistoryLimit의 의미도 불명확.
  - 보강: 라인 27 '이전 ReplicaSet은 replicas=0으로 유지되어' 다음에 "Deployment Controller는 spec.template의 내용을 해시(pod-template-hash)로 계산하여 ReplicaSet의 이름 접미사로 사용하므로, template이 같은 이전 RS는 빠르게 재사용 가능(이름이 같기 때문)하고, template이 다른 이전 RS는 revisionHistoryLimit으로 오래된 것부터 삭제된다"고 추가.
- **🔴 HIGH** `스토리라인누락` _라인 21~22 (등장배경)_
  - 문제: "이미지 업데이트 시 이전 RS를 수동으로 축소하고 새 RS를 생성해야 한다"는 ReplicaSet의 한계를 말하지만, 그렇게 하지 않으면 구체적으로 무엇이 문제인지(예: 업무 중단, 오류율, 사람 실수) 명시 안 됨. "선언적 관리"의 의미도 추상적임.
  - 보강: 등장배경을 더 구체화: "ReplicaSet으로 관리하는 앱을 배포하면, 새 버전의 이미지로 업데이트할 때 쿠버네티스는 자동으로 새 ReplicaSet을 생성하지 않으므로 사람이 직접 이전 RS의 replicas를 0으로 줄이고 새 RS의 replicas를 원하는 수로 늘려야 한다. 이 과정에서 실수로 replicas를 0으로 설정하면 서비스 중단이 발생한다(downtime). Deployment는 이를 자동화하여, spec.template (Pod 사양)이 변경되면 자동으로 새 ReplicaSet을 생성하고, strategy(RollingUpdate/Recreate)에 따라 Pod를 교체하며, 문제 발생 시 빠르게 롤백할 수 있다"로 수정.
- **🔴 HIGH** `맥락점프` _라인 93~251 (검증 블록 전체)_
  - 문제: 모든 검증 블록이 ``` text ``` 형식의 텍스트 출력으로 표시됨. CLAUDE.md §4①에서 "명령 실행 결과는 실제 터미널 화면을 캡처한 PNG 이미지"로만 표시하도록 명시했으므로, 텍스트 블록은 금지됨. 이는 학생이 '실제로 이렇게 나오는가'를 확인할 수 없음(위변조 의심 가능).
  - 보강: 모든 검증 블록(라인 103~108, 114~119, 127~132, 236~251, 328~339, 369~376 등)을 실제 kubectl 터미널 스크린샷 이미지로 교체. 명령(``` bash ```) 아래에 캡처한 PNG를 삽입. 해석은 그 아래 텍스트로. 예: "```bash\nkubectl get deployments -n demo\n```\n\n![실제 kubectl get deployments 출력](images/day05-get-deployments.png)\n\n위 이미지에서 READY 3/3, UP-TO-DATE 3, AGE 2s임을 확인할 수 있다."
- **🔴 HIGH** `실습재현불가` _라인 299~312 (§4 시험팁 명령들)_
  - 문제: 명령에 대상 클러스터(-kubeconfig) 또는 네임스페이스(-n)가 명시되지 않음. CLAUDE.md §6에서 "모든 명령에 대상 클러스터/네임스페이스 명시" 규칙 있으므로 위반. 학생이 어느 클러스터, 어느 네임스페이스에서 실행해야 하는지 불명확.
  - 보강: 라인 300: `kubectl create deployment web --image=nginx:1.25 --replicas=3 --dry-run=client -o yaml > dep.yaml` → `kubectl create deployment web --image=nginx:1.25 --replicas=3 -n demo --dry-run=client -o yaml > dep.yaml` (또는 `--kubeconfig kubeconfig/dev.yaml` 추가). 모든 kubectl 명령에 `-n <namespace>` 추가. 또는 처음에 "이 섹션의 모든 명령은 dev 클러스터의 demo 네임스페이스에서 실행한다"고 명시.
- **🟡 MED** `이해난이도` _라인 274~280 (§3.4 change-cause 기록)_
  - 문제: deprecated 사실은 명시되지만, "현재 올바른 방법"은 annotation 제시에 그침. 왜 annotation을 쓰는지(어떤 기술적 이유인지)나, spec 어디에 기록되는지 설명 없음. 학생이 " 이 annotation은 정말 history에 나타나나"를 확인할 수 없음.
  - 보강: 라인 277: "또는 YAML에서" 이후에, annotation이 실제로 rollout history의 CHANGE-CAUSE 열에 나타나는지 검증 명령 추가. 예: "```bash\nkubectl rollout history deployment/web-deploy -n demo\n```\n라인 CHANGE-CAUSE에 annotation 값이 표시됨". 또는 "annotation은 Deployment.metadata.annotations에 저장되며, kubectl rollout history는 이를 읽어 CHANGE-CAUSE로 표시한다"고 설명.
- **🟡 MED** `맥락점프` _라인 397, 403 (실습 환경설정 섹션)_
  - 문제: "tart-infra 실습"이라는 섹션명이 모호하고, KUBECONFIG 경로가 상대경로(~/sideproejct/)로 표시되어 모든 사용자에게 적용되지 않을 수 있음. 또한 이것이 day05 학습과 무관한 "기존 실습 클러스터 확인" 단계인지, 아니면 day05를 위한 새 셋업인지 명확하지 않음.
  - 보강: 라인 397 섹션명을 "실습 환경설정 - dev 클러스터 접속"으로 변경. 라인 403을 "이 저장소의 kubeconfig/dev.yaml 경로에서" 또는 "만약 kubeconfig이 다른 경로라면" 설명 추가. CLAUDE.md §3의 "kubeconfig는 kubeconfig/<클러스터>.yaml"을 명시적으로 링크. 또한 "이 섹션의 모든 실습은 dev 클러스터의 demo 네임스페이스에서 진행한다"고 명시.
- **🟡 MED** `용어비약` _라인 30~34 (핵심 특징)_
  - 문제: "원하는 상태(desired state)"와 "선언적(declarative)" 개념이 용어만 나열되고 구체 예시 없음. 학생이 이것이 왜 중요한지, 다른 방식(명령형 imperative)과 무엇이 다른지 이해 못할 수 있음.
  - 보강: 라인 32 "이미지 업데이트 시 자동 롤링 업데이트" 다음에 주석: "(명령형: kubectl run, kubectl delete 같은 단발 명령이 아니라, Deployment 매니페스트에서 desired state를 선언하면 Deployment Controller가 현재 상태를 지속적으로 desired와 일치시킴)" 추가.

### daily/day06.md · 가독성 4/5 · 스토리 3/5 · 합격✅

- **🔴 HIGH** `용어비약` _라인 86-88 (Service selector 개념), 라인 25-26 (Endpoints), 라인 175 (iptables/IPVS)_
  - 문제: Blue/Green 구현의 핵심인 'Service selector를 바꾸면 Pod가 즉시 매칭된다'는 원리를 설명하는 선수 개념(Service = IP 추상화, selector = label matching, Endpoints = Pod IP 목록)이 전혀 없음. 학생이 'selector를 버전으로 바꾸면 왜 Pod가 재할당되나'를 이해 불가. 또한 kube-proxy의 iptables/IPVS 모드는 KCNA/CKA 선수 개념인데, CKAD 문서에 갑자기 나옴.
  - 보강: 라인 28 직전 선수 개념 추가: '**선수개념**: Service의 selector 필드는 Pod의 label과 매칭되며, Service가 가리키는 Endpoints(Pod IP 목록)를 결정한다. selector를 변경하면 Endpoints Controller가 즉시 새 Pod 목록을 계산하고, kube-proxy(또는 Cilium eBPF)가 로드 밸런싱 규칙을 재설정한다.' 그리고 라인 26 뒤에 주석: '참고: iptables/IPVS는 일반 kube-proxy의 두 구현 모드. 이 저장소 dev 클러스터는 Cilium(eBPF 기반)을 사용하므로 내부 메커니즘이 다름. 최종 효과(Service IP 재라우팅)는 동일.'
- **🔴 HIGH** `스토리라인누락` _라인 164-276 (Canary 섹션) 전체 대비 라인 282-291 (비교표)_
  - 문제: Blue/Green을 배운 후 Canary를 설명하면서 '100% 전환은 위험하므로 Canary를 쓴다'고 하지만, '그럼 왜 Blue/Green을 여전히 쓰는가'라는 역질문에 답 불가. 트레이드오프(Blue/Green = 리소스 2배·안전 보증 vs Canary = 리소스 적음·모니터링 필수)가 문서에 없어, 학생이 '언제 뭘 쓸까'의 의사결정 기준을 모름. 이는 시험의 시나리오 문제('앱이 업데이트되는데 다운타임은 없어야 하고 리소스는 제한적이고, 모니터링 도구가 없다면?')에서 실패 원인.
  - 보강: 라인 164(Canary 섹션 시작) 뒤에 선택 기준 추가: '**선택 기준**: Blue/Green은 두 버전을 동시 운영해 리소스가 2배 필요하지만, 테스트 완료 후 selector만 바꾸면 즉시·안전하게 전환 가능(롤백도 한 줄 명령). 중요한 인프라·API 변경 업데이트에 적합. Canary는 Pod만 추가(리소스 절약)하되 트래픽이 실시간 분산되므로 모니터링(에러율·레이턴시 대시보드)과 자동 롤백 인프라가 필수. 관측 도구가 충분하면 Canary가 효율적.' 그리고 라인 282-291 비교표를 라인 162(Blue/Green 마무리) 뒤로 옮겨 두 배포 방식 설명 후, 실전 문제 전에 배치.
- **🔴 HIGH** `실습재현불가` _라인 30-92 (Blue/Green 구현), 라인 179-240 (Canary 구현)_
  - 문제: 모든 YAML 예제와 명령에 `-n demo` 또는 `-n exam`이 있는데, 처음 사용하는 네임스페이스를 생성하는 kubectl 명령이 없음. 학생이 day06을 처음부터 따라 하면 라인 96 'kubectl get pods -l version=green -n demo'에서 'namespace demo not found' 에러로 막힘. 문제 1~7은 `exam` 네임스페이스(라인 309에서 생성)를 사용하지만, 처음 설명부(1.1~1.3)는 `demo`를 사용하며 생성 명령 누락.
  - 보강: 라인 28(Blue/Green 구현 직전) 또는 라인 30(YAML 코드블록 직전) 에 추가: '```bash\nkubectl create namespace demo\n```' 그리고 라인 162(Canary 시작 전)에도 동일: '```bash\nkubectl create namespace demo\n```' (이미 생성된 경우 에러 무시) 또는 모든 YAML에 metadata.namespace 필드를 명시해 'kubectl apply -f file.yaml -n demo' 없이 namespace 자동 지정. 또한 프레로그 문단에 '아래 예제는 demo 네임스페이스를 사용합니다. 먼저 kubectl create namespace demo 로 생성하세요.'라고 명시.
- **🔴 HIGH** `정확성오류` _라인 548-614 (문제 8 Canary 구현) 대비 라인 228-240 (2.2 설명부)_
  - 문제: 라인 228-240 설명에서 Service selector는 'app: web'만 포함해 version 라벨 없음. 그런데 라인 558-561, 582-584 문제 8 YAML에서 Stable·Canary의 matchLabels에 'version: stable'과 'version: canary'를 명시. 이 둘이 다르면 문제의 YAML을 그대로 따라 하는 학생은 Stable 라벨이 matchLabel에는 있지만 Service selector에는 없어 매칭 불일치 발생. 라인 615 핵심('selector에 version을 포함하지 않아 양쪽 Pod 모두 선택')과도 모순. 실제로 따라 하면 kubectl get endpoints에서 예상 5개가 아니라 개수 불일치.
  - 보강: 문제 8 YAML (라인 550-614)의 web-stable과 web-canary matchLabels에서 'version: stable'과 'version: canary' 라인을 삭제하거나 주석 처리. 또는 명확한 주석 추가: '# 주의: Deployment의 matchLabels에 version이 있지만, Service selector(라인 603-604)에는 app만 있으므로 양쪽 Pod를 모두 선택. 만약 Service selector에 version을 포함했다면 Canary만 선택되어 트래픽 분산 불가.' 그리고 라인 612-613 검증 직전 명령 추가: '```bash\nkubectl get service web-svc -n exam -o jsonpath={.spec.selector}\n# app=web 확인 (version 없음)\n```'
- **🔴 HIGH** `정확성오류` _라인 173-175 (Canary 내부 동작), 라인 739-742 (트러블슈팅 증상)_
  - 문제: 라인 211에서 'replicas: 1 = 20% 트래픽'이라고 선언하지만, 라인 739-742 트러블슈팅에서 'stable 4개, canary 1개인데 canary에 트래픽이 거의 오지 않는다'는 증상을 다룸. 이는 'Pod 수 비율 = 트래픽 비율'이 항상 참이 아님을 암시. 학생이 두 문장을 연이어 읽으면 '그럼 뭣이 참인가' 혼동. 특히 시험에서 'Canary를 안정적으로 배포하려면 뭘 해야 하나'는 문제의 답 'Pod 수 조절'이 만능이 아님을 모르고 틀림. 순수 K8s Canary는 확률 기반(kube-proxy iptables random probability 또는 Cilium eBPF 로드 밸런싱)이므로 요청 수가 적으면 편차.
  - 보강: 라인 211 직후 주석 추가: '**주의**: 순수 K8s Canary는 확률 기반 로드 밸런싱(kube-proxy iptables random probability 또는 Cilium eBPF)을 사용하므로 요청이 적으면(< 100) Pod 수 비율과 다를 수 있다. 안정적인 80/20 비율이 필요하면 Istio VirtualService의 weight 필드를 사용하거나, 충분한 트래픽(> 1000 req/s)을 보내 확률이 수렴하게 함.' 그리고 라인 739 '증상' 바로 뒤에: '**원인**: 순수 K8s Canary는 요청당 확률로 Pod를 선택하므로 요청이 적으면 편차가 크다. 라인 814-826 실습 2에서 충분한 트래픽(예: 1000+ 요청)을 보내면 비율이 수렴함을 확인할 수 있다.'
- **🟡 MED** `용어비약` _라인 25-26 ('Endpoints Controller'), 라인 120-121 ('Endpoints'), 라인 235 ('selector')_
  - 문제: 'Endpoints'라는 K8s 객체가 첫 등장 시 정의 없이 사용. 학생이 'Endpoints가 뭔지', 'Pod와 어떻게 다른지', 'Service와의 관계'를 모르면 'selector를 바꾸면 Endpoints가 바뀌고 ~ Pod가 선택된다'는 인과관계를 이해 불가. CKAD 도메인이라도 Service 관련 문제에서 자주 나오는 개념.
  - 보강: 라인 22 직전(Blue/Green 공학적 정의 뒤) 또는 라인 28 직전에 한 문단 추가: '**선수 개념 - Service와 Endpoints**: Service는 Pod들의 IP:Port를 추상화한 가상 주소(예: 10.97.0.5:80). 학생이 이 Service IP로 요청을 보내면, Service의 selector 필드가 Pod의 label과 매칭된 Pod IP:Port 목록(Endpoints 객체)을 보고 실제 Pod로 로드 밸런싱한다. 따라서 selector를 바꾸면 → Endpoints가 즉시 변경 → 트래픽이 다른 Pod로 간다.' 그리고 라인 120 뒤 주석: '# Endpoints: Service selector가 매칭한 Pod IP:Port의 현재 목록. Blue에서 Green으로 전환 후 이 값을 확인해 정말로 Green Pod만 등록되는지 검증.'
- **🟡 MED** `맥락점프` _라인 164 (Canary 섹션 시작) 대비 라인 282-291 (비교표 위치)_
  - 문제: 학생이 Blue/Green(라인 15-162)과 Canary(라인 164-276)를 순차 읽은 후에야 세 가지 배포 전략의 비교표(라인 282-291)를 본다. 구성 상으로는 자연스럽지만, 교육적으로는 두 기법을 배운 후 '지금까지 뭘 배웠나'를 정리하고 문제에 접근하는 게 효율적. 현재는 비교표가 뒤에 있어 학생이 문제를 풀면서 '이게 Blue/Green인가, Canary인가'를 다시 판단.
  - 보강: 라인 162(Blue/Green 섹션 마무리) 뒤, 라인 164(Canary 시작) 전에 라인 282-291 비교표를 옮김. 제목을 '## 1.4 배포 전략 비교 (Blue/Green · Canary · RollingUpdate)'로 정명. 그 뒤에 Canary 섹션 시작. 이렇게 하면 학생이 '지금까지 배운 두 전략 비교 → 다음 Canary 배우기'의 흐름으로 읽음.
- **🟡 MED** `이해난이도` _라인 25-26 ('graceful close'), 라인 148-149 ('대기')_
  - 문제: '기존 TCP 연결은 즉시 끊기지 않는다'와 'graceful close'는 네트워킹 기본기인데, 학부생이 이를 모르면 'selector를 바꾸면 즉시 전환된다'는 설명(라인 23)과 모순으로 느껴짐. 또한 Blue Deployment가 'Phase 3: 대기' 상태에서 무엇을 하는지(Pod는 살아있는지, 종료하는지) 명확하지 않음.
  - 보강: 라인 25-26 뒤에 예시 추가: '예를 들어, 클라이언트가 Blue Pod와 이미 TCP 연결을 맺고 있었다면, selector를 Green으로 변경해도 그 연결은 바로 끊기지 않는다. 응용 프로그램이 연결을 정상 종료(graceful shutdown)할 때까지(또는 defaultTerminationGracePeriodSeconds 타임아웃) 기다린 뒤, 다음 요청이 Green으로 간다. 이를 connection drain이라 한다.' 그리고 라인 148-149 Blue Deployment 상태를 '대기(Pod는 구동 중이지만 트래픽 받지 않음, 레플링 대비)' 또는 'Phase 4: 안정화 후 삭제'로 명확히.
- **🟡 MED** `구조` _라인 814-826 (실습 2 명령)_
  - 문제: 라인 822 'kubectl expose deploy canary-stable ... --selector=app=canary-app'에서 'canary-stable을 expose 하는데 왜 selector를 app=canary-app으로 뽑냐'는 의문. 학생이 expose 기본 문법(deployment 이름으로 Service 생성하고 자동 선택자 설정)만 알면, '--selector' 옵션의 필요성과 순서가 불분명. 현재 명령은 사실상 두 단계(expose + patch)를 한 번에 끝내는 비표준 문법.
  - 보강: 라인 822 전에 주석 추가: '# canary-stable을 expose하면 기본적으로 selector=app=canary-stable이 되는데, 우리는 stable과 canary 모두를 포함해야 하므로 --selector를 app=canary-app(공통 라벨)으로 뽑아줌.' 그리고 명령 직후 대안 제시: '또는 두 단계로 나누어: ```bash\nkubectl expose deploy canary-stable -n demo --name=canary-svc --port=80 --target-port=80\nkubectl patch service canary-svc -n demo -p {"spec":{"selector":{"app":"canary-app"}}}\n```' 이렇게 하면 학생이 'expose 만드는 단계 → selector 수정 단계'를 분명히 이해.
- **🟡 MED** `스토리라인누락` _라인 717-742 (트러블슈팅 섹션 5.1, 5.2), 라인 757-848 (실습 섹션)_
  - 문제: 트러블슈팅(5.1 'Blue/Green 전환 후 트래픽 없음', 5.2 'Canary 비율 편차')과 실습(tart-infra 기반 두 실습)이 순차로 이어지는데, 둘의 위치 관계가 불명확. 또한 5.2 'Canary 비율'은 설계 문제(스케일 전략)로 다른 유형인데, 같은 섹션에 분류. 학생이 실습 중 막혔을 때 트러블슈팅 섹션을 찾기 어려움.
  - 보강: 트러블슈팅을 각 섹션(1.2 직후, 2.2 직후)에 분산. 라인 137 뒤에 '### 1.4 흔한 실수 및 해결', 라인 277 뒤에 '### 2.4 흔한 실수 및 해결' 추가. 그리고 라인 746-753 복습 체크리스트에 '□ 트래픽이 전달되지 않을 때 원인을 파악하고 복구할 수 있다' '□ Canary의 트래픽 비율이 편차나는 이유를 안다' 명시.
- **⚪ LOW** `구조` _라인 295 ('### 문제 1')부터 라인 713 ('### 문제 12')_
  - 문제: 12개 문제 중 1~6은 Deployment 기본(생성·전략·업데이트·롤백·특정 revision·Recreate), 7~12는 Blue/Green·Canary·Scale·Pause·정보추출·revisionHistoryLimit. 이론(Deployment 기본)과 배포전략이 섞여 있어, 문제를 푸는 입장에서 '1~6을 먼저 끝내고 7~12를 하라'는 지시가 없음. 자격증 시험 순서와도 맞지 않을 수 있음.
  - 보강: 라인 295 직전에 조언 추가: '**추천 순서**: 문제 1~6(Deployment 기본·롤아웃)을 먼저 풀어 손을 푼 후, 문제 7~12(배포 전략)로 진행하세요. 시험에서는 순서가 랜덤이므로 모두 풀 수 있어야 합니다.' 그리고 문제 그룹을 '### 파트 A. Deployment 기본 (문제 1~6)'과 '### 파트 B. 배포 전략 (문제 7~12)'로 명시적 구분.
- **⚪ LOW** `용어비약` _라인 710-712 (revisionHistoryLimit 설명)_
  - 문제: '너무 많으면 etcd 저장 공간을 차지한다'는 설명이 '왜'를 명시하지 않음. 학부생이 '각 ReplicaSet이 얼마나 크길래'를 궁금해 함. 또한 '기본값은 10이다'라는 정보가 문제 12에서 처음 나옴.
  - 보강: 라인 710-712 뒤에 추가 설명: '각 ReplicaSet(revision)의 메타데이터는 작지만, 수십 개가 쌓이면 누적 용량이 무시 못 할 수준. 기본값 10이라면 안전하지만, 배포가 자주 일어나는 환경에서는 5~3으로 낮추거나, 자주 배포하지 않으면 0(이전 버전 보관 안 함)으로 설정.' 그리고 라인 309 문제 12 제목 뒤에 '(선행: 라인 710-712의 revisionHistoryLimit 개념)' 명시.
- **⚪ LOW** `정확성오류` _라인 814 ('kubectl create deploy canary-stable'), 라인 821 ('kubectl expose deploy')_
  - 문제: 라인 814-821 실습 2 명령에서 'kubectl create deploy' + 'label' + 'expose'로 명령형으로 작성. 그런데 문제 1~8은 모두 'kubectl create/apply -n exam' 또는 YAML 스타일. 일관성 유지 상 실습도 YAML로 제공하거나, 명령형 선택 이유를 명시하면 좋음.
  - 보강: 라인 809-826 실습 2를 두 가지 방식으로 제시: '**방식 1 - 명령형(빠른 프로토타입)**: [현재 라인 814-821 유지]' / '**방식 2 - 선언형(시험 권장)**: [YAML 파일 제공 후 kubectl apply]' 그리고 주석: 'CKAD 시험에서는 속도가 중요하므로 명령형이 유리하지만, 복잡한 설정은 YAML 파일(--dry-run=client -o yaml로 생성 후 수정)이 더 정확합니다.'

### daily/day07.md · 가독성 4/5 · 스토리 4/5 · 미달❌

- **🔴 HIGH** `실습재현불가` _줄 179~209, 270~287, 293~300 등 전체 2.1~2.4절 검증 섹션_
  - 문제: 명령 실행 결과가 ```text 텍스트 블록으로 표기됨. CLAUDE.md §4①는 모든 명령 출력을 반드시 실제 터미널 캡처 PNG 이미지로 제시해야 한다고 명시했는데 위반.
  - 보강: 모든 검증: 블록 아래의 ```text 출력을 "실제 터미널 캡처 PNG 이미지"로 대체. kubeconfig/platform.yaml로 실제 helm list -A, helm history, helm get values 실행 후 스크린샷 캡처해 images/ 폴더에 저장 후 ![설명](images/파일.png)으로 참조. 예: ![helm list -A 실행 결과](images/helm-list-output.png)
- **🟡 MED** `정확성오류` _줄 593, 606~610 실습 2의 네임스페이스 명령과 검증_
  - 문제: 실습 명령은 -n demo를 지정했으나, 검증 출력은 namespace가 cap-ckad-d07로 표기. 주석(줄 607)에만 "ns demo 부재"라고 숨어있어 학생이 명령을 복사해도 실패할 수 있음.
  - 보강: 실습 2의 helm install 명령 직전에 사전조건 추가: "# 사전조건: demo 네임스페이스 생성\nkubectl create namespace demo 2>/dev/null || true\nkubectl config set-context --current --namespace=demo". 또는 처음부터 -n 옵션을 cap-ckad-d07로 통일.
- **🟡 MED** `용어비약` _줄 384, 397, 421~423 Go 템플릿 파이프라인 및 공백 제어_
  - 문제: {{ .Values.resources | toYaml | nindent 12 }}의 파이프(|) 문법과 {{- 대시의 공백 제거 역할이 처음 학생에게 나타나는데, 이들의 의미 설명이 전혀 없음. 초보 학생은 단순 기호로만 인식.
  - 보강: 3.2절 첫머리에 두 절 추가: (1) "파이프(|) 문법: {{ .값 | 함수1 | 함수2 }}는 왼쪽 결과를 오른쪽 함수의 입력으로 체인처럼 연결. 예: {{ \"hello\" | upper }}는 \"HELLO\" 출력." (2) "공백 제어: {{- 는 앞의 줄바꿈·공백 제거, -}} 는 뒤의 공백 제거. YAML의 정확한 들여쓰기를 위해 필수. 예: {{- if .Values.enabled }} 는 앞 공백을 제거해 Ingress 블록 들여쓰기 오류 방지."
- **🟡 MED** `스토리라인누락` _줄 20~27 등장배경 섹션_
  - 문제: Helm 이전의 구체적 고통 사례가 부재. "YAML 중복 관리가 어렵다"는 추상적 표현만 있고, "손으로 YAML을 dev/staging/prod용 3개 관리하면서 10개 값 중 2개 빠뜨려 프로덕션 장애"같은 뼈저린 사례가 없어 학생이 "왜 Helm이 필수인가"를 피부로 느끼지 못함.
  - 보강: 등장배경 단락 끝에 구체적 고통 사례 추가: "예를 들어 prod 배포 시 YAML을 손으로 10개 항목 수정했는데 tag 버전 하나를 빠뜨려 이전 버전 이미지로 떠 메모리 누수 장애 발생 — Helm은 이 모든 값을 values-prod.yaml 한 파일로 관리해 실수를 근본적으로 차단한다."
- **🟡 MED** `맥락점프` _줄 428~441 CKAD 범위 vs 줄 583~640 실습_
  - 문제: 4절에서 "CKAD 시험에는 7개 수준으로 출제"라고 나열했으나, 각 수준(1~7)이 실습 2의 어느 명령에 해당하는지, 또는 어느 것이 빠졌는지 명시되지 않음. 학생은 "시험 범위"와 "이 실습의 범위"를 분리해 생각하게 됨.
  - 보강: 실습 2 정리 후에 "실습 검증: CKAD 범위 체크" 섹션 추가. "위 7가지 범위 중 본 실습이 커버한 것: 1(install) O 2(--set) O 3(-f) X 4(list/history) O 5(uninstall) O 6(구조이해) O 7(Go 템플릿) X. 학생은 6·7을 추가로 학습해야 한다." 같은 체크리스트.
- **🟡 MED** `이해난이도` _줄 338~424 Go 템플릿 섹션 전체 구조_
  - 문제: 3.1절은 deployment.yaml 전체, 3.2절은 함수별 조각, 3.3절은 _helpers.tpl 따로 있어 서로 단절. 학생은 3.1의 deployment에 3.2의 함수들(default, toYaml, nindent)이 정확히 어디에 들어가는지 못 봄.
  - 보강: 3.2절을 "3.1 deployment.yaml의 각 줄 상세 해설"로 재편성. 예: "위 deployment.yaml의 image 라인을 자세히 보자: {{ .Values.image.tag | default \"latest\" }}의 파이프는...". _helpers.tpl은 3.3으로 독립 유지.
- **🟡 MED** `실습재현불가` _줄 593~624 실습 2 전체_
  - 문제: helm install 명령이 demo 네임스페이스를 전제하나, 학생이 처음 따라 하면 namespace not found 에러 발생. 또한 helm pull, helm lint, helm template 같은 2.4~2.5절 명령들이 실습에서 직접 실행되지 않아 "알기만 하고 쓸 줄 모르는" 상태.
  - 보강: (1) 사전조건에 namespace 생성 추가. (2) "실습 2-1: Chart 다운로드 및 검사" 단계 추가: helm pull bitnami/nginx --untar 후 Chart.yaml, values.yaml 확인. (3) "실습 2-2: 템플릿 렌더링 검증" 단계 추가: helm template my-release bitnami/nginx > rendered.yaml 후 일부 리소스 캡처.
- **⚪ LOW** `용어비약` _줄 377 default 필터 예제_
  - 문제: {{ .Values.image.tag | default \"latest\" }} 문법이 주석("tag가 없으면 latest 사용")만 있고, 따옴표 안의 \"latest\"가 Go 템플릿 문자열 리터럴이라는 명시가 없어 초보자가 변수와 문자열을 구분 못할 수 있음.
  - 보강: 예제 아래 한 줄 추가: "따옴표 안의 \"latest\"는 Go 템플릿 문자열 리터럴로, 고정값을 의미한다. 변수 참조는 따옴표 없이 {{ .Values.xxx }}로 표기."
- **⚪ LOW** `스토리라인누락` _줄 467~483 트러블슈팅 5.1절_
  - 문제: helm uninstall 후 재설치 워크플로우를 보여주지만, CKAD 시험의 시간 제약(120분)에서 uninstall의 타임아웃 위험을 언급하지 않음.
  - 보강: 5.1 끝에 CKAD 시험 팁 추가: "시험에서 uninstall이 오래 걸리면, kubectl delete secret sh.helm.release.v1.<name>.*로 Release 정보 Secret을 직접 제거해 빠르게 진행할 수 있다."
- **⚪ LOW** `실습재현불가` _줄 541~542 실습 1 (platform) vs 줄 586 실습 2 (dev)_
  - 문제: 실습 2에서는 export KUBECONFIG를 명시했으나, 실습 1(platform)에서는 같은 설정이 없어 일관성 부족. CLAUDE.md는 "항상 클러스터를 명시한다"고 명시.
  - 보강: 실습 1 첫 명령 블록을 다음으로 수정: "export KUBECONFIG=~/sideproejct/IaC_apple_sillicon/kubeconfig/platform.yaml\nkubectl get nodes" 명시. 마찬가지로 모든 kubectl 명령에 -n 옵션 추가.

### daily/day08.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `실습재현불가` _문제 1~5(Helm 설치/업그레이드/롤백)_
  - 문제: bitnami 리포지토리에서 nginx Chart를 설치하라는 지시는 있으나, 학부생이 helm repo를 실제로 구축해야 하는지, 로컬에 mychart가 있어야 하는지 불명확. 특히 기대 출력의 'cap-ckad-d08'이 main text의 'helm-exam'과 다르면 학생이 혼동함.
  - 보강: 각 문제 시작에 '사전 설정: helm repo add bitnami ...'을 명시하고, 실제 터미널 스크린샷(출력)을 PNG로 첨부. 기대 출력의 네임스페이스명이 실제 지시와 일치하는지 검증 후 통일.
- **🔴 HIGH** `정확성오류` _문제 1: 기대 출력 주석 '(ns helm-exam 부재 -> cap-ckad-d08 에 동등 설치)'_
  - 문제: 실제 명령에서는 'helm-exam'을 생성하라고 했으나, 기대 출력은 'cap-ckad-d08'으로 표시. 이는 학생이 따라 했을 때 자신의 결과(helm-exam)가 기대와 다르다고 느껴 혼동 초래.
  - 보강: 기대 출력을 실제 스크린샷(PNG)으로 대체. 텍스트 주석 대신 실제 helm list 출력 화면을 캡처해 시각적으로 확인 가능하게.
- **🔴 HIGH** `맥락점프` _2.1절: Deployment 흐름 다이어그램(Mermaid)_
  - 문제: 10+ 박스가 한 번에 나타나 학부생이 전체 흐름을 이해하기 전에 세부사항에 빠짐. 특히 Informer/Watch, revisionHistoryLimit 등의 개념이 사전설명 없이 노드에 포함됨.
  - 보강: 흐름을 2단계로 나누기: (1) 고수준 흐름 '사용자 kubectl apply -> API Server -> Deployment Controller -> ReplicaSet -> Pod 생성' (2) 각 단계 내부의 세부사항(Informer, 템플릿 해시 계산 등). 또는 현재 다이어그램 위에 '①~④ 단계'로 번호를 붙여 설명 순서 명시.
- **🔴 HIGH** `용어비약` _1.4절: 'Go 템플릿 엔진', 'Secret 이름 형식: sh.helm.release.v1'_
  - 문제: 학부 3학년이 Go templating을 모를 수 있음. Secret 형식도 왜 이런 이름을 쓰는지(Helm release 추적 목적) 설명 없음.
  - 보강: 'Go 템플릿 엔진({{ }} 괄호로 변수를 치환하는 프로그래밍 방식)'으로 한 줄 풀이. 'Secret 이름은 Helm이 Release 이력을 추적하기 위해 정한 형식'이라고 배경 추가.
- **🔴 HIGH** `실습재현불가` _문제 10: Canary 배포 트래픽 비율_
  - 문제: 'Service selector가 app=api이므로 stable(9개)과 canary(1개) Pod 모두에 트래픽이 분배'라는 설명만으로, 학생이 실제로 '내 요청의 10%가 canary로 갔는가?'를 검증할 방법이 없음. 부하 생성기·로그 확인 명령 없음.
  - 보강: 검증 단계 추가: 'for i in {1..100}; do curl http://api-svc; done' 후 'kubectl logs <canary-pod>'로 실제 요청 수를 확인하라는 실습 명령 추가. 또는 '정밀한 트래픽 제어는 Istio 없이 불가능하며, 이 실습은 개념 확인용(replica 비율로 대략 9:1)'이라고 명시.
- **🟡 MED** `스토리라인누락` _섹션 1과 2의 연결_
  - 문제: Helm(패키지 관리)과 Deployment(리소스 기술)가 Day 8에 함께 나오는 이유, 둘의 관계가 약함. 마치 독립된 두 주제처럼 느껴짐.
  - 보강: 섹션 소개에 'Helm으로 여러 Deployment를 한꺼번에 관리하며, 그 내부에서 Deployment Controller가 어떻게 롤아웃을 제어하는지 이해하는 것이 자격증 실기의 핵심'이라고 명시.
- **🟡 MED** `스토리라인누락` _2.2절: RollingUpdate 상세 과정_
  - 문제: 왜 이 특정 수치(replicas=4, maxSurge=1, maxUnavailable=1)를 선택했는지 설명 없음. 학부생이 '이게 현실적인 설정인가?'라고 의문할 수 있음.
  - 보강: '실제 배포에서는 maxSurge=25%, maxUnavailable=1 같은 비율을 쓰는데, 학습을 위해 구체 숫자로 단순화했다'는 주석 추가.
- **🟡 MED** `이해난이도` _2.1절 Mermaid 다이어그램_
  - 문제: ResourceQuota, LimitRange, Validation 등이 API Server 단계에 있으나, 학부생이 이들을 아직 배우지 않았을 수 있음(이 과정의 어느 day에서 나오는지 불명).
  - 보강: 'API Server의 검증 단계(상세는 Day XX 참조)'라고 하거나, 복잡도를 줄여 'API Server의 검증'으로만 표기.
- **🟡 MED** `정확성오류` _실수 2: Helm values 우선순위_
  - 문제: '-f values-base.yaml -f values-prod.yaml --set image.tag=v2.0.0'에서 '우선순위(높은 것이 승리)'라고만 했는데, '--set이 최우선'은 맞으나 두 개의 -f 파일 간 우선순위 설명이 모호. 정확히는 '뒤에 지정한 파일의 값이 앞의 값을 덮어쓴다(override)'임.
  - 보강: '우선순위(뒤에 지정한 값이 앞의 값을 덮어씀): --set(최우선) > 마지막 -f 파일 > ... > 첫 -f 파일 > Chart 기본값' 으로 명확히 수정.
- **🟡 MED** `용어비약` _실수 4: rollout undo와 revision 번호_
  - 문제: '롤백 후에도 새 revision이 생성됨'은 K8s의 설계 결정인데, 왜 이렇게 했는지(감사 추적, 순차 추적) 설명 없음.
  - 보강: 'K8s는 모든 상태 변화를 revision으로 기록한다(감사 추적). 따라서 revision 3에서 1로 롤백해도, 그 '롤백 동작'이 revision 4로 기록된다'고 배경 추가.
- **🟡 MED** `용어비약` _트러블슈팅 시나리오 1: kubectl logs ... --previous_
  - 문제: '--previous'가 설명 없이 나타남. 학부 1학년도 모를 수 있음.
  - 보강: '--previous 플래그는 재시작 전 컨테이너의 로그를 보여준다'는 한 줄 추가.
- **🟡 MED** `맥락점프` _섹션 6 (tart-infra 실습)_
  - 문제: 전체 섹션이 이 저장소의 dev/prod 클러스터에 종속. 일반 학부생(자신의 로컬 클러스터 없는 사람)이 따라할 수 없음.
  - 보강: 섹션 헤더에 '이 실습은 이 과정의 tart 멀티클러스터에서만 실행 가능합니다. 자신의 K8s 환경이 없다면 앞의 문제 1~12만 완료하세요.'라고 명시.
- **⚪ LOW** `용어비약` _1.2절: helm install 명령_
  - 문제: './mychart'라는 로컬 디렉터리가 학부생이 어디에서 구성해야 하는지 명확하지 않음.
  - 보강: 문제 시작에 '사전 준비: bitnami/nginx 공식 차트를 사용하므로 mychart 디렉터리 생성 불필요' 또는 별도 '보충: Helm Chart 만드는 법'으로 링크.
- **⚪ LOW** `스토리라인누락` _문제 7: Recreate 전략_
  - 문제: Recreate가 '다운타임이 발생하므로 stateless 배치 작업에 적합'이라고 1줄만 있음. 정말 배치인가? 언제 쓰나?
  - 보강: 'stateless 단기 작업(배치)에서는 Recreate를 쓰면 리소스를 순간 절약할 수 있다(예: 밤 10시 배치 잡의 모든 Pod를 동시 교체). 반면 웹 서비스는 항상 접속 가능해야 하므로 RollingUpdate를 쓴다.'고 구체화.
- **⚪ LOW** `정확성오류` _문제 4: 기대 출력 주석_
  - 문제: 'USER-SUPPLIED VALUES 헤더 없이'라고 했으나, helm get values의 실제 동작은 --all 플래그에 따라 달라짐. 완전히 정확하지 않음.
  - 보강: 실제 스크린샷(PNG)으로 대체해 모호함 제거.

### daily/day09.md · 가독성 4/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `실습재현불가` _Section 2.2, 3.2, 1.4, 1.5, 실습 2, 3_
  - 문제: 기대 출력이 텍스트 블록으로만 제시됨. CLAUDE.md 규약에서 '명령 실행 결과는 반드시 실제 터미널 스크린샷 이미지'라고 명시했으나 준수 미흡. 학생이 실제 화면과 비교하며 검증 불가능.
  - 보강: 모든 'kubectl' 명령의 실행 결과를 터미널 PNG 캡처로 교체. 특히 'kubectl logs', 'kubectl describe', 'kubectl get -w' 등의 출력은 실제 터미널 스크린샷으로 제시. 텍스트 블록은 명령 자체만 표기.
- **🔴 HIGH** `맥락점프` _Section 3.2 'kubectl debug'_
  - 문제: Ephemeral Container 추가/node debug pod/copy-to 3가지 모드가 갑자기 나열되며, 언제 어느 것을 선택하는지 판단 기준이 없음. 학생은 '상황별 어느 명령을 쓰나'가 혼동됨.
  - 보강: 각 모드의 선택 기준을 명시: '셸이 없는 Distroless → ephemeral 추가', '노드 문제 진단 → node debug', '원본 영향 회피 → copy-to'. 실제 시나리오(e.g., 'Go scratch 이미지로 빌드된 Pod 디버깅')로 구체화.
- **🔴 HIGH** `용어비약` _Section 3.2 'Ephemeral Container' 등장 배경_
  - 문제: Kubernetes 1.23에서 GA되었다는 정보만 있고, 'exec 기반 디버깅의 무엇이 부족했는가'(Distroless 이미지 한 사례만)와 '왜 Pod spec에 영구적으로 추가되지 않는지(임시성 이점)'를 설명하지 않음. 학생이 도구의 설계 의도를 못 이해.
  - 보강: 등장 배경 섹션 추가: '(1) exec 한계: 컨테이너에 /bin/sh 필수 → scratch/distroless 이미지는 exec 불가. (2) 해결책: Ephemeral Container로 임시 debug 컨테이너 주입 → Pod 재시작 후 자동 제거(영구 추가 아님). (3) 트레이드오프: debug 컨테이너도 스토리지 마운트 제약 있음.'
- **🟡 MED** `정확성오류` _Section 1.7 'Liveness Probe가 재시작을 트리거하기까지'_
  - 문제: 수식 'initialDelaySeconds + (failureThreshold * periodSeconds)'가 실제 작동과 부정확. 실제로는 (a)initialDelaySeconds 후 첫 검사 시작, (b) 그 이후 연속 failureThreshold 번 실패해야 재시작인데, 마지막 성공 후를 기준으로 카운트가 리셋되므로 공식이 단순화됨. 학생이 실제 타이밍을 오인 가능.
  - 보강: 명시: 'Probe 재시작 타이밍 = initialDelaySeconds + (연속 failureThreshold번의 실패 후). 중간에 한 번 성공하면 카운트 리셋. 예: initialDelaySeconds=5, periodSeconds=10, failureThreshold=3이면 최악 5+30=35초지만, 20초에 한 번 성공하면 카운트가 0으로 리셋되고 다시 30초 기다려야 함.' 수식보다 시간축 다이어그램 추가.
- **🟡 MED** `이해난이도` _Section 1.2 'Probe 결과는 Success/Failure/Unknown'_
  - 문제: 'Unknown' 상태가 언제 발생하는가(타임아웃? 네트워크 오류? 대기 중?) 설명이 없음. 학생은 '3가지 결과가 있다'는 사실만 알고 실제 디버깅에서 'Unknown'을 만났을 때 대처 못 함.
  - 보강: 명시: 'Unknown: probe 결과를 판정할 수 없는 경우(exec 명령 timeout/tcp 소켓 오류/http 요청 실패). kubelet은 Unknown을 실패로 간주해 failureThreshold 카운트.' 실제 'Unknown' 발생 사례(e.g., network unreachable) 추가.
- **🟡 MED** `스토리라인누락` _Section 2.1 'kubectl logs 기본'_
  - 문제: '--previous' 옵션이 단순 명령 나열로만 제시되고, '왜 필요한가'(CrashLoopBackOff 진단)와 '언제 쓰나'의 스토리가 없음. 학생은 옵션 암기만 하고 실제 문제풀이에서 활용 못 함.
  - 보강: 등장 배경 추가: '(1) Pod 문제: CrashLoopBackOff로 계속 재시작 → 현재 로그는 마지막 실패만. (2) --previous: 이전(n-1번째) 컨테이너의 로그 조회 → 재시작 원인 파악. (3) 활용: CrashLoopBackOff의 첫 단계 진단 명령.'
- **🟡 MED** `스토리라인누락` _Section 3.3 'kubectl top (리소스 사용량)'_
  - 문제: 'metrics-server 필요'라고만 했는데, metrics-server가 없을 때 어떻게 진단하나(node 리소스 한계? 로그 분석?)의 트러블슈팅이 없음. 학생이 'metrics unavailable' 에러를 보면 대처 못 함.
  - 보강: 선결조건 명시: 'metrics-server가 클러스터에 배포되어 있어야 함. 없으면 "error: Metrics API not available" 에러. 해결: kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/... 또는 클러스터 설치 시 자동 포함 확인.' 그리고 '메트릭 없을 때 대체 진단법: kubectl describe node로 AllocatedResources 확인'.
- **🟡 MED** `이해난이도` _Section 4.1, 1.3 중복 flowchart_
  - 문제: 'kubelet Probe Manager의 프로브 실행 경로(flowchart)' 와 'Probe 생애주기 flowchart'가 거의 동일한 정보를 반복. 학생은 '이 둘이 다른 정보인가?'혼동. 구성 비효율.
  - 보강: 1.3을 '전체 생애주기(사용자 관점)'로, 4.1을 'kubelet 내부 구현(커널 관점)'으로 명확히 분리. 4.1에는 '프로브 핸들러 선택(httpGet/tcpSocket/exec 실행 메커니즘)'과 'kubelet 리스너의 동시 실행(Liveness/Readiness 병렬)' 등 내부 상세를 추가해 정보 가치 구분.
- **🟡 MED** `실습재현불가` _실습 1: '기존 서비스의 Probe 설정 분석'_
  - 문제: 'nginx Pod의 Probe 설정 확인'을 하도록 하는데, 실제로 dev 클러스터의 demo namespace에 nginx Deployment가 사전에 존재하는지 보증이 없음. 학생이 'deployment not found' 에러를 보고 실습 중단.
  - 보강: 선결조건 명시: '실습 전 다음을 실행해 nginx Deployment를 생성: kubectl create deployment nginx --image=nginx -n demo'. 또는 기존 매니페스트(manifests/... ) 참조 지시. Pod 생성 명령 제시 후 검증 이미지 첨부.
- **🟡 MED** `실습재현불가` _실습 2: '예상 출력 (Readiness 실패 후)'_
  - 문제: index.html 삭제 → Readiness 실패 → READY=0/1인데, Liveness도 같은 경로라고 명시했으므로 failureThreshold=3 도달 후 컨테이너 재시작되어야 함. 하지만 예상 출력에서 '0/1   Running   0'으로만 표기하고, 재시작(RESTARTS 증가·Age 리셋) 증거 없음. 학생은 '실제로 어떻게 되는가'를 못 봄.
  - 보강: 예상 출력을 시간축으로 확장: '초기(준비됨): 1/1 Running 0 30s → 35초(Readiness 실패): 0/1 Running 0 → 70초(Liveness 실패·재시작): 0/1 Running 1 → 80초(nginx 복구·Ready): 1/1 Running 1'. 실제 PNG 캡처로 시간 변화 보여주기(kubectl get pod -w).
- **⚪ LOW** `용어비약` _Section 1.8 'Pod 상태: Running -> Container 재시작 -> Running'_
  - 문제: '컨테이너 재시작'과 'Pod 재시작'의 용어 구분이 모호. containers[] 배열의 한 컨테이너만 재시작되는 건가, 아니면 Pod 전체 재시작인가? 학생이 'restartPolicy' 개념과 혼동 가능.
  - 보강: 명시: 'kubelet이 containers[0] 내 app 컨테이너만 재시작(Pod는 Running 유지, RESTARTS 증가). 다른 컨테이너(있으면)는 영향 없음. restartPolicy=Always가 기본이므로 자동 재시작.'
- **⚪ LOW** `구조` _실습 부분 전체_
  - 문제: 실습 1,2,3의 검증 명령과 예상 출력이 모두 텍스트 블록인데, 실제 클러스터에서 직접 캡처한 PNG 이미지가 없음. CLAUDE.md 규약 §4①에 위배. 또한 실습이 '문제풀이 시뮬레이션'이 아니라 단순 '매니페스트 적용 → 관찰' 수준이라 시험 속도 훈련 미흡.
  - 보강: 각 실습의 예상 출력을 실제 터미널 PNG 캡처로 교체. 그리고 '시험형 문제 풀이' 실습 추가: '다음 Pod 매니페스트에서 Readiness가 계속 0/1인 이유 3가지를 찾고, 각각 수정 YAML을 제시하시오(10분 제한)' 같은 CKAD 실기 스타일 문제.

### daily/day10.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `스토리라인누락` _1장 전체 Probe 섹션 시작_
  - 문제: Probe(Liveness/Readiness/Startup)가 왜 필요한지, 없으면 무엇이 문제인지 설명 없음. 예: 'Pod이 실패했는데도 scheduler가 모르면?' 같은 등장배경과 직전 방식(manual restart) 한계 없음. 학생이 '왜 이거 배워야 하는지' 모른 채 문제를 품. Probe의 3가지 종류가 어떤 관점에서 구분되는지(startup latency vs liveness vs readiness)도 설명 없음.
  - 보강: 1장 시작에 1~2문단 추가: '(배경) Kubernetes는 자동 복구를 약속하지만, Pod이 언제 준비되었는지·언제 죽었는지를 어떻게 알 것인가? 컨테이너 프로세스 존재 여부만으로는 부족하다(예: 앱이 시작되었지만 포트를 아직 listening 중이 아닐 수 있다). (직전) 기존 docker run은 수동으로 health check를 짰고, 사람이 주기적으로 docker logs와 ps를 확인했다. (개선) Kubernetes의 Probe는 자동으로 Pod 상태를 검사하고 필요시 재시작한다. (트레이드오프) 하지만 Probe 자체가 앱 응답성에 영향을 주고, 잘못 설정하면 false negative(정상인데 재시작)가 된다.'
- **🔴 HIGH** `용어비약` _문제 1, 라인 39-45 livenessProbe 블록_
  - 문제: 'initialDelaySeconds=5, periodSeconds=10, failureThreshold=3'이 구체적으로 무엇을 의미하는지 처음 학생을 위해 풀이 없음. 예: 'failureThreshold=3은 3번 연속 실패 후 재시작한다'는 설명이 없어 '총 몇 번 시도하는 건가? 즉시 재시작하는 건가?'가 불명확. 각 파라미터의 기본값(timeout=1s)도 명시되지 않아 'initialDelaySeconds만 있으면 되는 건가?'라는 혼동.
  - 보강: 문제 1 풀이 바로 뒤 '파라미터 설명' 칸 추가:\n- initialDelaySeconds=5: 첫 Probe 시작 전 5초 대기(앱이 충분히 시작될 때까지)\n- periodSeconds=10: 10초마다 한 번 Probe 실행\n- failureThreshold=3: 3번 연속 실패 시 컨테이너 재시작. 즉, 최악 5초(initial) + 10*3초(period*threshold) = 35초 후 재시작\n- timeoutSeconds: 기본 1초 — Probe 응답 대기 시간. 1초 안에 응답 없으면 실패로 판정.
- **🔴 HIGH** `맥락점프` _문제 1~4에서 문제 5로 넘어가는 부분_
  - 문제: 문제 1~4는 각 Probe 타입을 따로 배웠는데, 문제 5에서 갑자기 3가지를 섞어 쓴다. 그런데 '이 3개를 동시에 쓸 때 어떤 순서로 작동하는가?', '3개가 동시에 모두 실패할 수도 있는가?', 'Startup 성공 후 Liveness/Readiness는 병렬인가 순차인가?'를 설명하지 않음. 문제 5의 주의사항 문단('nginx는 /healthz를 구현하지 않는다')은 후사공 설명이라, 먼저 '3개 Probe의 관계도'가 필요.
  - 보강: 문제 5 앞에 '3가지 Probe의 실행 순서와 상태' 서브섹션 추가:\n그림(mermaid): startup → (성공) → liveness + readiness 병렬\n텍스트: 'Startup Probe가 성공할 때까지 Liveness와 Readiness는 모두 일시 중지된다. Startup 성공 후, Liveness는 Pod이 계속 살아있는지, Readiness는 트래픽을 받을 준비가 되었는지 독립적으로 검사한다.'
- **🔴 HIGH** `실습재현불가` _문제 1~5 모든 Probe 문제 '검증' 섹션_
  - 문제: YAML 작성 후 'kubectl apply'를 하라고는 했는데, 실제 클러스터에 nginx pod이 정말로 떠 있는가? 특히 문제 5의 'nginx는 /healthz와 /ready를 제공하지 않는다'는 것은 실제로 확인해야 이해가 된다. 그런데 '기대 출력'은 마치 성공한 것처럼 보인다. 따라서 학생이 실제로 해보면 Readiness/Liveness가 '404 Unhealthy'로 보이는데 '왜?'라고 막힌다. CLAUDE.md §4①에 따르면 '명령 출력은 반드시 실제 터미널 스크린샷'이어야 하는데, 모두 ```text 블록의 텍스트다. 스크린샷 없이 학생은 '정말로 이런 결과가 나오는가?'를 확인할 수 없고, 따라서 자신의 출력과 비교할 근거가 없다.
  - 보강: 각 문제별로 실제 tart 클러스터(dev.yaml)에서 명령을 실행하고, 터미널 스크린샷(PNG)을 images/ 디렉토리에 저장한 뒤, ![]( images/<file>.png) 형식으로 삽입. 예: 문제 1 '검증'에서 'kubectl describe pod liveness-pod | grep -A 3 "Liveness"'의 실제 출력(스크린샷)를 보이고, 아래에 '↓ 이렇게 나오면 정상'이라고 해석. 마찬가지로 문제 5는 nginx pod이 정말로 Not Ready 상태가 되는 화면 캡처를 보여줘야 '아, 정말로 이런 일이 일어나는구나'라고 이해된다.
- **🔴 HIGH** `용어비약` _문제 6 Sidecar 로깅 섹션, 라인 313-327 volumes 블록_
  - 문제: 'volumes.emptyDir'이 무엇인지 풀이 없음. 학부생은 'emptyDir이 뭐지? Pod이 삭제되면 데이터는 사라지는 건가? 왜 이름이 empty인가?'라고 막힌다. volumeMounts의 readOnly=true도 '왜 Sidecar는 읽기 전용인가?'를 설명하지 않음(답: 로그를 쓰는 건 app이므로). PersistentVolume이나 hostPath와의 차이도 언급 없음.
  - 보강: 문제 6 풀이 전에 'emptyDir 설명' 한 문단 추가: 'emptyDir은 Pod 내 여러 컨테이너가 파일을 공유하기 위한 임시 저장소다. Pod이 살아있는 동안만 존재하고, 삭제되면 데이터도 사라진다(따라서 이름이 empty). 이 문제에서는 app 컨테이너가 /var/log에 로그를 쓰고, log-streamer Sidecar가 같은 경로를 읽기 전용으로 마운트해 로그를 stdout으로 스트림한다(kubectl logs로 보기 위해).'
- **🔴 HIGH** `맥락점프` _문제 8에서 9로 넘어가기_
  - 문제: 문제 8은 '--previous' 플래그로 '이전 컨테이너 로그'를 보는 것인데, '이전'이 언제를 의미하는지 불명확. 'CrashLoopBackOff 상태'라는 말은 나오지만, '왜 정상 로그가 아니라 crash 로그를 봐야 하는가?'는 설명이 없음. 문제 9로 넘어가면 'kubectl exec'으로 '실행 중인 프로세스'를 보는데, 이게 문제 8과 어떻게 다른가(Probe 없이 직접 진입하는 것)?
  - 보강: 문제 8과 9 사이에 '디버깅 전략 비교' 한 절 추가:\n'Pod이 실패 상태(CrashLoopBackOff)일 때는 kubectl logs --previous로 이전 시도의 출력을 본다(현재 컨테이너는 없으므로 exec 불가). 반대로 Pod이 Running인데 예상과 다르게 동작하면, kubectl exec로 내부에 들어가 직접 확인한다(프로세스·DNS·포트 등). 이 문제는 Running 상태를 가정한다.'
- **🔴 HIGH** `용어비약` _2장 시나리오 A, 라인 529-545 Distroless 디버깅_
  - 문제: 'Distroless 이미지'가 무엇인지 정의 없음. '셸이 없어 kubectl exec 불가'라는 말은 있는데, '왜 Distroless를 쓰는가? 셸이 없으면 불편한데?'라는 동기가 없음. 그리고 'kubectl debug --target=app'이 무엇을 하는 건지(Ephemeral Container 개념)를 먼저 설명하지 않고 명령만 던짐.
  - 보강: 시나리오 A 시작에 1문단 추가:\n'Distroless 이미지는 운영체제·셸·패키지 관리자 같은 불필요한 도구를 제거해 이미지 크기와 공격 표면을 줄인 것이다(예: gcr.io/distroless/nodejs). 따라서 일반 exec로 /bin/sh에 접근할 수 없다. 대신 kubectl debug로 Ephemeral Container(임시 디버그 컨테이너)를 Pod에 추가하면, 그 컨테이너에는 busybox 같은 풀 OS를 쓸 수 있고, --target=app으로 원본 앱의 프로세스 네임스페이스를 공유하면 앱 프로세스를 볼 수 있다.'
- **🔴 HIGH** `정확성오류` _시나리오 B 플로우차트, 라인 549-565_
  - 문제: mermaid 플로우차트가 정확하지만, 주의사항 섹션 라인 571-590에서 'timeoutSeconds=1(기본값)'이라고 명시한 건데, 실제로 기본값이 1초인지 확인이 필요. 또한 'context deadline exceeded' 에러는 앱이 느린 것인데, 'failureThreshold'를 늘리면 안 되고(그럼 더 오래 기다려야 함) 'timeoutSeconds'를 늘려야 한다는 구분이 명확하지 않음.
  - 보강: 장애 시나리오 1에 설명 추가: 'Probe 타임아웃의 정확한 의미: timeoutSeconds는 Probe 요청에 대한 대기 시간(기본 1초)이다. 따라서 앱이 2초가 필요하면 timeoutSeconds를 3~5로 늘린다(failureThreshold 아님). failureThreshold는 몇 번 연속 실패 후 재시작할 것인가(재시도 횟수)이므로 혼동하면 안 된다.'
- **🟡 MED** `이해난이도` _4장 자주하는실수 섹션, 라인 608-626_
  - 문제: 실수 1의 '잘못된 예'에서 'pg_isready' 명령어가 나오는데, 학생이 PostgreSQL을 모르면 '이게 뭐하는 건가?'라고 막힘. 또한 'DB가 다운되면 앱이 계속 재시작됨'의 이유를 명확히 설명하지 않음(답: Liveness 재시작 루프).
  - 보강: 실수 1 설명 다음에 '구체적 예' 추가: 'Liveness Probe가 외부 의존성(DB·캐시·메시지큐)을 체크하면, 그 의존성이 일시적으로 다운되었을 때 앱이 정상이어도 Probe 실패 → 컨테이너 재시작 → 재시작 후에도 의존성은 여전히 다운 → 무한 재시작(CrashLoopBackOff). 따라서 Liveness는 앱 프로세스의 생존 여부(/healthz)만, Readiness는 의존성 포함 전체 준비도(/ready)를 검사해야 한다.'
- **🟡 MED** `이해난이도` _문제 12 Deployment Probe 추가, 라인 472-519_
  - 문제: '기존 Deployment web-deploy'라고 가정했는데, 이 Deployment가 실제로 존재하는가? 학생이 처음부터 풀 때 이 Deployment를 어디서 만드는가? 또한 'kubectl edit deployment web-deploy'를 했을 때 롤아웃(재생성)이 자동으로 일어나는 메커니즘을 설명하지 않음.
  - 보강: 문제 12 시작에 전제조건 명시: '(선행 조건) 기존 Deployment web-deploy가 있다고 가정. 없으면 먼저 생성: kubectl create deployment web-deploy --image=nginx:1.25. 이후 아래 Probe를 추가하면 kubectl이 자동으로 Pod 템플릿의 변경을 감지하고 재배포한다(rolling update).'
- **🟡 MED** `스토리라인누락` _3장 트러블슈팅 전체_
  - 문제: 두 장애 시나리오가 구체적이고 좋지만, '이런 실수를 왜 하는가?'의 교육 맥락이 없음. 예: 시나리오 2의 '--share-processes'를 왜 모를까? Ephemeral Container의 기본 동작을 먼저 설명했어야 함.
  - 보강: 3장 시작에 '트러블슈팅 철학' 한 문단 추가: 'Probe와 로깅·디버깅은 긴밀하게 연결되어 있다. Pod이 자주 재시작되면(Probe 실패) 이전 로그를 본다. 앱이 Not Ready면 kubectl exec·debug로 내부 상태를 확인한다. 이 문제들은 개념 이해 부족이 아니라 도구의 옵션(--previous·--share-processes)을 모르거나 Probe 타임아웃의 정의(timeoutSeconds vs failureThreshold)를 혼동해서 생긴다. 여기서는 실제 사례로 학습한다.'
- **🟡 MED** `용어비약` _라인 673~700 'tart-infra 실습' 섹션_
  - 문제: 갑자기 'export KUBECONFIG=...'으로 실제 클러스터 설정이 나타나는데, 이게 day10의 일부인가, 아니면 별도 실습인가? 또한 'demo 네임스페이스'·'nginx-web' Deployment가 실제로 존재하는가? CKAD 과정이므로 이전 day에서 이 자원들이 만들어졌다고 가정한다면, day10 맨 앞에 '선행 조건'으로 명시해야 함.
  - 보강: 'tart-infra 실습' 섹션 전에 '(선행 조건)' 블록 추가: 'KUBECONFIG를 설정하고 demo 네임스페이스·nginx-web Deployment가 실행 중인 상태여야 한다. day1~day9에서 생성한 자원을 그대로 사용한다. 아직 없으면 `kubectl create ns demo && kubectl create deployment -n demo nginx-web --image=nginx --replicas=2` 로 생성 후 진행.'
- **⚪ LOW** `용어비약` _라인 686 jsonpath 필터_
  - 문제: 'jsonpath'를 처음 쓰는데 풀이 없음. 단, 이것은 day10의 핵심 주제가 아니므로 '자세한 설명은 Day 9 참조' 정도의 cross-reference만 충분.
  - 보강: 라인 686 명령 다음 주석 추가: '# jsonpath는 JSON 경로 필터(Day 9 참조). 아니면 -o yaml로 전체 보기도 가능.'
- **⚪ LOW** `정확성오류` _라인 699 kubectl top pods 명령_
  - 문제: 'kubectl top'은 메트릭 서버가 설치되어 있어야 작동한다. tart 클러스터에 메트릭 서버가 있는지 명시 없음.
  - 보강: 라인 699 전에 주석: '# 참고: kubectl top은 metrics-server(보통 kube-system에 설치)가 필요. 설치 확인: kubectl get deployment -n kube-system | grep metrics'

### daily/day11.md · 가독성 3/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `용어비약` _1.2 alpha 섹션 및 1.5 API 메커니즘_
  - 문제: 'feature gate'(1.2), 'Admission Controller'(1.5), 'preferred version'(1.5)이 정의 없이 사용됨. 학부 학생이 이 용어들을 모를 가능성 높음
  - 보강: 1.2 alpha 단계 설명에 'feature gate = Kubernetes 옵션으로 신기능을 미리 활성화/비활성화하는 메커니즘'을 한 줄 추가. 1.5에 '내부 버전(internal version) = API Server가 리소스를 etcd에 저장할 때 사용하는 표준 포맷(모든 API 버전을 이것으로 통일)' 명시. Admission Controller는 '접수 제어기 = 리소스 생성/수정 시 정책 검증·변경하는 플러그인'으로 주석 추가
- **🔴 HIGH** `스토리라인누락` _1.1 등장 배경 섹션_
  - 문제: 기존 방식의 고통(직전 기술)이 추상적. '즉시 업데이트 필요''CI/CD 파이프라인 깨짐' 정도만 언급. 구체적 사례(예: K8s 1.15 이전 Ingress extensions/v1beta1 사용 중 1.22 업그레이드 시 모든 Ingress가 동시에 깨지는 사건)가 없어 학생이 '왜 이런 복잡한 시스템이 필요한가' 체감 못함
  - 보강: 1.1에 '구체적 사례' 문단 추가: 'K8s 1.15 기반 실운영 클러스터가 Ingress를 extensions/v1beta1로 배포 중이던 상황. 1.22 자동 업그레이드 시 해당 API가 제거되면서 모든 Ingress가 한순간에 동작 불가 → 운영 중단. 이 사태를 방지하려면 deprecated 기간 동안 점진적 마이그레이션이 필수'를 구체적으로 삽입
- **🔴 HIGH** `맥락점프` _3.1 Ingress 마이그레이션 - pathType 필드_
  - 문제: pathType: Prefix/Exact/ImplementationSpecific 3가지가 뭐 다른지 설명 없음. 학생이 '왜 pathType이 필수인가'를 모르고 단순히 복사-붙여넣기만 함. 자격증 실기에서 Ingress 수정 문제 출제 시 pathType을 빼면 버린 점
  - 보강: 3.1 주석에 pathType 설명 추가: 'pathType = URL 경로 매칭 방식. Prefix(접두어 매칭: /api는 /api, /api/v1 다 포함), Exact(정확한 경로만: /api는 /api만), ImplementationSpecific(nginx/ingress-controller 등 구현체 방식). v1에서는 필수. 시험에선 대부분 Prefix 사용'으로 명시
- **🔴 HIGH** `정확성오류` _섹션 1.4 API 버전 변경 이력 - CronJob 줄_
  - 문제: K8s 1.22와 1.25 줄에서 CronJob 상태가 혼용됨: '1.22: CronJob batch/v1beta1 -> batch/v1 (deprecated)' vs '1.25: CronJob batch/v1beta1 -> batch/v1 (제거)'. 1.22에 batch/v1beta1이 여전히 deprecated(경고만) 상태인지, 1.25에 실제 제거되는지 확인 필요. 공식 문서와 맞는지 재확인 요청
  - 보강: 공식 K8s Deprecation Policy 재확인: https://kubernetes.io/docs/reference/using-api/deprecation-policy/. CronJob 정확 타임라인 재기입. 만약 1.22에 deprecated 알림만 표시되고 1.25에 제거면, 표현을 '(deprecated 알림 표시)' -> '(제거됨)'으로 명확히 구분
- **🔴 HIGH** `실습재현불가` _섹션 2 - 모든 실측 검증 블록_
  - 문제: CLAUDE.md 규약 위반(§4①): 명령 실행 출력이 '예상 출력' 이름으로 ```text 블록에만 기록됨. 실제 터미널 스크린샷 이미지가 0개. 학생이 '내 터미널 출력이 이 텍스트와 정확히 같은가'를 비교할 수 없음. 텍스트 출력은 손쉽게 지어낼 수 있으므로 신뢰도 낮음
  - 보강: 문제 1/2 정도는 실제 tart dev 클러스터에서 'kubectl api-versions | grep batch' 등의 명령을 실행한 후 터미널 스크린샷(PNG)을 캡처해 'images/day11-001-api-versions.png' 등으로 저장하고 마크다운에 '![kubectl api-versions 출력](images/day11-001-api-versions.png)' 형식으로 삽입. 길이상 모든 예제는 불가능하나 대표 2~3개는 스크린샷 필수
- **🟡 MED** `이해난이도` _1.5 'API Server의 버전 변환 메커니즘' 섹션_
  - 문제: '내부 버전(internal version)'이 정의 없이 쓰임. '저장한다' 했을 때 학생이 '뭐가 뭐라는 거야'를 느낌. etcd 저장 구조가 왜 이렇게 복잡한지 메커니즘 설명 부족
  - 보강: 메커니즘 설명 추가: '내부 버전 = K8s가 모든 API 리소스를 통일된 포맷(예: __internal)으로 메모리·etcd에 저장. 클라이언트가 다양한 버전(v1alpha1/v1beta1/v1)으로 요청해도, API Server가 내부로 변환 처리한 후 etcd에는 내부 형식으로만 저장. 버전 제거 시 클라이언트 요청만 거부하면 되고, etcd 마이그레이션은 불필요. 이게 하위호환성을 오래 지탱하는 이유'로 명확히
- **🟡 MED** `맥락점프` _섹션 2.3 'kubectl explain' 사용법_
  - 문제: 너무 짧음(3줄). 실제 출력 예시가 한국어 가상 텍스트만 있음. 'kubectl explain pod.spec.containers'했을 때 **실제 터미널에서 뭐가 나오는가**를 모르므로 학생이 손으로 실행해 보면 놀라거나 혼동함
  - 보강: 섹션 2.3 확장: "kubectl explain deployment.spec.selector"의 실제 출력(또는 스크린샷)을 보여주면서 'required 필드 표시 해석법' 설명. 예: '[...] REQUIRED <LabelSelector>   Indicates that selector must be defined [...]' 같은 실제 텍스트. 학생이 '출력에서 REQUIRED를 봤으니 이건 꼭 필요하구나' 체감하게
- **🟡 MED** `구조` _섹션 3 - Ingress/CronJob/Deployment 마이그레이션_
  - 문제: 3개 리소스가 각각 다루어지나, **공통 패턴(apiVersion 변경, 스키마 변경, selector 필수화 등)**을 정리한 표/다이어그램이 없음. 학생이 3개를 따로따로 외워야 함. '모든 마이그레이션의 핵심 패턴'으로 통합하는 섹션이 있으면 학습 효율 높음
  - 보강: 섹션 3 앞에 '마이그레이션 공통 체크리스트' 표 추가:\n| 항목 | Ingress | CronJob | Deployment |\n| --- | --- | --- | --- |\n| 새 apiVersion | networking.k8s.io/v1 | batch/v1 | apps/v1 |\n| 필드 변경 유무 | 많음(annotation->spec) | 없음 | selector 추가 |\n| pathType/selector 같은 신규 필수 필드 | pathType:Prefix | 없음 | selector:|\n이런 식으로 비교하면 패턴 보임
- **🟡 MED** `정확성오류` _섹션 3.1 - pathType enum 표현_
  - 문제: 마이그레이션 예제에서 pathType: Prefix로 고정됐으나, 3가지 옵션(Prefix/Exact/ImplementationSpecific)의 차이를 설명하지 않음. 자격증 문제에서 '특정 경로만 매칭하려면?'이라고 물으면 Exact를 모르는 학생이 틀림
  - 보강: 주석 추가: '# pathType: Prefix (경로 접두어로 매칭)  # Exact면 /api만, Exact가 필요한 경우도 시험에 출제됨' 으로 명시. 가능하면 Exact 사용 예제도 추가
- **🟡 MED** `용어비약` _섹션 4.2 '클러스터의 deprecated API 사용 현황 확인' 명령_
  - 문제: 'kubectl get --raw /metrics | grep apiserver_requested_deprecated_apis' 명령이 갑자기 등장. 학생이 '/metrics'가 뭔지, Prometheus metrics 엔드포인트인지 모를 수 있음. 명령이 실제로 dev 클러스터에서 동작하는지도 미불명
  - 보강: 주석 추가: '# /metrics = API Server가 노출하는 Prometheus 메트릭스 엔드포인트. deprecated API 사용 횟수 추적. (dev에서 가능 여부 확인 후 실행, 일부 클러스터에선 비활성화될 수 있음)'. 또는 이 명령은 섹션 4.1 기본 사용법만 다루고 고급은 생략
- **🟡 MED** `스토리라인누락` _섹션 3 - 왜 backend 구조가 변경됐는가_
  - 문제: Ingress의 old `serviceName/servicePort` vs new `service.name/service.port.number` 변경이 단순히 '스키마 변경'으로만 나옴. 왜 이렇게 변경했는지(예: port를 수치와 이름 둘 다 지원하려고), 트레이드오프가 없음. 학생이 '그냥 이렇게 쓰는구나'만 배움
  - 보강: 주석 추가: '# 변경 이유: v1에서는 포트를 이름(service.port.name)으로도 참조 가능. 따라서 구조를 중첩(service.port.number/name)으로 변경해 유연성 확보. 기존 servicePort(수치만)는 후퇴'
- **⚪ LOW** `맥락점프` _섹션 5 '실전 시험 문제(6문제)' - 문제 4 풀이_
  - 문제: 풀이에서 'selector는 불변(immutable)'이라고 하는데, 왜 불변인지 설명 없음. 학생이 '실수로 selector 바꾸면 뭐가 터지나' 몰라도 됨
  - 보강: 주석 추가: '# selector는 불변: Pod를 선택하는 기준이 생성 후 바뀌면 기존 Pod는 orphan(고아)되고 새로운 Pod가 중복 생성될 수 있음. 따라서 API Server가 수정을 거부. replicas만 변경 가능하고 selector는 삭제 후 재생성만 가능'
- **⚪ LOW** `정확성오류` _섹션 2.3 예제 명령 'kubectl explain ingress.spec.rules'_
  - 문제: 명령 예시로 'kubectl explain ingress.spec.rules.http.paths'가 있으나, tart dev 클러스터에서 이 명령이 실제로 동작하는지 확인 필요. v1.31+ 클러스터면 'GROUP: networking.k8s.io / VERSION: v1'로 나와야 함
  - 보강: 실제 tart dev 클러스터에서 'kubectl explain ingress.spec.rules.http.paths' 실행 후 스크린샷 삽입(또는 '(미검증)' 표기). 출력 예시도 현실 클러스터 버전과 일치하도록 수정

### daily/day12.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `맥락점프` _섹션 1 전체 (문제 1-6, API Deprecation)_
  - 문제: API Deprecation의 등장 배경이 없음. Kubernetes가 extensions/v1beta1을 deprecated 처리한 이유, 버전 호환성이 왜 중요한지, 마이그레이션을 안 하면 구체적으로 무엇이 깨지는지(예: 클러스터 업그레이드 시 리소스 로드 실패)를 설명하지 않아 학생이 '왜 이걸 해야 하나'를 이해할 수 없음.
  - 보강: 섹션 1 최상단에 "왜 API 버전이 바뀌나" 문단 추가: 'Kubernetes 개발팀이 API를 개선하면서 이전 버전(extensions/v1beta1)은 유지보수가 끝나고 향후 버전(1.30+)에서는 완전히 제거된다. 이를 대비해 사전에 마이그레이션하지 않으면 클러스터 업그레이드 후 리소스가 로드되지 않는 장애가 발생한다.' + 실제 사례(v1.16에서 extensions/v1beta1 Deployment 제거 시점)를 시간표로 명시.
- **🔴 HIGH** `용어비약` _섹션 1, 문제 4 Ingress 생성 솔루션 (라인 107-183)_
  - 문제: pathType 필드가 필수라고만 했지, 왜 필수인지, 없으면 어떻게 되는지 설명 전무. networking.k8s.io/v1에서 왜 pathType을 추가했는가(이전 extensions/v1beta1은 경로 매칭이 구현 정의 ImplementationSpecific이었음)하는 배경이 없어 학생은 '외워야 할 규칙'으로만 인식.
  - 보강: Ingress pathType 설명 추가: 'Prefix는 경로의 접두어 매칭(예:/api는 /api, /api/user 모두 매칭), Exact는 정확히 일치, ImplementationSpecific은 controller에 위임. v1에서 필수화한 이유는 서로 다른 ingress controller가 경로를 일관되게 해석하도록 강제하기 위함.' + 예시(pathType 누락 시 서로 다른 controller에서 다르게 동작하는 사례).
- **🔴 HIGH** `실습재현불가` _세디 1, 모든 문제 1-6의 '기대 출력' (라인 162-181)_
  - 문제: 'dev 실측 (ns cap-ckad-d12에 동등 리소스 생성 후 캡처)' 주석이 있지만 실제 터미널 스크린샷 이미지가 전혀 없음. CLAUDE.md § 4① 규칙(명령 출력은 실제 스크린샷만, 로 녅데른 텍스트 블록 금지)을 위반. 학생이 '내 kubectl 출력이 맞나' 검증할 기준이 없음.
  - 보강: 각 문제 풀의 '기대 출력' 세로 실제 tart dev 클러스터에서 kubectl을 실행한 터미널 스크린샷(PNG)을 첨부. 예: kubectl apply -f ingress.yaml 후 kubectl describe ingress web-ingress 의 실제 화면 캡처.
- **🔴 HIGH** `맥락점프` _늨션 2.1, Observability 필요 이유 (라인 334-349)_
  - 문제: '마이크로서비스 환경에서는 서비스 간 호출 관계가 복잡하여'라고만 했는데, 구체적 장애 시나리오가 없음. 예를 들어 'A → B → C 호출에서 응답이 10초 걸린 때, 어디서 느린지 모르는 문제'처럼 구체 사례가 필요한데 없어 학생이 '그래서 뭐가 문제인데?' 상태.
  - 보강: 장애 시나리오 추가: '예: 전자상거래 주문 서비스에서 "주문 완료까지 30초 걸림" 이슈. 전통적 모니터링은 CPU/메모리 수치만 보여주므로 어디서 느린지(결제 API의지 알림 발송의지) 알 수 없다. Observability(Metrics+Logs+Traces)로 요청의 전체 경로를 추적하면 "
B의 재고 조회가 20초"임을 즉시 파악 가능.'
- **🔴 HIGH** `이해난이도` _늨션 2.3, Metrics Server 내부 동작 (라인 376-387)_
  - 문제: Metrics Server의 cAdvisor·kubelet·메모리 저장만 설명. 학생이 '그럼 Prometheus와 뭐가 다른데?'라고 질문할 때 답 없음. Metrics API(단기, 메모리)와 Prometheus(장기, 디스크)의 역할 구분이 필요한데 누락.
  - 보강: Metrics Server와 Prometheus 비교 문단 추가: 'Metrics Server는 각 kubelet에서 최근 ~1분 데이터를 주기적으로 수집해 메모리에만 저장(HPA 스케일링 결정용, 실시간). Prometheus는 모든 메트릭을 디스크에 장기 저장하고 쿼리·그래프·알림이 목적(모니터링·분석용). 따라서 "지난 1시간 CPU 추이"는 Prometheus로만 가능하지만 "현재 CPU 사용률"은 kubectl top(Metrics Server 기반)이 빠르다.'
- **🟡 MED** `맥락점프` _늨션 2.2, HPA autoscaling/v1 vs v2 표 (라인 204-240)_
  - 문제: v2에서 Memory·Custom·다중 메트릭·behavior가 추가되었다는 사실은 있으나, 왜 필요했는가의 배경 부재. 예: v1로는 CPU만 스케일링하므로 메모리가 남아도는 경우(비효율) 또는 요청 처리량 기반 스케일링이 불가능한 한계가 없음.
  - 보강: HPA 진화 배경 추가: '"
v1에서는 CPU 사용률로만 Pod 개수를 조정하므로 메모리 고갈은 감지 못 하고, 복수 조건(CPU 70% AND 메모리 80%)으로 스케일링할 수 없었다. v2부터 Memory·Custom 메트릭을 함께 지정해 더 세밀한 자동 조정이 가능." + 실제 예시(온라인 게임: 실시간 사용자 수/CPU/메모리 3가지 모두 높을 때만 스케일 아웃).
- **🟡 MED** `용어비약` _늨션 2.4, OOMKilled 진단 (라인 525-553)_
  - 문제: OOMKilled의 정의 없음. 학생이 'Killed면 좋다는 건데, 구체적으로 무엇인가' 불분명. Kubernetes 런타임이 메모리 limits 초과 프로세스를 강제 종료하는 동작이라는 설명 필요.
  - 보강: OOMKilled 설명 추가 문단: 'Out of Memory Killed의 줄임. Pod에 설정한 memory limits(예: 256Mi)를 초과하는 순간 Kubernetes는 해당 컨테이너 프로세스를 강제 종료한다. Pod가 계속 재시작되면 CrashLoopBackOff 상태가 됨.' + diagram(memory usage 증가 -> limits 초과 -> 프로세스 kill).
- **🟡 MED** `정확성오류` _늨션 2.3 끝, Metrics Server와 HPA 설명 (라인 386)_
  - 문제: 'Metrics Server는 HPA의 CPU/메모리 기반 스케일링에도 사용된다'는 맞으나, Custom Metrics 스케일링(autoscaling/v2)은 별도의 metrics provider(예: Prometheus adapter)가 필요함을 안 함. 학생이 'HPA = Metrics Server 사용'으로 오인.
  - 보강: HPA와 메트릭 소스 관계 정확화: 'HPA autoscaling/v1·v2의 Resource 타입(CPU/Memory) 메트릭은 Metrics Server를 사용. 그러나 v2의 Custom/External 타입은 별도 커스터 metrics provider(예: Prometheus adapter, custom-metrics-apiserver) 구현 필요. 시험(CKAD)에서는 주로 Resource 타입만 출제.'
- **🟡 MED** `맥락점프` _늨션 4, 트러블슈팅 예제들 (라인 505-553)_
  - 문제: '증상 → 디버깅 → 해결'이라는 구조는 좋으나, 실제 tart dev 클러스터에서 직접 재현한 스크린샷이 없음. 학생이 'kubectl logs의 출력이 정말 이대로 나옥나' 확신할 수 없음.
  - 보강: 각 장애 시나리오마다 실제 kubectl 커맨드 스크린샷 추가. 예: Metrics API not available 에러의 실제 터미널 캡처, metrics-server Pod의 CrashLoopBackOff 상태를 보여주는 'kubectl get pods -n kube-system' 출력 PNG.
- **⚪ LOW** `구조` _늨션 6, 실습 (라인 636-678)_
  - 문제: '실습' 도단이 있지만 '실습을 하면 문다 달성되나' 목표가 명시되지 않음. 1·2·3 실습을 순서대로 따라 하고 나면 학생이 '이제 시대로 시낗 문제를 풀 수 있다'는 확신이 없음.
  - 보강: 각 실습 앞에 '이 실습 후 달성 가능'한 도반을 명시. 예: '### 실습 2: 리소스 모니터링 (이 후 "Pod가 메모리 부족으로 재시작되는 이유"를 진단할 수 있음)'.

### daily/day13.md · 가독성 4/5 · 스토리 4/5 · 미달❌

- **🔴 HIGH** `용어비약` _§2.2 'tmpfs(메모리 기반 파일시스템)에 마운트'_
  - 문제: tmpfs가 처음 등장하는데, '메모리에 쓰지 않고 디스크에 안 간다'가 무엇을 의미하는지 불명확. Linux 파일시스템 백그라운드 없는 학부생은 '메모리 기반'의 의미가 추상적이다. 실제로 'Secret을 볼륨으로 마운트하면 /var/lib/kubelet/pods/xxx/volumes/kubernetes.io~secret/ 디렉토리에 tmpfs가 여기 바인드 마운트되는데, 이 디렉토리가 메모리만 사용해 프로세스 종료 시 자동 소거된다'는 구체성이 부족하다.
  - 보강: tmpfs 설명 추가: '실제로 `mount | grep tmpfs`로 확인하면 kubelet이 마운트한 Secret 디렉토리(예: /var/lib/kubelet/pods/.../volumes/kubernetes.io~secret/)가 tmpfs 유형으로 메모리(예: size=123MB)에만 쓰여 있고, 파드 종료 시 디렉토리째 메모리에서 해제된다. 반면 ConfigMap은 일반 디렉토리라 디스크 캐시에도 남을 수 있다.' + 실제 노드 SSH에서 `mount | grep 정수` 캡처 추가.
- **🔴 HIGH** `스토리라인누락` _§2.1 Secret이 ConfigMap과 분리된 이유 ~ §2.2 정의_
  - 문제: Secret의 등장 배경이 약하다. '보안 측면에서 다를 뿐 기능적으로는 ConfigMap과 동일'이라고 하지만, '왜 Kubernetes 설계자는 Secret이란 별도 리소스를 만들었나'의 이야기가 없다. 실제 원인은 ① RBAC 분리(권한 범위 줄이기) ② etcd 암호화 지원 ③ audit log 분리라는 보안 정책의 표현인데, 이게 '전략적 필요'임을 제시하지 않는다. '비용 없이 보안을 높인다'는 마케팅이 아니라, '보안이 중요한 환경(금융, 의료, 국방)에서는 비밀번호 접근을 엄격히 분리·감시해야 하는데, ConfigMap으로는 그럴 수 없다'는 '문제'의 맥락이 필요하다.
  - 보강: §2.1 개행 후 추가: '\n\n[Secret만 분리된 이유 — 보안 정책 관점]\n\nConfigMap과 Secret은 저장소 기술적으로 같은 etcd에 둘 다 Base64 저장된다(Secret도 encryption at rest가 없으면 평문 가능). 그렇다면 왜 분리했나? 답은 **접근 권한의 의도적 차별화**이다. 금융회사는 개발자에게 DB 호스트·포트(ConfigMap)는 알려도 비밀번호(Secret)는 DBA만 볼 수 있어야 한다. Kubernetes RBAC는 리소스 종류별로 권한을 부여하므로(`apiGroups: [""], resources: ["secrets"], verbs: ["get"]`), Secret이란 리소스 타입을 별도로 두면 이를 표현할 수 있다. 또한 감사·컴플라이언스 관점에서 Secret 접근만 audit log에 따로 기록하고, etcd 암호화도 Secret에만 선택적으로 적용할 수 있다. **결론: Secret은 기술이 아니라 보안 정책 도구**이다.'
- **🔴 HIGH** `실습재현불가` _§1.5 subPath 마운트 설명 + 주의사항_
  - 문제: "subPath로 마운트된 파일은 ConfigMap 업데이트 시 자동 갱신되지 않는다"는 문장만으로는 학부생이 '왜'를 이해하지 못한다. 내부 동작(symlink swap mechanism)을 설명했지만, **'이걸 직접 검증하는 명령이 없다**'. "kubelet이 새 타임스탬프 디렉토리를 생성하고 `..data` symlink를 atomic하게 교체한다"는 설명은 수동 명령으로 확인 불가능하다(kubelet 로그 조회 필요). 따라서 학생은 "아, 이론적으로 그렇군" 정도로 넘어가고, **실제 Pod에서 subPath 마운트 후 ConfigMap을 수정했을 때 파일이 안 바뀌는 현상을 직접 보지 못한다** → 자격증 시험에서 이 함정을 마주치면 당황한다.
  - 보강: §1.5 '주의' 단락 뒤 추가 소제목 '**검증: subPath 갱신 불가 확인**'. 명령: (1) ConfigMap 생성(test-app=v1), (2) subPath로 파드 마운트, (3) exec로 파일 읽기(`cat` 결과 v1), (4) ConfigMap 수정(test-app=v2), (5) 5초 대기, (6) 같은 파드에서 다시 읽기(`cat` 결과 여전히 v1), (7) 결론: 안 바뀜. **각 단계마다 실제 터미널 스크린샷 이미지** 첨부. 일반 마운트(items 없이) vs subPath 비교 테이블로 갱신 여부(자동갱신/수동갱신) 가시화.
- **🔴 HIGH** `정확성오류` _§2.3 Secret 종류 표 & §2.4 방법 4_
  - 문제: YAML stringData 설명(§2.4 방법 4): "저장 후 `kubectl get secret -o yaml`로 보면 `data` 필드에 Base64로 저장되어 있다"는 맞지만, **실제 저장된 후에도 stringData 필드가 남아 있나?** 테스트하면: stringData로 생성 → `kubectl get ... -o yaml`하면 stringData는 사라지고 data만 남다. 이건 자동 변환이지 '두 필드가 함께 존재'가 아니다. 문서에서 '평문으로 작성 -> 자동 Base64 인코딩'이라고만 하면, 학생이 '내가 stringData로 `password: S3cur3P@ss!`라고 썼는데 출력에는 data.password만 있네?'라며 헷갈린다. **stringData는 쓰기 전용(write-only) 필드**라는 핵심을 명시하지 않으면 검증 단계에서 꼬인다.
  - 보강: §2.4 방법 4 코드블록 뒤 주의 문단 추가: '**주의: stringData는 쓰기 전용이다.** YAML의 stringData는 kubectl apply 시에만 인식되고, 저장 후 `kubectl get secret -o yaml`로 조회하면 stringData 필드는 사라지고 data 필드에 Base64로 저장되어 있다(Kubernetes가 내부 변환). 따라서 `kubectl apply -f secret.yaml`(stringData 포함) → `kubectl get secret ... -o yaml`(stringData 없음, data만)이라는 흐름을 이해해야 자격증에서 혼동하지 않는다.' + 검증 명령 추가: stringData 파일로 create → get -o yaml으로 data만 남은 모습을 실제 스크린샷.
- **🟡 MED** `맥락점프` _§3 Secret 보안 모범 사례_
  - 문제: §3은 이론적 체크리스트(etcd 암호화·RBAC·외부 도구·git 제외·정리)를 나열하지만, '어느 것이 CKAD 시험에서 묻는가'를 명시하지 않는다. CKAD는 "Secret을 만들고 Pod에 주입" 정도만 묻고, **etcd 암호화는 CKA의 범위**다. 학생이 §3을 전부 암기하려다 시간을 낭비할 수 있다. 특히 '외부 Secret 관리(Vault·External Secrets Operator)'는 CKAD 범위를 벗어난다(CKS/CKA 심화).
  - 보강: §3 제목 변경: '§3 Secret 보안 모범 사례 (CKA·CKS 심화)'. 첫 문단에 범위 명시: '다음은 CKAD 범위를 벗어난 CKA·CKS 심화 내용이다. CKAD 시험에서 묻는 것은 ① secret을 env/volume으로 주입 ② Base64 vs stringData 차이다. 이 장은 실무·인프라 관점의 배경 지식으로 읽기 바란다.'
- **🟡 MED** `용어비약` _§1.3 방법 4 YAML stringData_
  - 문제: application.yaml의 멀티라인 YAML 예제: `spring.datasource.url: jdbc:postgresql://postgres:5432/mydb`는 **구체성이 떨어진다**. ConfigMap에 YAML을 통째로 저장하는 것은 Spring 애플리케이션이 ConfigMap을 YAML 파서로 읽을 때만 유용한데, 학부생이 "왜 설정을 YAML로 ConfigMap에 넣지?"라고 자문할 수 있다. 일반적으로는 설정 파일(예: application.properties, nginx.conf)이나 환경 변수로 주입하는 게 관례다. 여기선 '예제'일 뿐인데 설명 없이 놓으면 실제 쓸 때 헷갈린다.
  - 보강: §1.3 방법 4 코드블록 아래 설명 추가: '**용도**: Spring Boot의 경우, classpath:application.yaml을 ConfigMap의 application.yaml 키로 대체할 수 있다(containerPort 환경변수). 이렇게 하면 이미지에 설정을 고정하지 않고 ConfigMap 변경으로 런타임 동작을 바꿀 수 있다. 다만 일반적으로는 key=value 형식(§1.3 방법 3)이나 env 주입(§1.4 방법 1·2)이 더 흔하다.'
- **🟡 MED** `이해난이도` _§1.6 ConfigMap 업데이트 동작 표 + 내부 동작 설명_
  - 문제: 4가지 업데이트 동작(env 안 됨, volume 됨, subPath 안 됨, immutable 불가)이 나열되지만, **각각이 왜** 그렇게 동작하는지 메커니즘이 생략됐다. 예: "환경 변수는 Pod 재시작이 필요"는 맞지만, 왜인가? → Pod 생성 시 env는 초기화 후 고정되기 때문. Volume은 kubelet sync period로 주기적으로 갱신되는데, env는 컨테이너 프로세스 시작 후 변경 불가능. 이 원인을 모르면 시험에서 응용 문제(예: "ConfigMap 변경 후 5초 내에 반영되려면?")를 못 푼다.
  - 보강: §1.6 표 아래 추가 소절 '**왜 이런 차이가 생기나?**': 'env 환경변수는 컨테이너 프로세스 시작 시 shell이 초기화하고, 프로세스 실행 중에는 변경 불가능(OS 프로세스 속성). 따라서 ConfigMap 변경은 기존 파드를 영향주지 않고, 새 파드만 반영된다. 반면 volume은 kubelet(쿠버네티스 노드 에이전트)이 주기적으로 마운트 포인트를 갱신(inotify 또는 60초 폴)하므로 Pod 재시작 없이 자동 반영된다. subPath는 직접 바인드 마운트(`mount --bind`)라 심볼릭 링크 교체 메커니즘이 적용되지 않는다(§1.5 참고).'
- **🟡 MED** `구조` _§4 트러블슈팅 — 3가지 장애 시나리오_
  - 문제: 각 시나리오는 **증상·원인·해결**만 있고, **왜 그렇게 해결하면 되는가**라는 설명이 부족하다. 예: 장애 2(Secret 이중 인코딩) — `stringData` 사용이 해결책이라고 하지만, 왜 stringData는 이중 인코딩을 피하는가? 설명 없으면 학생이 다음 번엔 또 같은 실수를 한다. 또한, **자신의 시험 문제가 이 3가지와 다를 때** 전이(transfer)가 안 된다.
  - 보강: 장애 2 해결책 뒤에 설명 추가: '**왜 이렇게 되는가**: data 필드는 이미 Base64인 값을 기대하므로, 마크다운·YAML 파서가 그대로 Base64로 저장한다. 반면 stringData는 "내부 변환용 임시 필드"로, Kubernetes API가 자동으로 Base64 인코딩한 후 data에 옮긴다. 따라서 stringData를 쓰면 인코딩 횟수가 1회로 줄어든다.' 장애 3도 '왜 subPath가 해결책인가' 설명 추가: 'subPath는 단일 파일 마운트이므로 기존 디렉토리 내용이 유지된다(§1.5 비교 참고).'
- **🟡 MED** `용어비약` _§1.4 방법 3 검증 코드블록 라인 200_
  - 문제: kubectl exec 결과에서 prefix 사용 예시: `prefix: DB_`로 설정하면 `DB_HOST`, `DB_PORT` 등으로 환경변수명이 결정된다고 하지만, **ConfigMap 키에 `-`(하이픈)가 있으면 어떻게 되는지** 설명이 없다. 실제로 ConfigMap에 `app-name: myapp`이 있으면 `envFrom` + `prefix`에서도 `-`를 포함한 변수명(`APP-NAME`)이 되는데, Linux 환경변수는 `-`를 불허한다(유효 문자: `[a-zA-Z_][a-zA-Z0-9_]*`). 이 함정을 모르면 "envFrom으로 ConfigMap을 주입했는데 왜 특정 키의 환경변수가 안 나타나?"라는 자격증 문제를 못 푼다.
  - 보강: §1.4 방법 2 검증 코드블록 아래 주의 추가: '**주의: 환경변수명 유효성**: Linux 환경변수명은 `[a-zA-Z_][a-zA-Z0-9_]*` 패턴만 허용된다(숫자·하이픈·특수문자 불가). ConfigMap에 `app-name` 같은 하이픈이 포함된 키가 있으면, envFrom으로 주입해도 그 키는 무시되어 env에 나타나지 않는다. 유효한 변수명만 나타난다. 다른 말로, "ConfigMap의 일부 키가 env에 없다"면 키명에 유효하지 않은 문자가 있는지 확인하라.'

### daily/day14.md · 가독성 4/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `스토리라인누락` _1.1-1.2 섹션 (Immutable 등장 배경)_
  - 문제: kubelet의 WATCH 메커니즘이 설명 없음. 학생이 'kubelet이 ConfigMap을 어떻게 감시하는가'를 이해 불가능. '변경 감시 중단 -> API Server 부하 감소' 관계만 있고 내부 동작(informer/reflector, WATCH API, etcd 폴링) 누락.
  - 보강: kubelet의 WATCH 장시간 연결 → ConfigMap 변경 이벤트 브로드캐스트 → Pod별 kubelet 수만 개 호출 문제 → immutable 시 WATCH 등록 중단으로 부하 감소, 까지의 인과관계를 메커니즘 수준에서 설명 추가.
- **🔴 HIGH** `용어비약` _153-155줄 nginx 패턴 (configHash annotation)_
  - 문제: 'configHash: {{ .Values.configHash }}' 주석이 왜 필요한지 설명 없음. 학생이 'volumeMount는 자동 갱신되는데 왜 annotation이 필요한가' 못 이해. 실제로는 'ConfigMap 변경 시 Pod가 자동 재시작되지 않음 -> 수동으로 annotation 변경해서 강제 재시작' 패턴인데 배경 부재.
  - 보강: ConfigMap volumeMount 시 '파일은 60초 후 갱신되지만 Pod는 재시작 안 됨' 문제 → annotation/label 변경으로 Pod 템플릿 강제 변경 → 자동 롤링 재시작 유도, 를 단계별로 설명. Helm checksum 예제 추가.
- **🔴 HIGH** `정확성오류` _섹션 3 (실전 시험 문제 1-12)_
  - 문제: 모든 문제의 '기대 출력'이 ` ```text ` 블록으로 텍스트만 포함됨 (341-346줄, 419-422줄 등). CLAUDE.md 규약 §4① 위반: '명령 결과는 반드시 실제 터미널 스크린샷 이미지로야 함. 텍스트 블록 금지'. 학생이 '이게 진짜 실행 결과인지' 검증 불가능.
  - 보강: 각 문제 검증 섹션에서 실제 tart dev/staging 클러스터에서 명령을 실행하고 스크린샷 캡처 -> images/day14-prob1.png 등으로 저장 -> ![검증](images/..png) 로 삽입. 최소한 '본 교재 작성자가 실행한 실제 화면' 캡처 필수.
- **🟡 MED** `스토리라인누락` _2.4 섹션 (Projected Volume), 312줄_
  - 문제: 'expirationSeconds에 따라 kubelet이 자동으로 갱신한다'고 만 함. 학생이 'TokenRequest API란 무엇인가', 'symlink 구조 (..data/token)가 왜 필요한가', '언제 어떤 API를 호출하는가' 못 이해. Pod 내 토큰 파일 구조(641-646줄)의 설명도 불충분.
  - 보강: ServiceAccount 토큰 갱신 메커니즘: 1) expirationSeconds=3600 설정 시 kubelet이 (만료-5분) 시점에 TokenRequest API 호출 2) 새 토큰을 /etc/config/..data_new 에 작성 후 atomic rename으로 ..data 전환 3) Pod는 symlink 경로 변경 없이 다음 read()에서 새 토큰 얻음, 을 단계별로 설명.
- **🟡 MED** `용어비약` _섹션 2.3 (Spring Boot 설정), 176-256줄_
  - 문제: application.yaml에서 ${DB_HOST}:${DB_PORT} 변수를 사용하는데, '이 변수가 어디서 오는가'를 설명하지 않음. 학생이 'Spring Boot의 placeholder 치환인가, K8s env 주입인가' 혼동. Pod env로 DB_HOST를 주입했을 때 Spring Boot가 이를 어떻게 읽는지 메커니즘 부재.
  - 보강: Spring Boot의 환경 변수 처리: JVM 시작 시 OS 환경 변수를 읽고 application.yaml의 ${VAR}를 치환하는 메커니즘 설명 + 올바른 구현 2가지 (env 주입 vs ConfigMap volumeMount)를 예제로 제시.
- **🟡 MED** `용어비약` _섹션 1 (Secret 타입), 520-703줄_
  - 문제: secret generic 과 secret docker-registry 만 언급. Secret의 다른 타입(tls, service-account, basic-auth, ssh-auth)이 존재하고 용도가 다른데 설명 없음. 학생이 '언제 어느 타입을 써야 하는가' 판단 기준 부재. 시험에서 'tls secret 으로 Ingress TLS 설정' 같은 문제가 출제될 수 있음.
  - 보강: Secret 타입별 용도 표 추가: generic (임의 key-value), docker-registry (프라이빗 레지스트리), tls (인증서+키), service-account (SA 토큰, 자동 생성), basic-auth (HTTP Basic), ssh-auth (SSH 키), 각각 사용처 1줄씩.
- **🟡 MED** `스토리라인누락` _실전 문제 풀이, 섹션 3_
  - 문제: 모든 문제가 '해결 방법'만 제시하고, '이 문제를 푸는 데 왜 이 방법을 쓰는가' (트레이드오프)가 없음. 예: 문제 3 vs 문제 4 (env vs envFrom)의 차이, 언제 어디를 쓰는가 선택 기준 부재.
  - 보강: 각 문제 풀이 뒤에 '왜 이 방법을 썼는가' (언제 env, 언제 envFrom, 언제 volume mount)를 선택 판단 기준과 함께 추가.
- **🟡 MED** `용어비약` _섹션 8 (Secret 값 디코딩), 807-825줄_
  - 문제: Base64 디코딩 명령은 있지만, 'Secret.data는 왜 Base64인가', 'Secret.stringData와의 차이'가 불명확. 학생이 '평문 vs 암호화' 오해 가능 (실제로 Base64는 인코딩이지 암호화 아님). 문제 6에서도 '아, Secret에 평문을 바로 쓸 수 없네' 정도만 깨닫게 됨.
  - 보강: 섹션 1에 'Secret의 저장소 메커니즘' 추가: etcd에 base64 인코딩된 평문으로 저장됨 (암호화 아님) -> RBAC/encryption-at-rest 로 접근 제어. stringData vs data 선택 기준 명확히.
- **🟡 MED** `이해난이도` _2.2 nginx 패턴, 114-174줄_
  - 문제: nginx.conf가 ConfigMap.data에 복사되는 과정(파일 경로, 권한, 마운트 포인트)이 추상적. livenessProbe가 /health 에서 200 ok 를 기대하는데, 위 nginx.conf 설정이 이를 어떻게 제공하는지 추적 어려움. 학생이 '구조를 따라 쓰되, 왜 이렇게 하는가' 못 이해.
  - 보강: 마운트 흐름도: ConfigMap (default.conf 키) -> /etc/nginx/conf.d (마운트 포인트) -> nginx가 /etc/nginx/conf.d/*.conf 를 읽음 -> 이 예제의 default.conf가 그 폴더에 자동 배치. livenessProbe는 nginx가 location /health 를 응답하는지 HTTP GET 으로 검사, 를 도식화.
- **🟡 MED** `실습재현불가` _실습 섹션 6 (tart-infra 실습), 991-1055줄_
  - 문제: kubectl 명령은 있지만, 실제 실행 결과(스크린샷)가 없음. Pod 로그 확인(1049줄) 등이 '기대 출력'으로만 제시되고, 실제 클러스터에서 어떻게 나오는지 검증 불가. 학생이 명령을 따라 했을 때 다른 결과가 나오면 '뭐가 잘못됐나' 진단 어려움.
  - 보강: 실습 1-3 각각의 명령을 실제 dev/staging 클러스터에서 실행한 스크린샷 추가.
- **⚪ LOW** `용어비약` _862줄 트러블슈팅 2 (projected volume 권한)_
  - 문제: '각 source에 mode를 지정할 수 있다'고만 하고, YAML 예제가 없음. 학생이 'projected.sources[].configMap.mode 또는 secret.mode 같은 필드인가' 추측 필요.
  - 보강: Projected Volume mode 설정 YAML 예제 추가: configMap items[].mode: 0644, secret items[].mode: 0400 등.
- **⚪ LOW** `스토리라인누락` _섹션 1 (Immutable), 62-72줄_
  - 문제: Immutable 설정 후 '변경하려면 새 ConfigMap을 생성'이라고만 함. 실전에서 '옛 버전으로 롤백하려면?', '여러 버전을 동시에 관리하려면?' 같은 패턴이 없음. 특히 CKS/운영 관점에서 중요.
  - 보강: ConfigMap 버전 관리 패턴 추가: 1) 이름 기반 (app-config-v1, v2...) 2) label selector 3) GitOps(ArgoCD) 와 각각의 롤백 방법.
- **⚪ LOW** `용어비약` _섹션 5 (자주 하는 실수), 885-951줄_
  - 문제: 실수 4 (Base64 줄바꿈)에서 echo vs echo -n 차이는 있지만, 'multiline 데이터(예: nginx.conf)를 Secret에 넣으려면' 같은 고급 케이스가 없음.
  - 보강: secret create 시 multiline stringData 예제: stringData: config.yaml: |
  line1
  line2 같은 pipe 사용법 추가.
- **⚪ LOW** `이해난이도` _섹션 4 복습 체크리스트, 979-987줄_
  - 문제: 체크리스트 항목은 있지만 답안이 <details> 로 숨겨져 있지 않음. 학생이 자신의 답을 검증할 수단 없음.
  - 보강: 각 체크리스트 항목 뒤에 <details><summary>정답</summary> ... </details> 형태의 자가점검 답안 추가.
