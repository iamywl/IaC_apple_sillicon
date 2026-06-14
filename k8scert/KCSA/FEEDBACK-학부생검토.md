# KCSA 교재 — 학부 3~4학년 관점 검토 피드백

> 생성: 2026-06-12 · 파일당 1 에이전트 병렬 검토 · 기준 CLAUDE §4④

- 단독합격 **1/15** · 평균 가독성 **3.4/5** · 평균 스토리라인 **2.8/5**
- 부족분 총 **187** (HIGH 76/MED 78/LOW 33) · HIGH 카테고리: 용어비약 22, 스토리라인누락 18, 실습재현불가 11, 맥락점프 10, 이해난이도 9, 정확성오류 4, 구조 2

| 파일 | 합격 | 가독성 | 스토리 | H/M/L |
|:--|:--:|:--:|:--:|:--:|
| 01-concepts.md | ❌ | 3 | 2 | 8/6/2 |
| 02-examples.md | ❌ | 3 | 2 | 5/6/3 |
| 03-exam-questions.md | ✅ | 4 | 4 | 0/5/8 |
| 04-tart-infra-practice.md | ❌ | 4 | 4 | 5/4/2 |
| 05-supplement.md | ❌ | 3 | 2 | 4/4/1 |
| daily/day01.md | ❌ | 3 | 3 | 4/8/2 |
| daily/day02.md | ❌ | 4 | 3 | 5/5/2 |
| daily/day03.md | ❌ | 3 | 4 | 5/5/1 |
| daily/day04.md | ❌ | 3 | 2 | 4/3/2 |
| daily/day05.md | ❌ | 4 | 3 | 5/4/2 |
| daily/day06.md | ❌ | 4 | 3 | 6/5/2 |
| daily/day07.md | ❌ | 3 | 3 | 8/10/3 |
| daily/day08.md | ❌ | 4 | 3 | 4/5/2 |
| daily/day09.md | ❌ | 3 | 2 | 7/6/1 |
| daily/day10.md | ❌ | 3 | 2 | 6/2/0 |

---

### 01-concepts.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `용어비약` _1.1 클라우드 네이티브 보안의 4C 도입부_
  - 문제: '심층 방어(Defense in Depth)' 용어를 정의 없이 사용. 학생이 '왜 4개 계층으로 나뉘는지', '각 계층이 뚫렸을 때 다음 계층이 보호하는 구체적 메커니즘'을 이해 못함.
  - 보강: Defense in Depth 개념을 먼저 설명: '보안은 단일 계층에만 의존할 수 없으므로 여러 겹의 방어(마치 양파 껍질)를 구성하는 방식'이라고 직관부터. 그 후 4개 계층이 각각 뚫렸을 때 다음 계층이 어떻게 피해를 최소화하는지 시나리오로 제시(예: '클라우드 IAM이 유출돼도 클러스터 RBAC이 권한을 제한하고, 그것도 뚫려도 컨테이너의 seccomp이 위험한 시스콜을 차단한다')
- **🔴 HIGH** `스토리라인누락` _2.1.3 Admission Control 전체_
  - 문제: '왜 Admission Control이 필요한가'를 설명하지 않음. 학생은 '이것이 인증/인가 후에 오는 추가 필터링'이라는 것만 알고, '어떤 보안 위협으로부터 보호하는가'를 모름.
  - 보강: 등장 배경 섹션 추가: '초기 Kubernetes에는 인증과 인가만 있었고, 인증된 사용자가 불안전한 설정(latest 태그, 특권 컨테이너)을 배포할 수 있었다. 정책 엔진이 필요해졌다. Webhook 기반 Admission Control이 외부 검증 로직을 삽입할 수 있게 했고, 이후 ValidatingAdmissionPolicy(1.28+)가 API Server 내에서 직접 정책 평가를 가능하게 했다' 같은 진화 과정 + 각 업그레이드의 트레이드오프(외부 webhook의 지연시간 vs 내장 정책의 제한성)
- **🔴 HIGH** `이해난이도` _3.1 Pod Security Standards (PSS) 전체, 특히 'PodSecurityPolicy deprecated 이유' 섹션_
  - 문제: PSP의 5가지 한계를 나열했으나, CS학부생이 '복잡한 바인딩 모델'이 왜 문제인지 이해할 수 없음. 'Pod를 직접 생성하는 경우와 Deployment를 통해 생성하는 경우 적용되는 PSP가 달라질 수 있다'는 현상 설명만 있고, '언제/어떻게 달라지는가'의 실제 케이스 없음.
  - 보강: 구체적 예시 추가: '사용자가 kubectl run으로 Pod를 직접 생성하면 사용자의 권한이 검사되지만, Deployment 매니페스트로 배포하면 Deployment 리소스를 생성하는 권한이 검사되고, 실제 Pod는 Deployment Controller의 ServiceAccount로 생성되어 다른 PSP가 적용될 수 있다'와 같은 실제 차이. 그리고 PSA는 '네임스페이스 레이블 기반이므로 이 모호함이 없다'는 개선점을 명시.
- **🔴 HIGH** `맥락점프` _3.5 NetworkPolicy 섹션의 'AND 관계' 설명 (line 630-632)_
  - 문제: 'podSelector와 namespaceSelector가 같은 항목에 있으면 AND, 별도 항목에 있으면 OR'이라는 규칙을 선언적으로 제시하나, '왜 이 규칙인가'를 설명 안 함. 학생이 YAML 작성 시 실수할 가능성 높음.
  - 보강: 규칙 전에 직관: 'from/to 배열의 각 항목은 "이 조건 중 하나라도 만족하면 허용"이고(OR), 같은 항목 내 여러 셀렉터는 "이 조건들을 모두 만족해야 허용"(AND)이다. 예: from[0]={podSelector, namespaceSelector}는 "이 특정 namespace의 이 특정 pod만", from[0]/from[1]로 분리하면 "이 namespace의 모든 pod OR 다른 namespace의 특정 pod"' + 다이어그램.
- **🔴 HIGH** `정확성오류` _3.1 Restricted 레벨 설명 (line 402)_
  - 문제: 'NET_BIND_SERVICE만 추가 허용'이라 했으나, 실제로는 제한 없이 특정 low port(1024 이하)를 바인드할 필요 없으면 NET_BIND_SERVICE도 drop하는 것이 권장됨. 문서에서 '유일하게 허용되는 capability'로 표현하면 학생이 모든 Restricted Pod에 이것을 추가해야 한다고 오해.
  - 보강: 'NET_BIND_SERVICE는 80/443 같은 low port를 바인드해야 할 때만 선택적으로 추가할 수 있다. 대부분의 워크로드는 이것도 drop하는 것이 더 안전하다'로 수정. 또는 표에 '선택사항'으로 명시.
- **🔴 HIGH** `용어비약` _4.2 MITRE ATT&CK for Containers, Lateral Movement (line 910)_
  - 문제: 'ARP 스푸핑'이라 했으나, Kubernetes 클러스터 내부는 주로 L3(IP) 통신이고, 컨테이너 네트워크 네임스페이스 분리로 인해 ARP가 거의 의미 없음. 이것은 전통 LAN ARP 공격으로, 클라우드 네이티브 환경에서는 부실하거나 오도적임.
  - 보강: 'ARP 스푸핑' 제거 또는 '같은 Pod 네트워크 내 ARP 스푸핑(드물음)'. 대신 더 현실적인 예: '허용되지 않은 Service로의 통신 시도, 다른 네임스페이스 Pod로의 직접 접근(NetworkPolicy 없을 때)' 등으로 수정.
- **🔴 HIGH** `용어비약` _4.3 SBOM 섹션 (line 919-950)_
  - 문제: SBOM 정의가 '소프트웨어 구성 요소의 목록'이라고만 하고, '왜 Kubernetes 자격증에서 다루는가' (즉 '공급망 보안'과의 연결)를 명시 안 함. Log4Shell 사례는 좋으나, Kubernetes 배포 파이프라인에서 SBOM이 어떻게 검증되는지(예: Image attestation, 레지스트리 스캔)를 연결 안 함.
  - 보강: SBOM 도입에 '컨테이너 빌드 시 SBOM을 생성하고, 배포할 이미지마다 SBOM을 함께 저장/서명하여 언제든 영향 범위를 파악할 수 있다'는 실제 workflow 추가. Kubernetes 환경에서는 '이미지 서명/attestation과 결합되어 신뢰할 수 있는 이미지만 배포된다'고 명시.
- **🔴 HIGH** `스토리라인누락` _5.2 Runtime Security 섹션 전체 (line 1042-1113)_
  - 문제: eBPF vs 커널모듈 vs ptrace의 비교표는 있으나, '왜 커널모듈이 사용되다가 eBPF로 전환됐는가'의 역사/배경이 없음. '커널 버전 의존성', '패닉 위험' 같은 문제 설명만 있고, '프로덕션에서 실제로 커널 모듈 기반 Falco를 썼을 때 어떤 장애가 발생했나' 같은 구체적 사례가 없어 학생이 심각도를 체감할 수 없음.
  - 보강: 역사적 진화 추가: 'Falco는 초창기(2015~2019)에 커널 모듈만 지원했고, 프로덕션 환경에서 시스템 크래시를 유발하는 사고들이 있었다. 특히 새 커널 버전이 나올 때마다 모듈을 재컴파일해야 해 배포가 어려웠다. 2019년 eBPF 드라이버가 도입되면서 검증기 기반의 안전성과 커널 버전 독립성을 확보했다'는 식의 타임라인.
- **🟡 MED** `이해난이도` _2.3 kubelet 보안 (line 298-312)_
  - 문제: --read-only-port=0 설정을 '읽기 전용 포트를 비활성화한다'고만 설명. 학생이 '읽기 전용 포트(10255)가 왜 위험한가'를 이해하지 못함. '인증 없이 정보를 노출할 수 있다'는 피상적 설명만 있고, '구체적으로 어떤 정보(노드 상태, Pod 목록, 노드 리소스)가 노출되고, 공격자가 이를 어떻게 악용하는가'를 다루지 않음.
  - 보강: 'kubelet의 10255 포트는 인증 없이 GET /pods, /stats 등의 엔드포인트에 접근 가능하여 클러스터의 모든 Pod 정보, 노드 메모리/CPU 사용량이 노출된다. 공격자는 이를 통해 중요 Pod의 위치를 파악하고 타게팅 공격을 계획할 수 있다. 따라서 반드시 0으로 설정하여 비활성화해야 한다'로 확장.
- **🟡 MED** `용어비약` _5.3 Zero Trust 네트워크 모델 (line 1189-1219)_
  - 문제: Zero Trust 원칙의 5가지를 나열했으나, 'Perimeter-based 보안의 한계'를 설명하면서 '전통 경계 기반'이 무엇인지 Kubernetes 이전의 학부생이 이해할 배경이 없을 가능성. 또한 'Lateral Movement'가 무엇인지 정의 없이 사용.
  - 보강: 용어 정의 추가: 'Perimeter-based란 방화벽으로 외부와 내부를 구분하는 전통 네트워크 보안(DMZ 개념). Kubernetes의 경우 클러스터 내 모든 Pod가 기본으로 서로 통신 가능해 이 경계가 무의미하다.'와 'Lateral Movement는 초기 진입점(1개 Pod 침해)에서 시작해 클러스터 전체로 확산하는 공격 방식'을 명시.
- **🟡 MED** `맥락점프` _6.3 Audit Logging (line 1334-1409)_
  - 문제: Audit 레벨과 단계가 테이블로만 제시됨. 학생이 '실제로 어떤 레벨과 단계를 조합해서 사용하는가' 또는 '왜 Secret은 Metadata만 기록하는가'를 설명 없이 정책 예시만 보면 이해 못함.
  - 보강: 설정 원칙 추가: 'Secret처럼 민감한 리소스는 요청/응답 본문(request, requestResponse)을 기록하면 평문 데이터가 로그에 남으므로 위험하다. 따라서 메타데이터(사용자, 시간, 동작)만 Metadata 레벨로 기록하여 누가 접근했는지는 추적하되 실제 비밀은 보호한다'는 이유 제시.
- **🟡 MED** `스토리라인누락` _3.3 RBAC (line 480-586)_
  - 문제: RBAC이 '역할 기반 권한 부여'라는 정의만 있고, 'ABAC(속성 기반)와 비교해 왜 RBAC이 선호되는가'의 스토리가 없음. 또한 'system:masters 그룹 사용 금지' 같은 조언이 있지만, '언제/왜 필요한가'를 설명 안 함(비상 상황).
  - 보강: RBAC 등장 배경: 'Kubernetes 초기에는 ABAC(속성 기반)를 사용했으나, 정책 파일을 수정할 때마다 API Server를 재시작해야 해 운영이 어려웠다. RBAC은 클러스터 내 리소스로 정책을 정의하므로 동적 변경이 가능하고, Role/RoleBinding이라는 명확한 개념으로 직관적이다'는 개선점 명시. 그리고 'system:masters는 RBAC를 완전히 우회하는 관리자 그룹으로, 클러스터가 완전히 잠긴 긴급 상황에서만 사용하며, 평상시는 일반 admin Role을 사용해야 감사 로그에 기록된다'고 설명.
- **🟡 MED** `실습재현불가` _2.2 etcd 보안 - Secret 암호화 설정 후 검증 (line 245-296)_
  - 문제: etcdctl 명령 실행 결과가 ```text 블록의 텍스트만 제시되고, '실제로 터미널에서 명령을 실행한 스크린샷'이 없음. 학생이 직접 따라 하려고 할 때 '이 명령이 정말 동작하는가' 확신할 수 없음.
  - 보강: 지침(CLAUDE.md)에 따라 실제 클러스터에서 etcdctl 명령을 실행하고 터미널 캡처 이미지를 삽입. 평문 출력과 암호화된 출력의 hexdump 스크린샷을 각각 넣어 시각적 차이를 강조.
- **🟡 MED** `이해난이도` _2.1.3 Admission Control - reinvocationPolicy 설명 (line 154-155)_
  - 문제: 'reinvocationPolicy: IfNeeded 설정 시, 이전 webhook의 수정으로 인해 다른 webhook을 다시 호출할 수 있다'고만 설명. 학생이 '어떤 상황에서 필요한가'를 모름. 또한 '무한 루프 위험'이 있는지 없는지 명시 안 함.
  - 보강: 실제 사용 사례 추가: 'Mutating webhook A가 Pod에 사이드카 컨테이너를 주입하면, 이후 Webhook B가 실행되는데 B의 정책이 "Pod 컨테이너 개수 제한"이라면 원래 Pod는 정책을 만족했지만 A의 수정 후 위반될 수 있다. reinvocationPolicy: IfNeeded를 설정하면 B가 위반을 감지할 때 A를 다시 호출하지 않고(무한루프 방지) 최종 검증만 수행한다'고 설명.
- **⚪ LOW** `용어비약` _1.2 CNCF Security TAG (line 40-49)_
  - 문제: '보안 관련 CNCF 프로젝트 리뷰 및 평가를 수행한다'고 했을 때, 학생이 '어떤 기준으로 평가하는가'를 모름. 또한 나열된 프로젝트(Falco, OPA, TUF, Notary, SPIFFE/SPIRE)가 무엇인지 간단히라도 설명 없음.
  - 보강: 각 프로젝트를 한 줄로 정의: 'Falco(런타임 위협 탐지), OPA(정책 엔진), TUF(안전한 업데이트), Notary(이미지 서명), SPIFFE(워크로드 신원)'로 미리 소개하거나, 본문 첫 등장 시 하이퍼링크/각주로 정의 제시.
- **⚪ LOW** `이해난이도` _3.2 Pod Security Admission - 모드별 레이블 형식 (line 410-420)_
  - 문제: 'pod-security.kubernetes.io/enforce', 'audit', 'warn' 레이블이 있다는 것은 제시되나, '이 3가지를 동시에 모두 설정할 수 있는가'라는 질문에 문서가 직접 답하지 않음. 예시에서 4개 레이블을 동시에 적용하므로 추론은 가능하지만, 명시적 설명이 있으면 좋음.
  - 보강: '이 3가지 모드는 동시에 설정할 수 있으며, 보통 먼저 warn/audit로 현재 워크로드의 위반을 파악한 후 enforce로 강제한다'고 명시.

### 02-examples.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `스토리라인누락` _§1.1 RBAC 등장배경 - 'ABAC는 정책을 JSON 파일로 관리하며, 변경 시 API Server 재시작이 필요했다'_
  - 문제: 직전 ABAC 기술의 구체적 한계와 RBAC이 무엇을 개선했는지의 연결이 약함. 단지 '문제가 있었다'는 나열로 끝남. 예를 들어 'ABAC는 정책 적용이 비원자적(atomic)이므로, 정책 변경 중 API Server가 재시작되면 일부 요청은 이전 정책, 일부는 새 정책으로 평가되어 권한 불일치 발생'같은 메커니즘 수준 설명 부족.
  - 보강: ABAC의 JSON 파일 기반 정책 방식이 '런타임 중 변경 불가능'하다는 한계를 기술 수준에서 설명. RBAC이 '클러스터롤과 역할바인딩으로 분리하여 이론상 동적 변경 가능'하게 개선한 메커니즘을 명시. 그리고 RBAC도 완벽하지 않음(예: roleRef immutable의 트레이드오프)을 덧붙여 완결성 확보.
- **🔴 HIGH** `용어비약` _§2.1 NetworkPolicy 등장배경 - 'CNI 플러그인에 의해 구현된다'_
  - 문제: CNI가 무엇인지 사전 설명 없음. 컴퓨터공학 학부 3~4학년이 CNI(Container Network Interface)를 안다고 가정할 수 없음. kubenet, Calico, Cilium의 관계도 명확하지 않음.
  - 보강: 'CNI: Container Network Interface. Kubernetes의 네트워킹을 담당하는 플러그인 표준. kubenet(기본, 간단하지만 기능 제한)은 NetworkPolicy를 지원하지 않지만, Calico·Cilium 등 고급 CNI는 이를 구현함'으로 한 문장 풀이 추가. 그리고 'NetworkPolicy를 지원하지 않는 CNI에 정책을 적용하면 보안상 실제 효과가 없으므로 반드시 지원하는 CNI를 선택해야 한다'고 명시.
- **🔴 HIGH** `맥락점프` _§2.3 Ingress 규칙 - AND/OR 관계 설명 (line 453-487)_
  - 문제: AND/OR의 구체적 메커니즘 설명이 YAML 포지셔닝(들여쓰기)만 의존함. 배열 요소가 분리되면 OR, 같은 배열 요소 내에 있으면 AND라는 설명은 '규칙'이지 '이유'가 아님. 왜 Kubernetes 설계자들이 이 문법을 선택했는지의 직관이 없음.
  - 보강: 'from 배열의 각 요소는 OR: 하나 이상의 from 항목이 매칭되면 트래픽 허용. 배열 요소 내 조건들(namespaceSelector와 podSelector)은 AND: 둘 다 만족해야 그 배열 요소가 true. 예: from[0]이 OR, from[0].namespaceSelector와 from[0].podSelector는 AND.'로 명확히 구조화. 그리고 실제 실패 시나리오(from 배열로 분리하면 다른 NS의 모든 Pod + 현재 NS의 특정 Pod 모두 허용됨 = 의도치 않은 오픈)를 구체적으로.
- **🔴 HIGH** `용어비약` _§3.2 PSA 레벨 설명 - 'privileged', 'baseline', 'restricted'의 정의_
  - 문제: 각 레벨이 차단하는 것들을 나열했지만, '왜 이 기준을 선택했는가'에 대한 보안 철학이 없음. restricted는 '무엇이 제한되는가'가 아니라 '왜 이 정도로 제한하는가'를 알아야 함.
  - 보강: 'restricted: Pod이 최소 권한으로만 실행되도록 강제. 이는 Zero Trust 보안의 적용 - 모든 실행 바이너리가 특정 권한을 명시하지 않으면 기본적으로 거부. baseline: 알려진 최악의 보안 안티패턴(privileged, hostNetwork 등)만 차단하되, 대부분의 기존 애플리케이션 호환 유지. privileged: 제약 없음(권장하지 않음).'으로 철학 기저 설명 추가.
- **🔴 HIGH** `이해난이도` _§4.2 EncryptionConfiguration (line 934-995)_
  - 문제: 'AES-CBC', 'KMS v2', 'secretbox'라는 세 가지 암호화 방식이 한꺼번에 제시됨. 학생이 어떤 것을 언제 선택해야 하는지, 그들의 보안 강도·성능 차이를 이해할 수 없음. 각 방식의 메커니즘도 불충분.
  - 보강: AES-CBC는 간단하지만 padding oracle 공격 취약점 설명. KMS v2는 '봉투 암호화: 로컬 DEK로 데이터 암호화, KEK(외부 KMS)로 DEK만 암호화. 외부 KMS 장애 시 3초 타임아웃 리스크'로 메커니즘 명시. secretbox는 'AES-CBC 보다 안전한 XSalsa20-Poly1305 AEAD 인증 암호화'로 위치 명시. 그리고 '프로덕션 권장: KMS v2 > secretbox > AES-CBC' 순서 제시.
- **🟡 MED** `실습재현불가` _§4.3 Secret Encryption 검증 - etcdctl 명령 (line 1039-1055)_
  - 문제: etcdctl 사용을 가정하지만, 1) etcdctl이 어디서 나오는지(path, 설치 여부), 2) API Server가 자체 서명 인증서 사용 시 --cacert 경로가 다를 수 있음, 3) 일반 학생이 etcd Pod에 접근하기 어려운 환경도 있음(관리형 K8s)을 고려하지 않음.
  - 보강: 'etcdctl은 etcd 바이너리 번들에 포함. 설치 확인: which etcdctl. 경로가 없으면 etcd 공식 릴리스에서 설치(https://github.com/etcd-io/etcd/releases). kubeadm으로 설치한 클러스터의 경우 /etc/kubernetes/pki/etcd/ 내 인증서 위치 확인 필수. EKS/GKE 같은 관리형 환경에서는 etcd 직접 접근 불가 - 대신 kubectl patch로 이미 암호화된 Secret 재저장하여 확인'으로 환경별 가이드 추가.
- **🟡 MED** `용어비약` _§5.2 Audit Policy - 'omitStages', 'RequestReceived' (line 1112-1115)_
  - 문제: 용어 정의 없이 사용. RequestReceived와 응답 단계의 차이, 그리고 왜 RequestReceived를 제외하는지의 이유가 '노이즈 방지'로 끝남. 로그 볼륨의 실제 규모를 모르면 의사결정 불가.
  - 보강: 'omitStages: RequestReceived를 생략하는 이유: API Server가 요청 수신 → 인증 → 권한검사 → 처리 → 응답 단계를 거치는데, RequestReceived는 처리 전 로그(모든 요청), ResponseComplete는 처리 후 로그(차단된 요청 제외). RequestReceived 로그는 초당 수백 건이므로 제외하면 스토리지 50% 절감 가능. 단 감사 목적으로 모든 요청 추적이 필요하면 omitStages를 비워두어야 함'으로 트레이드오프 명시.
- **🟡 MED** `맥락점프` _§6.2 seccomp RuntimeDefault 프로파일 (line 1312-1336)_
  - 문제: '50-60개의 위험한 시스템 콜을 차단한다'고 했지만, 정확히 어떤 시스템 콜이 차단되는지, 왜 이 수치인지 설명 없음. 학생이 RuntimeDefault의 효과를 예측할 수 없음.
  - 보강: 'containerd의 기본 seccomp 프로파일에서 차단하는 시스템 콜: mount(파일시스템 마운트 공격 방지), ptrace(다른 프로세스 조작 방지), reboot(호스트 재부팅 방지), bpf(eBPF 프로그램 로드), keyctl(커널 키 접근), fsconfig(filesystem 설정 변조), umount 등 약 60개. 전체 400+ 시스템 콜 중 대다수는 자동 허용. 커스텀이 필요하면 Localhost 프로파일 사용'으로 구체화.
- **🟡 MED** `용어비약` _§7.1 AppArmor 등장배경 - '/etc/shadow', '/proc/sysrq-trigger' (line 1520-1525)_
  - 문제: Unix 파일시스템과 procfs의 의미를 학부 4학년도 당연히 알 것으로 가정. /etc/shadow는 '패스워드 해시 저장소', /proc/sysrq-trigger는 '커널 디버그 인터페이스'라는 한 줄 설명 없음.
  - 보강: '/etc/shadow: Unix 시스템의 사용자 패스워드 해시 저장 파일(root만 읽기 권한). 공격자가 이를 탈취하면 오프라인 해시 크래킹으로 모든 사용자 계정 침해. /proc/sysrq-trigger: /proc 가상 파일시스템의 시스템 요청 핸들. 여기에 특정 문자를 쓰면 커널에 명령 전달(재부팅, 메모리 덤프 유발 등). 컨테이너 내부에서 쓰기 가능하면 호스트 제어 가능'으로 각 파일의 역할과 위협 명시.
- **🟡 MED** `정확성오류` _§7.2 Kubernetes 1.30+ securityContext 방식 (line 1528-1550)_
  - 문제: 'Kubernetes 1.30부터 GA가 된'이라고 했는데, 확인 필요. AppArmor Profile은 더 이전 버전에서도 beta로 존재했을 가능성. 명확한 버전 정보 필요.
  - 보강: 정확한 GA 버전 확인 후 명시(또는 'beta 상태에서 1.30에 GA 승격' 같이 정정). 그리고 'Kubernetes 1.30 미만 환경에서도 어노테이션 방식으로 사용 가능하지만, securityContext 방식(1.30+)이 더 직관적이므로 새 클러스터는 후자 권장'으로 버전 호환성 설명.
- **🟡 MED** `실습재현불가` _§8.5 Gatekeeper 실습 검증 - Rego 정책 작성 (line 1954-1969)_
  - 문제: ConstraintTemplate의 Rego 코드를 학생이 직접 이해하고 작성할 수 없음. 정책이 왜 그렇게 작동하는지의 Rego 문법 설명 부족. 특히 'violation[{"msg": msg}]' 문법과 'set operation(required - provided)'의 의미 불명.
  - 보강: 'violation: Gatekeeper가 인식하는 규칙 결과 값. violation이 1개 이상 반환되면 리소스 거부. provided := {...}: 제공된 라벨들의 집합. required := {...}: 필수 라벨들의 집합. missing := required - provided: 집합 차(set difference)로 누락된 라벨 계산. 상세 Rego 문법은 [OPA 공식 문서] 링크'로 기본 개념과 학습 경로 분리.
- **⚪ LOW** `이해난이도` _§8.3 Allowed Repos 제약 (line 1815-1828)_
  - 문제: initContainers와 ephemeralContainers를 검사해야 한다고 했는데, ephemeralContainers가 무엇인지 학생이 알 수 없음.
  - 보강: 'ephemeralContainers: 기존 Pod 삭제 없이 동적으로 추가되는 임시 컨테이너. kubectl debug 명령으로 프로덕션 Pod에 디버깅 컨테이너 주입 시 사용. 이를 제약하지 않으면 공격자가 exec 없이 Pod에 악성 이미지로 진입 가능'으로 한 문장 설명.
- **⚪ LOW** `용어비약` _§9.2 ServiceAccount automountServiceAccountToken (line 2026-2056)_
  - 문제: '자동 마운트'가 정확히 어디에 마운트되는지, 토큰의 형식(JWT인지)이 불명. 설명에는 '/var/run/secrets/kubernetes.io/serviceaccount/token' 경로만 있음.
  - 보강: '자동 마운트: kubelet이 Pod 생성 시 ServiceAccount의 토큰을 Secret 형태로 volumeMount하여 /var/run/secrets/kubernetes.io/serviceaccount/token에 노출. 토큰은 JWT(JSON Web Token) 형식으로, base64 인코딩됨(암호화 아님).'으로 메커니즘과 포맷 명시.
- **⚪ LOW** `이해난이도` _§10.2 Falco 규칙 - 'spawned_process', 'outbound' 메크로 (line 2180-2225)_
  - 문제: Falco 필터 문법의 'spawned_process', 'open_read', 'outbound' 등이 정의되지 않음. 학생이 커스텀 규칙을 작성할 수 없음.
  - 보강: 'spawned_process: 새 프로세스가 fork/exec된 이벤트. open_read: 파일을 읽기 모드로 open한 시스템 콜. outbound: 네트워크 송신(send/sendto). 이들은 Falco의 기본 매크로로 [Falco 규칙 레퍼런스](https://falco.org/docs/rules/) 참고'로 학습 경로 제시.

### 03-exam-questions.md · 가독성 4/5 · 스토리 4/5 · 합격✅

- **🟡 MED** `실습재현불가` _문제 8-15, Kubernetes Cluster Component Security 섹션_
  - 문제: etcd 백업, kubelet 설정 변경, admission controller 순서 등은 손으로 해야 하는 실습인데, 검증 명령이 '확인' 수준에 그침. 예: 문제 8 'etcd TLS 설정'은 `cat /etc/kubernetes/manifests/kube-apiserver.yaml`로만 확인하고, 실제로 TLS 없이 etcd에 접근 후 비교하는 미니랩이 없음
  - 보강: 각 문제마다 '🛠 직접 해보기' 섹션 추가. 예: 문제 8 'EncryptionConfiguration 적용 전후 Secret 조회 비교 실습' — (a) encryption at rest 미적용 상태에서 etcdctl로 Secret 읽기 (b) EncryptionConfiguration 적용 (c) 동일 Secret 다시 읽기 → 암호화됨을 확인하는 단계별 실습
- **🟡 MED** `정확성오류` _문제 9, 431줄_
  - 문제: 'kubeadm은 기본적으로 etcd TLS 인증서를 생성한다' 설명 후 'tart-infra의 kubelet 설정에서 authorization mode가 Webhook으로 설정되어 있는지 확인해 볼 수 있다'는 연결이 어색. 이전 문장과 주제가 다름(etcd TLS → kubelet authorization).
  - 보강: 내용 분리: '검증' 섹션 수정 — 'etcd TLS 확인' 명령은 문제 8 답변과 병합, 문제 9는 kubelet authorization Webhook만 집중해서 검증 명령 작성
- **🟡 MED** `이해난이도` _문제 22, OPA Gatekeeper 섹션(1167-1237줄)_
  - 문제: ConstraintTemplate의 Rego 언어 예시가 제시되지만, 학부생이 Rego 구문(violation[{msg: msg}], input.review.object 등)을 처음 보면 이해 불가. 'Rego는 무엇인가'부터 설명 필요
  - 보강: Rego 소개 추가: '(보충설명) Rego는 OPA가 사용하는 선언적 정책 언어로, SQL 쿼리처럼 조건을 작성하면 매칭 여부를 판단한다. input.review.object는 API 요청 객체, input.parameters는 Constraint에서 지정한 파라미터를 의미한다.'
- **🟡 MED** `스토리라인누락` _문제 30, hostNetwork 섹션(1691-1698줄)_
  - 문제: 'hostNetwork는 Ingress Controller, CNI 플러그인, 모니터링 에이전트가 필요로 한다'는 사용 사례는 제시하지만, '왜 이들은 hostNetwork가 필요한가'(기술적 필요성)에 대한 상세한 설명 부족
  - 보강: 구체화 예시 추가: 'Ingress Controller(MetalLB)는 ARP 프로토콜로 로드밸런서 IP를 광고해야 하는데, 이는 네트워크 네임스페이스 내에서 불가능하다. CNI(Cilium)는 각 노드의 veth 디바이스를 관리하므로 호스트 네트워크 네임스페이스 접근이 필요하다.'
- **🟡 MED** `실습재현불가` _문제 37, CIS Benchmark 검증(2107-2139줄)_
  - 문제: kube-bench 실행 명령만 있고, 실제 tart 클러스터에서 kube-bench 설치 및 실행 방법(Pod로 실행 vs 바이너리 직접 실행, 권한 요구사항)을 설명하지 않음. 학부생이 '그래서 어떻게 실제로 해야 하는가'를 알 수 없음
  - 보강: 실습 섹션 추가: '(실습) tart-infra dev 클러스터의 마스터 노드에 SSH 접근 후, `curl -L https://github.com/aquasecurity/kube-bench/releases/download/v0.7.0/kube-bench_0.7.0_linux_x86_64.tar.gz | tar xz` 로 설치, `sudo ./kube-bench run --targets master 2>&1 | tee kube-bench-result.txt`로 실행하고 결과 검토'
- **⚪ LOW** `용어비약` _문제 1, 41-44줄_
  - 문제: 'tart-infra의 Tart VM이 Cloud 계층에 해당한다' 는 표현이 학부생에게 사전지식 없이 이해되지 않음. Tart가 무엇인지(Apple Silicon 기반 VM 자동화 도구) 첫 등장 풀이 필요
  - 보강: 설명 추가: 'tart-infra(이 저장소의 실습용 VM 자동화 도구)의 Tart VM이 Cloud 계층에 해당하며, 호스트 하이퍼바이저가 인프라 보안의 기초가 된다'
- **⚪ LOW** `맥락점프` _문제 4, SBOM 검증(166-186줄)_
  - 문제: Trivy로 SBOM을 생성하는 명령은 제시하지만, 실제 클러스터에서의 검증 스크린샷이 없음. 텍스트 블록 형식으로 예시만 제시되어 '실제로 이렇게 나온다'는 증거 부족
  - 보강: CLAUDE.md 규칙 §4①에 따라 실제 클러스터에서 `trivy image --format cyclonedx nginx:1.25 | jq '.components[]'` 실행 후 터미널 스크린샷 캡처해 images/ 디렉터리에 저장, 마크다운에 ![SBOM 출력 예시](images/sbom-output.png) 형식으로 삽입
- **⚪ LOW** `스토리라인누락` _문제 11, 571-573줄의 '등장 배경'_
  - 문제: kubeadm 이전에 수동으로 인증서를 생성했다는 이야기는 있지만, '왜 /etc/kubernetes/pki/ 경로를 선택했는가'(이전 경로가 있었는가, 표준화의 필요성)에 대한 맥락이 부족
  - 보강: 구체화: 'kubeadm 이전에는 조직마다 다른 경로(/opt/k8s/certs, /etc/ssl/k8s 등)를 사용하여 운영 인수인계가 어려웠다. kubeadm이 /etc/kubernetes/pki/를 POSIX 표준 경로로 정함으로써, 모든 배포판이 동일한 위치에서 인증서를 관리할 수 있게 표준화되었다.'
- **⚪ LOW** `맥락점프` _문제 25, STRIDE 모델(1380-1402줄)_
  - 문제: STRIDE 정의 후 바로 '테이블 형식'으로 각 위협을 Kubernetes와 매핑하는데, 표 전에 'STRIDE 원래 정의 및 컴퓨터 보안에서의 의미'에 대한 짧은 설명이 있으면 이해가 쉬울 것
  - 보강: 도입 문장 추가: 'STRIDE는 Microsoft의 위협 모델링 프레임워크로, 각 문자가 하나의 위협 카테고리를 나타낸다. Kubernetes 환경에서는 각 데이터 흐름(사용자→API, Pod→Pod 등)이 이 6가지 위협에 노출되어 있으므로, 각각에 대해 보안 통제를 설계해야 한다.'
- **⚪ LOW** `용어비약` _문제 27, 1488줄_
  - 문제: 'SLSA(Supply-chain Levels for Software Artifacts) 프레임워크는 4단계의 성숙도를 정의한다'에서 'SLSA'와 'Supply-chain Levels'의 관계가 명확하지 않음. 약자 풀이 필수
  - 보강: 'SLSA(Supply-chain Levels for Software Artifacts, 소프트웨어 공급망 구성 요소의 성숙도 단계)'
- **⚪ LOW** `맥락점프` _문제 31, mTLS 검증(1720-1746줄)_
  - 문제: mTLS 설정 확인 명령 후 '비메시 Pod 요청 테스트'를 하는데, '비메시 Pod'의 개념 설명이 없음. Istio sidecar가 주입되지 않은 Pod을 의미한다는 것을 첫 등장 시 명시
  - 보강: 검증 섹션 첫 줄에 주석 추가: '# 비메시 Pod: Istio sidecar가 주입되지 않은 일반 Pod. Envoy 프록시가 없어 mTLS 핸드셰이크 불가능'
- **⚪ LOW** `용어비약` _문제 33, 런타임 클래스(1852-1882줄)_
  - 문제: 'RuntimeClass로 gVisor/Kata 사용 확인'이라는 표현 후 결과 출력에서 'gvisor' 항목이 있다는 것으로 설명 끝. RuntimeClass의 정의(Pod가 어떤 런타임을 사용할지 선택하는 메커니즘)를 명시하지 않음
  - 보강: 검증 명령 전 설명 추가: 'Kubernetes RuntimeClass는 Pod 스펙에서 runtimeClassName: gvisor라고 지정하면, 해당 Pod이 runc 대신 gVisor(runsc) 런타임에서 실행된다는 뜻이다.'
- **⚪ LOW** `정확성오류` _문제 38, GDPR 준수(2215줄)_
  - 문제: 'GDPR Article 30은 처리 활동 기록을 의무화한다'고 했는데, 정확히는 Article 30이 '기록 보관(Records of Processing Activities)'을 의무화하고, Article 33/34가 '침해 통지(Breach Notification)'를 의무화한다. 구분 필요
  - 보강: 정확화: 'GDPR Article 33/34는 72시간 내 침해 통지를 의무화하며, 이를 위해서는 누가 언제 데이터에 접근했는지 기록(Article 30)이 필요하다.'

### 04-tart-infra-practice.md · 가독성 4/5 · 스토리 4/5 · 미달❌

- **🔴 HIGH** `용어비약` _Lab 1.1 제목('VM 격리 확인'), Lab 1.2 ('RBAC, NetworkPolicy, Admission Control') 등 여러 곳_
  - 문제: 제목에 핵심 기술명을 나열하기만 했으며, '격리'나 'RBAC'가 처음 등장하는 독자를 위한 한 줄 직관 없음. 특히 Lab 1.2에서 Cilium CNI, Istio, CiliumNetworkPolicy 등이 동시 등장하는데 선후 관계 미정리
  - 보강: 각 Lab 제목 아래에 '학습 목표' 절 추가: '이 실습에서는 X 기술이 Y 문제를 해결하는 방식을 배운다. 배경: [직전 기술 한계 1줄]. 핵심: [개선점 1줄].' 형식으로 작성. 예: Lab 1.2는 '기본 Kubernetes NetworkPolicy(L3/L4)의 한계를 Cilium eBPF(L7)로 극복하는 방식 학습' 으로 시작
- **🔴 HIGH** `스토리라인누락` _사전준비(9~119줄) - kubeconfig/클러스터 환경 설명에만 3세트이며, 이후 실습과의 '왜 이 환경인가'를 못 찾음_
  - 문제: tart-infra가 무엇(Tart=macOS VM 하이퍼바이저)이고, 왜 이 환경을 택했는지(K3s 아님, 쿠버네티스 원본 kubeadm 클러스터인 이유), 시험과의 관계(CKA·CKS 실기는 실제 kubeadm 조작 필요) 등 맥락 제시 부족
  - 보강: 사전준비 섹션 시작(현행 9줄)에 '환경 선택 배경' 문단 삽입:
'이 실습은 tart(macOS Native Virtualization.framework 기반 VM) 위의 kubeadm 클러스터를 사용한다. 이유: (1) CKA·CKS 시험은 실제 Linux 노드의 etcd, kubeadm 명령, systemd 서비스를 직접 SSH로 조작해야 함 (2) 도커 데스크톱/Minikube 같은 경량 런타임은 이 요구사항을 충족하지 못함 (3) tart는 애플 실리콘에서 native 성능을 제공하면서도 빠른 VM 재생성 가능 (§3 참조).' 으로 명기
- **🔴 HIGH** `맥락점프` _Lab 1.1(VM 격리) → Lab 1.2(Cluster RBAC/NetworkPolicy) → Lab 1.3(containerd namespace) → Lab 1.4(환경변수 보안)의 순서_
  - 문제: 4C 모델(Cloud-Cluster-Container-Code)의 계층적 외곽→내곽 이동이 명확하지만, 각 Lab 간 '이전 Lab이 해결한 것'과 '이 Lab에서 추가로 다루는 보안 경계'를 명시 안 함. 학부생이 읽을 때 '왜 지금 이걸 배우는가'가 불명확
  - 보강: 각 Lab.N 시작에 '학습 경로' 문단 추가:
'Lab 1.1에서는 VM이 독립 커널을 가져 프로세스 격리를 제공함을 확인했다. 하지만 VM 내부의 여러 컨테이너 간 격리는 어떻게 이루어지는가? → Lab 1.2·1.3이 답한다. 먼저 클러스터 수준(RBAC, NetworkPolicy)의 정책 경계를 본 후, 컨테이너 수준(securityContext, namespace)의 격리를 본다.'
- **🔴 HIGH** `이해난이도` _Lab 2.1(API Server) - authorization-mode=Node,RBAC, NodeRestriction Admission Controller 등이 한 번에 등장(374줄)_
  - 문제: ABAC→RBAC의 역사적 전환(현행 482줄 등장배경)은 있지만, 'Node 인가 모드가 왜 필요한가(kubelet이 자신 Node만 접근)'라는 직관을 놓침. NodeRestriction은 더욱 구체적인 메커니즘(node-restriction.kubernetes.io/ 레이블 제한)인데, 이 계층 관계를 못 읽은 초심자는 개념 혼동
  - 보강: 1단계 직후에 '개념 정리' 문단 추가:
'API Server가 인가(authorization)할 때 3가지 모드를 체크: (1) Node — kubelet 자신의 Pod만 접근 (2) RBAC — 사용자/SA의 역할 기반 권한 (3) Webhook — 외부 시스템 위임. 이 3가지는 순차 평가(AND 조건): 하나라도 거부하면 최종 거부. NodeRestriction Admission Controller는 별도로, kubelet 요청의 내용(특히 레이블 수정) 자체를 검증하는 계층.'으로 명기하고 표 또는 다이어그램 추가
- **🔴 HIGH** `실습재현불가` _Lab 3.1(CiliumNetworkPolicy 분석) - 명령어와 예상 출력이 있지만, 최종적으로 '이 정책들이 정말 차단하는가'를 확인하는 테스트 명령 부족. Lab 3.2·3.3 등이 테스트를 다루지만 isolated_
  - 문제: Lab 3.1에서 11개 정책을 분석만 하고, '정책이 실제로 작동하는지' 한 번에 검증하는 종합 시나리오 없음. 학생이 개별 정책을 암기하더라도 전체 그림 재현이 어려움
  - 보강: Lab 3.1 마지막('정책 2단계: 전체 트래픽 흐름' 이후)에 '종합 검증 시나리오' 추가:
```bash
# 1단계: busybox 2개 생성(label 있음/없음)
kubectl run busybox-with-label --image=busybox -l app=test-allowed ...
kubectl run busybox-no-label --image=busybox --labels='app=test-denied' ...
# 2단계: 각 busybox에서 모든 앱(nginx/httpbin/redis 등)으로의 통신 시도
# 3단계: 결과 표로 정리(Pod A→Pod B / 허용/차단 / 정책명)
```
- **🟡 MED** `정확성오류` _Lab 2.1, 'NodeRestriction Admission Controller' 설명(1078~1080줄)_
  - 문제: 현행: 'kubelet이 자신의 Node 레이블 중 node-restriction.kubernetes.io/ 접두사가 있는 레이블만 수정 가능'. 부정확함. 정확한 동작: (1) kubelet이 **자신의 Node 오브젝트**만 수정 가능 (2) 그 중에서도 node-restriction.kubernetes.io/ 접두사 레이블만 수정 가능. 다른 레이블(예: disktype=ssd) 수정은 원천 거부. 현행 표현은 '자신 Node의 특정 레이블만' 처럼 읽혀 첫 번째 제약(다른 Node 접근 불가)을 암시적으로 만듦
  - 보강: 명확히 재작성:
'NodeRestriction Admission Controller는 두 가지 제약을 시행한다:
(1) kubelet은 **자신이 할당된 Node 객체만** 수정/삭제 가능 (다른 노드 접근 불가)
(2) kubelet이 수정하는 레이블 중 node-restriction.kubernetes.io/ 접두사 없는 것은 거부 (시스템 관리자만 설정 가능).
예: 노드 A의 kubelet은 node-restriction.kubernetes.io/my-label=value는 설정 가능하지만, disktype=ssd는 거부됨.'
- **🟡 MED** `용어비약` _Lab 2.2(etcd 보안) - 'Encryption at Rest'(1226줄) 설명 없이 'KMS v2'(1227줄) 언급_
  - 문제: 독자가 'Encryption at Rest'의 의미(데이터 저장 중 암호화, 전송 중 아님)를 모를 수 있음. KMS v2는 KMS v1과의 차이(v2는 공개키 암호화 방식, v1은 단순 데이터 암호화) 미설명
  - 보강: 'Encryption at Rest' 첫 등장(1226줄)에 각주 또는 문단 추가:
'**Encryption at Rest(저장 시 암호화)**: etcd 디스크에 저장되는 Secret, ConfigMap 등의 데이터를 AES-GCM 같은 알고리즘으로 암호화. etcd 파일을 직접 읽으면 암호문만 보임(KMS 키 없이 복호화 불가). 대비: TLS(전송 중 암호화)는 API Server ↔ etcd 통신만 보호하고, 디스크 저장 후에는 효과 없음.'으로 명기
- **🟡 MED** `스토리라인누락` _Lab 3.7(Secret 보안) 도입부(3444~3459줄) - EncryptionConfiguration, KMS, ESO 기술 나열_
  - 문제: 각 기술이 '언제 나왔는가'(버전 역사)는 있지만, 실제로 **tart-infra 클러스터에 이 기술들이 적용되어 있는지, 아니면 미적용인지**를 명시 않음. 학생이 '이 모든 기술을 배워야 하나?'라고 혼동할 수 있음
  - 보강: 'Phase' 설명 직후에 '**tart-infra의 현황**' 문단 삽입:
'이 가이드의 tart-infra 환경에서는 EncryptionConfiguration 및 KMS가 **미적용**되어 있다(확인 명령: Lab 2.2 7단계 참조). 따라서 etcd에 저장된 Secret은 base64 인코딩일 뿐 암호화되지 않은 상태다. 이는 KCSA 시험 범위(Secret 기본 개념)에는 충분하지만, CKS 보안 강화 실습(Lab 5.X에서 다룬다고 가정)에서는 EncryptionConfiguration을 실제 활성화해 볼 것이다.'
- **🟡 MED** `구조` _Lab 3.2~3.3(Default Deny 테스트, L7 정책 테스트) - busybox 생성/테스트/정리 반복 구조_
  - 문제: 거의 동일한 busybox 테스트를 Lab 3.2와 3.3에서 재반복(테스트 Pod 생성 → 통신 시도 → 결과 확인). DRY 위반. 추가로 테스트 명령어 일부(3.2 '11단계 정리')가 단순 요약만 있고, 실제 동작 가능한지 불명확
  - 보강: Lab 3.2·3.3 통합 테스트 섹션으로 재구성:
'**Lab 3.2+3.3 통합: Network Policy 검증 스크립트**' 추가하여, 한 번에 여러 시나리오(default-deny 차단, L7 GET/POST 차단)를 테스트하는 bash 스크립트 제공. 또는 각 Lab 마지막에 '정리 명령 확인(실제 실행 권장)'으로 재작성
- **⚪ LOW** `용어비약` _Lab 3.5(최소권한 Role 생성) - '1단계: 시나리오 정의'(3093줄)에서 'pod-viewer' 역할 소개_
  - 문제: 'Pod 상태만 조회'가 직관적이지만, 'watch verb'의 의미('Pod 변화 감시'인지 '모니터링'인지)를 초심자가 못 알 수 있음
  - 보강: '2단계: Role 생성' 직후, 'Role 내용 확인' 절에서 각 verb 설명:
'- get: 단일 Pod 상세 정보 조회
- list: 모든 Pod 목록 조회
- watch: Pod의 변화(생성/종료/업데이트)를 실시간 감시(kubectl describe, kubectl logs -f 같은 명령 사용 시 필요)'
- **⚪ LOW** `실습재현불가` _Lab 1.1(Tart VM 격리) - 'tart list' 명령 출력(160줄)이 '예상 출력'이지만, 사용자 IP(dev-master-ip)가 플레이스홀더인 채로 실습 불가_
  - 문제: 후속 단계('2단계 ps aux | grep tart')에서 실제 프로세스 정보(PID 12345/12346)가 예시이므로, 독자가 실제로 명령을 실행해도 '이렇게 나와야 한다'는 기준이 불명확
  - 보강: 각 Lab 시작에 '**환경 변수 설정**' 단계 추가(또는 사전준비에 통합):
'이 섹션의 모든 명령에서 `<dev-master-ip>`는 실제 VM IP로 치환하라. 확인:
```bash
tart ip dev-master  # 출력 예: 192.168.64.4
export MASTER_IP=$(tart ip dev-master)
```
이후 모든 명령은 `ssh admin@$MASTER_IP ...` 형식으로 진행.'

### 05-supplement.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `용어비약` _Part 1.1 OPA Gatekeeper (79행), 1.2 Kyverno (225행), 1.3 Falco (349행) 초입_
  - 문제: 각 섹션이 기존 방식의 한계를 서술하지만, KCSA 학생(사전지식 없는 3~4학년)이 OPA, Kyverno, Falco의 정확한 역할 차이를 파악하기 어려움. '기존 방식의 한계'가 충분히 구체적이지 않음. 예: OPA Gatekeeper 도입 전 무엇으로 정책을 구현했는가? (답: 수동 YAML 리뷰 또는 직접 Webhook 개발) 이런 배경이 부재함.
  - 보강: 각 도구 섹션 시작 전에 '이 도구가 없을 때 운영자는 X 방식으로 Y 문제를 해결했다. 그 한계는 Z이다. 따라서 이 도구가 필요했다'는 명확한 배경 스토리 1단락 추가. 예: '기존: 정책 변경 시마다 Webhook 서버 코드 수정 → 배포 → 롤아웃 필요 (1~2주 소요). 이 도구: 정책을 CRD로 선언 → kubectl apply (5분). 이것이 가능한 이유는 [메커니즘].'
- **🔴 HIGH** `실습재현불가` _Part 1 전체 검증 명령어, Part 2 예제 1~10 검증 명령어_
  - 문제: 모든 검증 명령어 블록이 ` ```bash ` + ` ```text ` (예상 출력) 형태이나, CLAUDE.md §4①에서 명시적으로 '명령 출력은 반드시 실제 터미널 스크린샷 이미지를 붙여야 하고 텍스트 블록 금지'라고 정의. 이 파일은 전체 3552줄 중 '실제 스크린샷 이미지가 0개'이며 모든 출력을 텍스트 블록으로 처리. 이는 '실제로 이렇게 나온다'는 증거가 없음을 의미함.
  - 보강: 클러스터(dev 또는 staging)에서 실제로 각 명령을 실행한 후 터미널 스크린샷을 PNG로 캡처하여 k8scert/KCSA/images/ 에 저장. 마크다운에서 ` ```text ` 대신 `![설명](images/파일명.png)` 삽입. 모든 검증 명령어는 실제 출력으로 뒷받침되어야 함. 현재는 '예상 출력'이 지어낸 것일 수 있음.
- **🔴 HIGH** `스토리라인누락` _Part 1.4 Secret 키 로테이션 (529행), 1.5 External Secrets Operator (660행)_
  - 문제: 1.4에서 '키 로테이션이 중요한 이유'를 나열하지만, 실무 사례나 구체적 피해 시나리오 부재. '키가 유출되었으나 탐지 못함 → 피해 범위 무한정'은 추상적. 실제 운영 상황에서 키 로테이션을 언제 트리거하는가? (답: 직원 퇴사, 정기적 주기, 유출 의심) 이런 구체성 부족. 마찬가지로 1.5의 ESO는 '왜 Sealed Secrets와 달리 ESO를 택하는가'의 비교가 표로만 있고 설명 부재.
  - 보강: 1.4: '키 로테이션 시나리오: 운영자 A가 퇴사 → 그간 사용한 키를 무효화해야 함 → 로테이션 없으면 A의 접근 가능성 남음' 같은 구체적 상황 기술. 1.5: 'Sealed Secrets는 단일 클러스터 키에 묶여 멀티클러스터 환경에서 Secret 공유 어려움 → ESO는 Vault 같은 중앙 저장소에서 여러 클러스터가 동일 Secret 읽음' 이런 실무 비교.
- **🔴 HIGH** `맥락점프` _Part 2 예제 1~10 각 섹션 끝 (검증 명령어)_
  - 문제: 검증 명령어가 갑자기 나타남. 예를 들어 예제 2 Kyverno에서 'ClusterPolicy 적용 확인' 명령 이후 '기대 출력: READY=True' 인데, 이것이 무엇을 의미하는지 해석이 없음. 학생이 이 명령을 실행한 후 출력을 보면 이것이 정상인지 알 수 없음.
  - 보강: 각 검증 명령어 블록 하단에 '해석' 절을 추가. 예: '기대 출력 해석: READY=True는 ClusterPolicy가 성공적으로 로드되고 모든 규칙이 유효함을 의미한다. READY=False이면 정책의 CEL 표현식에 문법 오류가 있음을 의미하므로 이벤트를 확인해야 한다.'
- **🟡 MED** `용어비약` _Part 1.1 (119~129줄) Rego 언어 기초_
  - 문제: Rego 코드 예시는 있으나 `violation[{...}]`, `provided := {...}`, `required - provided`(집합 차) 같은 Datalog 개념에 대한 설명 부재. 학생이 Rego를 처음 접할 때 이 문법이 무엇인지 모를 수 있음.
  - 보강: Rego 코드 블록 직전에 '핵심 문법 설명' 절 추가: 'Rego는 선언적 쿼리 언어로, 조건이 모두 참이면 `violation` 규칙이 '발화'(fire)된다. `:=`는 변수 할당, `-`는 집합 차(difference) 연산자이다. 이는 명령형 언어의 `if-then-else`와 다르게 동작한다.'
- **🟡 MED** `이해난이도` _Part 1.2 Kyverno (313행) OPA vs Kyverno 아키텍처 비교 표_
  - 문제: 표의 내용은 정확하나, 문체가 기술적 용어로만 채워져 있음. 예: 'ConstraintTemplate + Constraint 2단계 구조는 정책 라이브러리(Gatekeeper Library)를 조직 전체에서 공유할 수 있도록 설계' — 학생이 '왜 2단계여야 공유가 가능한지' 이해하기 어려움.
  - 보강: 각 비교 항목마다 1줄의 '실무 영향' 부연 추가. 예: 'Rego (전용 언어) → 학습곡선이 높지만 조직이 정책 재사용 라이브러리를 구축하면 매우 강력함. YAML (네이티브) → 즉시 적용 가능하나 복잡한 정책은 표현 어려움.'
- **🟡 MED** `정확성오류` _Part 3 문제 3 (2175~2187줄), 문제 23 (2502~2516줄)_
  - 문제: 문제 3에서 'SLSA v1.0(2023년)에서 레벨 체계가 Level 0~3으로 재구성되어 Level 4는 더 이상 별도 레벨로 존재하지 않는다'고 했는데, 문제 11(2989~3002줄)의 해설에서 'Level 3은 보안 강화된 빌드 플랫폼, Level 4(현재는 Level 3으로 통합됨)'이라고 다시 설명. 일관성 부족. 문제 23에서 `spec.enforcementAction: dryrun`이라 했는데 Gatekeeper 공식 필드명은 `enforcementAction: dryrun`임 (spec은 없음). 검증 필요.
  - 보강: SLSA 정의를 한곳(예: Part 1 초입 또는 Part 3 개요)으로 통일. 필드명은 공식 CRD 문서(gatekeeper.sh) 기준으로 정정. 예: 'spec.enforcementAction (정정: Constraint의 직접 하위 필드이며 spec 중첩 아님).'
- **🟡 MED** `스토리라인누락` _Part 1.3 Falco (349행) 등장 배경_
  - 문제: '컨테이너 런타임 보안의 발전 과정' 섹션이 3단계를 나열하지만, Falco 도입 전 무엇으로 런타임 위협을 대응했는가가 명확하지 않음. 답: 대부분 'OS 레벨 시스템 로그 모니터링(auditd) + 수동 분석' → 느리고 부정확. 이 배경 부재.
  - 보강: '등장 배경' 섹션에 '기존: auditd 로그를 관리자가 수동으로 파싱 → 의미 있는 보안 이벤트를 필터링하기 어려움 + 지연. Falco: 규칙 기반 자동 필터링 + 실시간 경보 → 운영 오버헤드 대폭 감소' 추가.
- **⚪ LOW** `구조` _Part 1 전체_
  - 문제: Part 1의 10개 섹션(OPA, Kyverno, Falco, Secret Rotation, ESO, kubectl auth can-i, Falco 규칙, EncryptionConfiguration, AuditPolicy, RBAC, NetworkPolicy, PSA, seccomp, CiliumNetworkPolicy)이 특정 논리 순서 없이 배열됨. 예: Secret Rotation이 ESO 앞에 오는데, ESO는 로테이션을 자동화하는 도구임. 선후 관계가 역순.
  - 보강: Part 1의 섹션 순서를 '인증/인가 → 정책 검증(OPA/Kyverno) → 런타임 보안(Falco) → Secret 관리(암호화 → 로테이션 → 자동화ESO) → Pod 보안(PSA, seccomp) → 네트워크(NetworkPolicy, CiliumNetworkPolicy)' 같은 라이프사이클 순으로 재정렬.

### daily/day01.md · 가독성 3/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `용어비약` _1.1 등장 배경 - 첫 문단_
  - 문제: '경계 보안(Perimeter Security)' 용어가 그 단락 내에서만 정의되고 다음 줄에서 '심층 방어(Defense in Depth)'로 급전환. 학생이 '왜' 심층방어가 필요한지의 논리적 연결이 약하다. 또한 '내부 침해 시 횡적 이동(Lateral Movement)'은 좌측 괄호 설명만으로 정의 부족—'공격자가 한 시스템에서 다른 시스템으로 수평 이동'이라는 명확한 예시 필요.
  - 보강: 등장 배경 섹션을 2단계로 분할: (1) 전통 경계보안의 구체적 작동원리('방화벽 = 신뢰 경계')와 그 한계를 먼저 상세히 설명 (2) 각 한계(예: '내부 침해 시 횡적 이동이 자유로움')에 대해 '구체적 공격 시나리오'를 추가. 예: '만약 회사 내 한 개발자 노트북이 해킹되면, 방화벽은 이미 내부 트래픽으로 본다. 공격자가 그 노트북을 발판 삼아 같은 네트워크의 데이터베이스·결제 시스템으로 자유롭게 접근 가능하다. 이것이 횡적 이동(Lateral Movement)이다.'
- **🔴 HIGH** `스토리라인누락` _2. 4C 보안 모델 심화 - Cloud/Cluster/Container/Code 계층 전체_
  - 문제: 각 계층의 보안 통제는 '나열식'으로 제시된다. 예: Cloud 계층은 'IAM, 네트워크 보안, 데이터 암호화, 감사 로그, 물리보안, 컴플라이언스'만 표로 나열. 학생 입장에서 '왜 이 6가지 항목이 각각 필요한가'의 스토리가 없다. 또한 4개 계층 간 '계층적 신뢰 관계'(Cloud가 침해되면 하위가 모두 무력화)는 1.1.1에서만 언급되고, 각 심화 설명에서 재확인되지 않는다.
  - 보강: 각 계층 상세 섹션(2.1 내 각 계층)에 다음 구조 추가: (1) '이 계층이 왜 필요한가'—그 계층 위의 계층만으로는 충분하지 않은 이유 (2) '이 계층이 침해되면'—피해 범위 (3) '구체적 사례 시나리오'. 예: 'Cloud 계층: IAM 설정 오류로 인증 없이 API에 접근 가능 → 공격자가 모든 K8s 객체를 읽음. 이를 Cluster 계층의 RBAC가 해결하지 못하는 이유? RBAC는 이미 인증된 사용자 내에서만 작동하기 때문. Cloud 인증 자체가 뚫렸으면 RBAC도 무용지물.'
- **🔴 HIGH** `이해난이도` _2.2 예제 1-5 전체_
  - 문제: YAML 예제들이 높은 수준의 선행지식을 가정한다. 예제 1(NetworkPolicy)는 'podSelector: {}' 의 '공집합이 모든 Pod을 의미'한다는 설명만 있고, 그 이상으로 'Ingress vs Egress' 방향성·정책 규칙 매칭 로직(from/to)을 구체적으로 설명하지 않는다. 예제 2(SecurityContext)의 'fsGroup: 2000'은 설명이 없고, 'seccompProfile: RuntimeDefault'는 '커널 수준 격리'만 언급되고 '실제 어떤 시스템 콜을 차단하는가'는 명확하지 않다. 학생이 이 YAML을 손으로 수정하거나 문제를 풀 때 각 필드의 의미를 모를 수 있다.
  - 보강: 각 예제 YAML 아래에 '필드 해석 표'를 추가. 예제 1 NetworkPolicy 뒤에: '(표) policyTypes/podSelector/from/ports의 의미 및 매칭 로직'. 예제 2 SecurityContext 뒤에: '(표) runAsUser vs runAsGroup vs fsGroup의 차이·seccompProfile 타입별(RuntimeDefault/Localhost/Unconfined) 효과'. 특히 fsGroup은 'Pod 내 컨테이너들이 공유 볼륨을 접근할 때 파일 시스템 권한을 설정하는 필드'라는 목적을 명시해야 한다.
- **🔴 HIGH** `정확성오류` _2.2 예제 2 - SecurityContext 섹션_
  - 문제: 주석에 'UID 0 프로세스는 커널 수준 권한을 가지므로' 표현이 부정확하다. UID 0은 '권한'을 가지는 게 아니라 '권한 검사를 우회'한다. 또한 'CAP_NET_RAW, CAP_SYS_ADMIN 등 커널 권한'이라는 표현도 모호—capability는 '권한'이 아니라 '커널 기능에 대한 접근'이다.
  - 보강: UID 0 설명을 수정: 'UID 0(root)로 실행되는 프로세스는 capability 검사를 받지 않으므로, 제약 없이 모든 커널 기능(파일 시스템·네트워크·프로세스)에 접근할 수 있다. 따라서 권한 상승 공격의 최종 목표다.' capabilities 설명: 'Linux capability는 권한이 아니라 특정 커널 기능(예: CAP_NET_RAW는 raw socket 생성, CAP_SYS_ADMIN은 시스템 관리 작업)에 대한 접근 제어 토큰이다.'
- **🟡 MED** `스토리라인누락` _3.2 주요 공격 표면 상세 - etcd 섹션_
  - 문제: 'etcd = 클러스터의 두뇌'라는 비유는 있지만, '왜' etcd 2379 포트가 외부에 노출되면 위험한지의 '기술적 메커니즘'이 약하다. 'etcd에 Secret이 저장된다'는 것은 나열되지만, '그 Secret이 평문으로 저장되는가? 누가 접근하는가? 암호화는 어떻게 설정하는가?'의 연결이 끊어져 있다.
  - 보강: etcd 공격 시나리오를 확장: 'etcd 2379는 K8s API Server만 접근해야 한다. 만약 외부에서 etcd에 TLS 없이 접근하면: (1) 전체 Secret을 평문으로 다운로드 가능 (2) 잘못된 데이터 삽입으로 Pod 설정 변조 가능 (3) RBAC 정책을 평문으로 읽어 권한 구조 파악 가능.' 그 다음 '방어: etcd를 별도 보안 네트워크에 격리 + TLS 클라이언트 인증서 + Encryption at Rest(예제 5 참조)로 저장 데이터도 암호화.'
- **🟡 MED** `맥락점프` _3.2 - 컨테이너 이미지(공급망) 섹션_
  - 문제: '공급망 공격'은 고급 개념인데, 배경 설명이 부족하다. '공격자가 인기 있는 베이스 이미지에 백도어 삽입'이라는 예시는 추상적—실제 'docker pull'할 때 어떤 과정에서 백도어가 들어오는가? 또한 '미서명/미스캔 이미지 차단'은 '누가 스캔하고 누가 서명하는가'의 책임이 명확하지 않다.
  - 보강: 공급망 공격 설명을 확장: '개발자가 docker pull alpine:latest를 실행하면, 레지스트리의 latest 태그가 어느 이미지를 가리키는지 검증하지 않는다. 공격자가 레지스트리 계정을 탈취하거나 레지스트리 자체를 공격해 latest 태그를 악성 이미지로 재지정할 수 있다. 또는 인기 있는 base image repo를 포크해서 거의 같은 이름(예: alpne → 오타)의 악성 이미지를 업로드하고, 개발자가 실수로 그것을 pull하게 할 수 있다.' 그림 7 아래에 '스캔·서명·검증의 책임: 개발 팀이 빌드 시 Trivy·Cosign 실행 → 레지스트리 푸시 → 배포 시 Admission Webhook이 서명 검증 및 스캔 정책 확인 → 배포 거부/허용.'
- **🟡 MED** `용어비약` _4. STRIDE 심화 - 각 섹션 전체_
  - 문제: STRIDE 각 항목의 K8s 예시는 나열되지만, '어떻게 공격하는가'의 기술적 흐름이 약하다. 예: Spoofing 섹션의 '탈취한 ServiceAccount 토큰으로 API Server에 접근'은 '누가 그 토큰을 탈취하는가? 어디서 저장되어 있는가? 어떤 상황에서 노출되는가?'에 대한 설명이 없다. Elevation of Privilege의 '컨테이너에서 Docker 소켓 접근하여 새 컨테이너 생성'은 '/var/run/docker.sock'를 언급하지 않는다.
  - 보강: 각 위협 항목에 'Attack Chain' 구조 추가: (1) 전제 조건(어떤 설정 오류) (2) 공격 단계 (3) 그 결과. 예: Spoofing - 'SA 토큰 탈취 공격: (조건) Pod가 secret volume으로 /var/run/secrets/kubernetes.io/serviceaccount/token를 마운트받음 (단계) 공격자가 컨테이너에 침입해 해당 파일 읽음 (결과) 이 토큰으로 API Server에 인증되어 RBAC 권한대로 작업 수행 가능. (방어) automountServiceAccountToken: false로 필요 없는 Pod은 토큰 마운트 자체를 차단.'
- **🟡 MED** `이해난이도` _5. CNCF Security TAG - 5.1 역할 설명_
  - 문제: 'TAG (Technical Advisory Group)'는 처음 등장하는 용어인데 'CNCF 산하 부서의 일종'이라는 느낌만 전달된다. CNCF·CNCF Security TAG·CNCF 개별 프로젝트 간의 관계가 명확하지 않다. 또한 '졸업(Graduated) 프로젝트 vs 인큐베이팅' 상태 차이도 정의 없이 표에만 나열되어 있다.
  - 보강: 5.1 시작에 '계층 관계도' 추가 후 정의: 'CNCF는 오픈소스 클라우드 기술 재단. 산하에 여러 TAG(기술 어드바이스 그룹) 존재—Kubernetes, Container Runtime, Storage, Platform Engineering, Security 등. Security TAG는 클라우드 네이티브 보안 표준·모범 사례·프로젝트 평가를 담당.' 또한 프로젝트 상태: '(표) Graduated = 프로덕션 완성도 높음 + 보안 감사 통과 vs Incubating = 활발히 개발 중이지만 아직 성숙도 낮음.'
- **🟡 MED** `맥락점프` _6. Zero Trust - 6.1 및 6.2 섹션_
  - 문제: Zero Trust의 핵심 원칙 'Never trust, always verify'는 좋은 스로건이지만, '구체적으로 K8s에서 뭘 검증하는가'가 불명확하다. 6.2 표에서 '신원확인 = X.509/OIDC/SA Token'으로 나열되지만, 각각이 '어떻게' 신원을 확인하는지 설명이 없다. 또한 '지속적 검증 = Audit Log, Falco'라고 했는데, Audit Log(API 요청 기록)와 Falco(런타임 이상 탐지)는 전혀 다른 기술인데 같은 카테고리로 묶인다.
  - 보강: 6.2 표를 2단계로 전개: (1) '5가지 원칙' 행 (2) 각 원칙 아래 'K8s 구현 방법'·'검증 메커니즘'·'예시' 추가. 예: '신원확인: X.509(kubelet·API Server 간 상호인증) vs OIDC(외부 ID 제공자 통합) vs SA Token(Pod 아이덴티티). 각각이 무엇을 검증하는가? X.509는 인증서 CN/SAN 필드 → 신원 검증. OIDC는 JWT 토큰의 서명·만료·클레임 → 사용자 신원. SA Token은 토큰 서명 → Pod 신원.' 지속적 검증은 분리: '(Audit Log) API 요청 기록으로 사후 감사 추적 vs (Falco) 런타임 시스템콜 모니터링으로 비정상 행위 실시간 탐지.'
- **🟡 MED** `구조` _7. DevSecOps와 Shift Left - 그림 9·10 및 7.2·7.3_
  - 문제: Shift Left의 개념 자체는 좋지만, '이 저장소의 tart 클러스터'에서 '실제로 어떻게 구현하는가'의 연결이 없다. 7.3 '주요 도구 비교'는 Trivy·Cosign·Snyk 등 많은 도구를 나열하지만, day01이 '클라우드 네이티브 보안 개요'라면 이런 상세는 너무 이르다. 또한 실습 섹션에서는 Shift Left를 실제로 구현하지 않는다.
  - 보강: 7.1·7.2는 그대로 두고, 7.3 '주요 도구'를 대폭 축약: '이 day01에서는 DevSecOps의 개념만 다룬다. 실제 도구(Trivy·Cosign 등)는 후속 CKS day(공급망 보안)에서 실습한다.' 대신 9. 복습 체크리스트 뒤에 '추가학습: 공급망 보안 심화(다음 day에 예정)'라는 포인터 추가.
- **🟡 MED** `실습재현불가` _9. 트러블슈팅 및 실습 1-3 전체_
  - 문제: 'dev 실측' 섹션의 예상 출력이 구체적 명령 없이 '예상'만 나열되어 있다. 예: 'dev 실측(ns=cap-kcsa-day01, 캡처 후 삭제)'라고 했는데, 학생이 '어느 명령을 실행해서 이 출력을 얻는가?'를 알 수 없다. 또한 NetworkPolicy 확인 명령 'kubectl get ciliumnetworkpolicies -n demo --no-headers | wc -l'는 'cilium'(CNI 종류)을 가정하는데, 이게 tart dev 클러스터의 기본값인지 명확하지 않다. 학생이 다른 환경에서 실습하려면 실패할 가능성이 높다.
  - 보강: 실습 섹션을 두 부분으로 분리: (1) '이론적 검증 명령'—CLAUDE.md의 규칙대로 ``bash 블록에 명령 명시 후 '예상 출력(스크린샷)'. (2) '실제 환경 의존성 명시'—'이 실습은 tart dev 클러스터(Cilium CNI)를 가정. 다른 CNI(Flannel 등)를 쓰면 ciliumnetworkpolicy 대신 networkpolicy 조회.' 또한 'cap-kcsa-day01' 네임스페이스는 실습용으로 생성해야 하는데, 그 생성 스크립트 링크 필요.
- **🟡 MED** `용어비약` _2.2 예제 5 - Encryption at Rest_
  - 문제: 'aescbc', 'identity {}', 'kms v2', 'secretbox' 같은 프로바이더 이름이 나열되지만, 각각이 무엇인지 비교되지 않는다. 학생이 'aescbc vs kms v2 어떤 걸 써야 하나?'라고 물으면 답변할 수 없다. 또한 'XSalsa20 + Poly1305'은 암호화 학부 수준의 지식을 가정한다.
  - 보강: 프로바이더 비교 표 추가 후 예제 5 아래: '(표) 암호화 프로바이더 비교: aescbc(로컬 키, 관리 간단, 키 로테이션 수동) vs kms v2(외부 KMS 연동, 키 관리 자동, 감사 추적) vs secretbox(대안, 내구성·암호화 조합). 프로덕션 권장: kms v2 (키 관리의 외부화).' 또한 XSalsa20은 설명 없이 삭제하고, 실제 필요한 지점에서만 암호화 방식을 명시.
- **⚪ LOW** `용어비약` _2.1 - Pod 레벨 vs Container 레벨 securityContext_
  - 문제: 예제 2에서 'Pod 레벨 보안 설정 (모든 컨테이너에 적용)'이라고만 했는데, 'Pod 레벨과 Container 레벨이 충돌하면 어떻게 되는가?'는 설명이 없다. 학생이 runAsUser를 Pod에서 1000, Container에서 2000으로 설정했을 때 뭐가 우선되는지 모른다.
  - 보강: 예제 2 주석에 추가: 'Pod 레벨의 securityContext는 모든 컨테이너에 기본값으로 적용된다. Container 레벨에서 재지정하면 그것이 우선된다. 예: Pod에서 runAsUser: 1000이지만 Container에서 runAsUser: 2000이면, 그 Container는 UID 2000으로 실행된다. 다른 Container는 여전히 1000.'
- **⚪ LOW** `이해난이도` _1.1.1 - Defense in Depth 설명_
  - 문제: '단일 장애점(Single Point of Failure)을 제거하는 보안 아키텍처'라는 표현은 맞지만, 학생 입장에서 '각 계층이 독립적'이라는 게 실무 상황에서 어떤 의미인지 모를 수 있다. '하나가 뚫려도 나머지가 보호'는 좋은 설명이지만 구체적 예시가 없다.
  - 보강: 다이어그램 아래 추가 예시: '예: API Server 인증이 우회되어 system:unauthenticated 사용자가 Secret을 읽으려 해도, (1) RBAC에서 system:unauthenticated에는 Secret:get 권한이 없으므로 403 거부. (2) etcd는 TLS 클라이언트 인증서 필수이므로 직접 접근 불가. (3) etcd 데이터도 암호화(Encryption at Rest)되어 있으므로 평문 탈취 불가. 따라서 4C 계층이 각기 방어하여 단일 침해로 전체가 뚫리지 않는다.'

### daily/day02.md · 가독성 4/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `용어비약` _1.3 Keyless 서명 단락 (line 101~105)_
  - 문제: OIDC, Fulcio, Rekor의 역할이 1줄씩만 설명되고 학생이 OIDC(OpenID Connect 인증 프로토콜)의 사전지식 없이는 이해 불가. 'OIDC 계정으로 서명'이라는 표현이 기술 정확하지만 개념 설명 부족.
  - 보강: OIDC 첫 등장 시 "클라우드 제공자(Google/GitHub)의 인증 토큰을 이용해 빌드 환경이 자신의 신원을 증명하는 방식"으로 1문장 풀이 추가. Fulcio는 "OIDC 토큰을 받아 유효 시간이 짧은 인증서(수분)로 변환하는 CA 역할"로 상세화. Rekor는 "모든 서명 기록을 공개 원장에 기록해 나중에 '이 이미지는 2026-06-12 10시에 서명됨'을 누구나 검증 가능하게 함"으로 실용성 강조.
- **🔴 HIGH** `스토리라인누락` _1.4 SLSA Level 정의 (line 114~131)_
  - 문제: L0~L4를 나열만 하고, 각 Level이 왜 필요한지(직전 Level의 한계), 실제 공격 시나리오를 막는지의 이야기가 없음. 예: L2(서명된 Provenance)가 있어도 '빌드 환경 자체가 침해되면?'의 질문으로 L3(격리)가 등장하는 스토리 부족. Hermetic Build도 정의만 있고 '격리되지 않으면 어떤 공격에 노출되는가'의 구체 예 없음.
  - 보강: "L1→L2: 문서화된 빌드도 환경이 침해되면 서명이 무의미하다" 추가. "L2→L3: Hermetic Build는 빌드 중 네트워크 접근·기존 빌드 캐시·호스트 환경 변수 접근을 모두 차단해, 공격자가 빌드 프로세스에 개입할 수 없게 한다"로 구체화. "L3→L4: 격리된 환경도 의존성 패키지가 침해되면 막을 수 없다"로 재귀적 검증(L4)의 필요성 설명.
- **🔴 HIGH** `맥락점프` _1.1 & 1.5 '방어 체계' 단락 (line 51~62)_
  - 문제: 플로우차트에서 Trivy(스캔)과 Kyverno(검증/배포)를 도구로 제시하지만, Falco(런타임 모니터링)는 언급하지 않음. 1.5 끝('이미지 스캐너=정적, Falco=동적')에서 갑자기 Falco가 등장해 학생이 '이게 뭐지?' 상태. Day 1 내용이 없으므로 독립 학습 불가.
  - 보강: 1.1 플로우차트 재설계: "[배포 전] SBOM→스캔(Trivy)→서명(Cosign)→정책검증(Kyverno) [배포 후] Falco로 런타임 이상행동 감지"로 생명주기 전체 표시. 또는 각 도구 섹션(1.2~1.5) 마지막에 '다음 단계는?'으로 흐름 연결.
- **🔴 HIGH** `실습재현불가` _1.2~1.3 SBOM/Cosign 예제 (line 78~106)_
  - 문제: "syft myapp:v1.0 -o spdx-json > sbom.json" 명령이 있지만, myapp:v1.0 이미지는 어디서 나오는지 명시 없음. 학생이 실제로 실행하려면 '먼저 Docker 이미지를 빌드해야 하는가?'라는 질문에 답해야 하는데, 사전 준비 단계 설명 전무.
  - 보강: "실습 준비: https://hub.docker.com/_/alpine 같은 공개 이미지를 사용하거나, 로컬에서 간단한 Dockerfile로 이미지를 빌드한다"는 선수조건 명시. 또는 §7 tart-infra 실습에서 "dev 클러스터에 이미 배포된 nginx:1.25 등의 이미지를 분석한다"로 실제 환경 매핑.
- **🔴 HIGH** `이해난이도` _§7 'tart-infra 실습' 시작 (line 604~608)_
  - 문제: "export KUBECONFIG=~/sideproejct/..." 경로가 절대경로가 아니고 사용자 홈 기반 상대경로. 컴퓨터공학 학부생이 처음 실행할 때 '경로가 없다' 오류 자주 발생. 또한 클러스터가 실제로 가동 중인지 미리 확인하는 명령 없음.
  - 보강: "사전 확인: ./scripts/boot.sh && ./scripts/fix-cluster-ip-drift.sh dev로 dev 클러스터를 가동한다. 성공 시 kubectl --kubeconfig kubeconfig/dev.yaml get nodes에서 모두 Ready 상태여야 한다"를 첫 줄에 추가. KUBECONFIG 경로는 절대경로($(pwd)/kubeconfig/dev.yaml) 또는 ~/의 의미 명확화.
- **🟡 MED** `정확성오류` _§7 '트러블슈팅' 섹션 (line 728~745)_
  - 문제: "장애 시나리오 2"에서 "distroless 이미지로 전환하여 불필요한 패키지를 제거한다"고 했지만, distroless는 패키지 제거가 아니라 기초 OS(libc 등)를 배제한 미니멀 이미지. 표현이 기술적으로 정확하지 않음.
  - 보강: "distroless 이미지(예: gcr.io/distroless/base)로 전환하면 기초 OS 라이브러리와 불필요한 유틸을 제거해 공격 표면을 줄이고, CVE 수도 감소한다"로 기술 정확성 강화.
- **🟡 MED** `스토리라인누락` _1.2 SBOM 형식 비교 (line 70~76)_
  - 문제: SPDX와 CycloneDX의 역사적 배경(왜 두 가지가 나왔나), 용도 차이(누가 뭘 선호하는가)의 스토리 부족. 표로만 제시되어 '선택 기준'이 명확하지 않음.
  - 보강: "SPDX는 Linux Foundation의 표준(ISO 26740)로 소프트웨어 라이선스 추적을 강점으로 하고, CycloneDX는 OWASP에서 보안 취약점(CVE) 정보를 SBOM에 포함 가능하도록 설계했다. 자동차 소프트웨어는 SPDX, 개발팀의 빠른 CVE 대응이 중요하면 CycloneDX를 선택하는 추세"로 실용성 추가.
- **🟡 MED** `용어비약` _1.3 Cosign 예제 주석 (line 94)_
  - 문제: "서명이 OCI 레지스트리에 별도 아티팩트로 저장됨"이라는 표현이 기술적으로 정확하지만, 'OCI 아티팩트(Artifact)'와 '이미지(Image)의 차이'를 설명하지 않음. 학생이 "서명도 이미지처럼 레지스트리에 저장되는 건가?"라고 헷갈릴 수 있음.
  - 보강: "Cosign의 서명은 이미지 본체가 아니라 OCI 레지스트리의 참조 아티팩트(Reference Artifact)로 저장되어, 이미지와 별도의 객체지만 같은 레지스트리에 있으므로 함께 관리·전송 가능하다"로 구조 명확화.
- **🟡 MED** `맥락점프` _§2 패턴 7 (line 192~197)_
  - 문제: "공유 책임 모델"이 갑자기 등장하는데, 이게 무엇인지(정의), 4C 모델과의 관계가 명시되지 않음. Day 1 가정 범위 이상으로 넘어감.
  - 보강: 공유 책임 모델의 정의 1줄 추가: "클라우드 제공자(AWS/GCP 등)가 인프라 보안을 책임지고, 사용자(테넌트)가 애플리케이션·설정 보안을 책임지는 모델. 4C의 Cloud 계층은 제공자, Cluster~Code는 사용자 책임"으로 명확화.
- **🟡 MED** `구조` _파일 전체 구성 (섹션 1~7)_
  - 문제: KCSA Day 2의 목표('공급망 보안 이해·시험 패턴·연습')에는 맞지만, Day 1 없이 독립 학습이 어려움. 문제 1~17 중 1,2,4,11,12는 명시적으로 Day 1 내용(STRIDE, 4C)을 요구하는데, 이 파일만으로 풀이 불가능한 함정 있음.
  - 보강: 파일 시작에 "Day 1 필수 전제: STRIDE 위협 모델(6가지 위협), 4C 보안 계층, Zero Trust"의 요약 박스(1.5줄) 추가해 학생이 Day 1을 다시 확인하도록 유도. 또는 각 문제에 '[Day 1 참조]' 태그 부착.
- **⚪ LOW** `용어비약` _1.5 테이블, Clair 소개 (line 152)_
  - 문제: "CoreOS/Red Hat. 정적 분석, 레이어 기반 분석"만 있고, 'Clair가 Trivy와 다른 점'이 명시되지 않음. 학생이 '아, Clair와 Trivy는 뭐가 다르지?'라고 궁금할 수 있음.
  - 보강: "Clair는 Docker/OCI 레지스트리와 통합되어 이미지 저장 시점에 스캔하는 registry-내장 도구(Pull 시 자동 스캔), Trivy는 독립형 CLI로 로컬/CI에서 주문형 스캔"으로 용도 차이 명시.
- **⚪ LOW** `이해난이도` _2.1 패턴 1 예시 (line 172~174)_
  - 문제: "감사 로그 없이 Secret 삭제를 부인하는 것은 Repudiation"이라는 예가 구체적이지만, 'Repudiation의 정의'가 없어서 예만 봐서는 의미가 불명확할 수 있음.
  - 보강: "Repudiation(부인): 사용자가 어떤 행동을 했는데 '내가 한 게 아니다'라고 부인하는 것. 감사 로그 없으면 누가 Secret을 삭제했는지 증명할 수 없으므로 부인 가능"으로 정의-예시 순서 재배치.

### daily/day03.md · 가독성 3/5 · 스토리 4/5 · 미달❌

- **🔴 HIGH** `용어비약` _1.2 표, '인증 방법 비교표' — OIDC/ServiceAccount/Bearer Token/Webhook 등 6가지 등장_
  - 문제: 각 인증 방법이 '무엇인가'를 한 문장도 없이 바로 표 제시. OAuth 2.0, ID Token, JWT, Bound Token 같은 용어가 학부 기초가 없는 학생에겐 완전 생소함. '토큰'이라는 단어도 실제 파일 형식·인코딩을 보여주지 않음.
  - 보강: 표 직전에 '인증의 핵심: 요청자가 누구인지 증명하는 것. K8s가 지원하는 방법들:' 으로 시작. 각 방법 옆에 괄호로 1줄 정의 추가. 예: 'OIDC(OAuth 2.0을 확장해 사용자 신원을 JWT로 증명)', 'ServiceAccount Token(클러스터 내 서비스용 자동 발급 토큰)', 'Bearer Token(HTTP Authorization 헤더에 담는 문자열)'. §1.0의 '정적 토큰은 파일에 평문으로 저장'이라는 구체성을 이 표에서도 반복.
- **🔴 HIGH** `실습재현불가` _전체 문서 — 모든 실습 명령 실행 결과_
  - 문제: §6 tart-infra 실습 1~4의 명령어(예: 'kubectl get pod kube-apiserver-dev-master -n kube-system -o yaml | grep ...')는 코드블록만 있고, 실제 터미널 출력 스크린샷이 하나도 없음. CLAUDE.md §4①에서 '명령 출력은 실제 터미널 스크린샷 이미지로' 규약인데 위반됨. 학생은 명령을 실행해도 '이게 맞는 출력인가' 검증 불가능.
  - 보강: 각 실습(1~4)마다: (a) 명령 코드블록(```bash), (b) 실제 실행한 터미널 스크린샷(PNG), (c) 출력 해석 3단계로 재구성. 예: '실습 1' → kubectl get pod ... 명령 → [스크린샷이미지] → '위 출력에서 주목할 점: --authorization-mode=Node,RBAC이 명시되어 있음 = 인가 2단계를 모두 활성화'. CLAUDE.md 규약 준수를 위해 현재 코드블록 출력 블록(```text)을 전부 실제 캡처로 교체 필수.
- **🔴 HIGH** `이해난이도` _2.2 etcd 보안, 2.3 Encryption at Rest — 프로바이더 설정_
  - 문제: 'secretbox'/'aescbc'/'aesgcm'/'kms' 같은 암호화 알고리즘이 '왜 다른가', '각각 언제 쓰는가'를 설명하지 않음. 학생은 '권장(로컬)·보통·가장 권장' 같은 상대적 표현만 보고 원리를 모름. 특히 'kms v2가 DEK 캐싱으로 성능 향상'은 KMS·DEK 개념을 먼저 설명하지 않고 단정.
  - 보강: 2.3 직전에 '암호화 방식 선택: 트레이드오프' 섹션 신설. (a) secretbox = XSalsa20-Poly1305로 로컬에서 빠르지만 키 로테이션이 수동; (b) aescbc = 표준이지만 패딩 공격 취약; (c) aesgcm = 더 안전하지만 nonce 재사용 주의; (d) kms v2 = 외부 키 저장소(AWS KMS 등)를 쓰므로 프로덕션에서 안전하고 키를 분리 관리 가능, 단 네트워크 레이턴시 추가. 표 다음에 '선택 가이드: 개발(secretbox) → 프로덕션(kms v2 권장)'.
- **🔴 HIGH** `맥락점프` _1.2 인증서 인증 흐름 직후, line 85-87 예시_
  - 문제: 'CN=admin, O=system:masters → system:masters 그룹은 모든 RBAC를 우회한다 (매우 위험).' — system:masters가 갑자기 등장. 학생은 '왜 system: 프리픽스인가', '왜 이 그룹이 우회하는가', RBAC와의 관계가 뭔지 모름. line 87의 괄호 한 줄 설명만으로는 부족.
  - 보강: 예시 직전에 '주의: 인증서의 O(Organization) 필드가 Kubernetes 그룹이 되는데, 특히 system:masters 그룹은 모든 RBAC 정책을 무시하는 특수 그룹이다. (자세히: §3-RBAC에서 설명 또는 링크)' 추가. 또는 footnote로 '이는 CKA Day X의 RBAC 절에서 다시 만난다'고 forward-link.
- **🔴 HIGH** `용어비약` _1.3 인가 처리 흐름, flowchart의 'Node 인가 모듈' 노드_
  - 문제: '이 요청이 kubelet에서 온 것인가?'를 판별하는 메커니즘이 설명 없음. 학생은 '어떻게 kubelet 요청을 식별하는가', kubelet이 자신의 노드/Pod에 대해서만 접근 가능하도록 하는 원리를 모름. 그냥 'Node인가 모듈이 있다'만 알게 됨.
  - 보강: flowchart 아래에 'Node 인가 모듈이란: kubelet은 API Server에서 발급한 특수 인증서(예: system:node:worker1)로 인증되는데, 이 인증서의 CN을 읽어서 kubelet이 자신의 노드에 스케줄된 Pod만 조작 가능하도록 제한하는 모듈이다. 예: worker1 노드의 kubelet은 worker1에 스케줄된 Pod만 삭제 가능하고, 다른 노드의 Pod는 접근 불가.' 추가.
- **🟡 MED** `용어비약` _1.4 Admission Control, line 182-184 '요청 수정 단계'의 항목들_
  - 문제: 'Istio 사이드카 자동 주입', 'LimitRanger', 'PodSecurity', 'OPA/Kyverno' — 이들이 각각 '뭘 하는 건지' 함수 수준의 설명이 없음. 학생은 표 1.4가 뭔지 이해하지 못함. 예: 'LimitRanger'는 '기본 리소스 제한 추가'라는 함수만 있지, 리소스 요청(request)/제한(limit)이 뭔지 모르면 읽을 수 없음.
  - 보강: 1.4 직전에 '주의: Admission Webhook은 매우 다양하므로, 이 문서는 CKS 시험에 자주 나오는 것들만 소개한다. 각 Controller는 인증/인가를 통과한 요청을 (a) 수정(Mutating, Pod에 필드 추가/변경) 또는 (b) 검증(Validating, 정책에 맞는지 확인)한다.' 추가. 그리고 표 이전에 '예: Istio 사이드카 자동 주입이란, 사용자가 'kubectl apply -f pod.yaml'을 하면 Mutating Webhook이 Pod 스펙을 가로채서 자동으로 Istio sidecar 컨테이너를 추가하는 것.'같은 구체 예시 1~2개.
- **🟡 MED** `이해난이도` _3.2 kubelet 설정, line 376-399 config.yaml 구조_
  - 문제: 'serverTLSBootstrap: true'가 갑자기 등장. 이것이 뭘 하는 건지(kubelet이 시작할 때 CA에 인증서 발급 요청), 왜 보안상 중요한지(kubelet이 CA와 관계 맺는 부트스트랩 단계) 설명 없음. 또한 'rotateCertificates: true'와 'serverTLSBootstrap'의 관계도 불명확.
  - 보강: '=== 인증서 로테이션 ===' 섹션에 '이 두 플래그는 함께: (1) serverTLSBootstrap=true로 kubelet이 시작할 때 API Server를 통해 자신의 서버 인증서를 자동 발급받고, (2) rotateCertificates=true로 인증서 만료 전에 자동 갱신하도록 한다. 결과: 관리자가 매번 노드별 인증서를 수동 재발급할 필요 없음(보안·운영 이득).' 추가.
- **🟡 MED** `이해난이도` _4.2 Control Plane TLS 통신 전체 지도, 문자열 리스트 (§10.2)_
  - 문제: 인증서 리스트(apiserver-kubelet-client.crt 등)가 단순 파일명만 나열됨. 학생은 '왜 apiserver-kubelet-client와 apiserver-etcd-client가 따로 있나', 서버인증서(apiserver.crt)와 클라이언트 인증서(apiserver-kubelet-client.crt)의 차이가 뭔지 모름.
  - 보강: 인증서 리스트 아래에 '해석: (a) apiserver.crt는 API Server가 TLS 서버로 클라이언트(kubectl·kubelet·controller-manager)에게 제시하는 서버 인증서. (b) apiserver-kubelet-client.crt는 API Server가 kubelet의 port 10250에 접근할 때 '나는 API Server다' 증명하는 클라이언트 인증서. (c) 마찬가지로 apiserver-etcd-client.crt는 API Server→etcd 접근용. 각 통신 경로마다 상호 인증(mTLS)을 하려면 클라이언트 인증서가 따로 필요하다.' 추가.
- **🟡 MED** `구조` _§6 tart-infra 실습, 실습 1~4의 검증(동작 원리) 섹션_
  - 문제: '**동작 원리:**' 아래의 4줄 글(574)이 실습 1 '3단계 파이프라인'을 재설명하는데, 문서 1.1~1.4를 이미 읽은 학생 입장에서는 반복 느낌. 더 중요한 것은, 실습 2~4의 '동작 원리'가 너무 짧아서(585~587, 601~605) 학생이 명령과 출력의 관계를 연결 어려움.
  - 보강: 각 실습의 '동작 원리'를 '명령 해석 → 기대 출력 → 왜 이 값이 나왔나(기술 원리)'의 3단계로 확장. 예: 실습 2 '동작 원리' → 'etcdctl ... get /registry/secrets/...' 이 명령은 '암호화된 Secret을 etcd에서 직접 읽는 것인데, 출력이 k8s:enc:secretbox:v1:... 형태면 Encryption at Rest가 활성화된 것, 평문 형태면 암호화 없음.' 이런 식으로 출력과 상태를 직결.
- **🟡 MED** `용어비약` _2.1 etcd 저장 경로, line 245-249_
  - 문제: '/registry/secrets/default/my-secret' 같은 경로 구조가 설명 없음. '왜 이런 경로인가', '/registry/ 프리픽스' 의미, 'default' (네임스페이스) 와의 관계가 불명확. 학생은 이것이 단순 디렉토리 구조인지, etcd의 key-value 구조인지 모름.
  - 보강: 리스트 위에 'etcd에 저장되는 Kubernetes 객체의 경로 규칙: /registry/{리소스타입}/{네임스페이스(NS인 경우)}/{객체이름}. 예: 네임스페이스 default의 Secret my-secret은 /registry/secrets/default/my-secret이라는 key로 JSON 형태의 value를 저장한다. (참고: etcd는 평면 key-value 스토어이므로 / 경로는 단순 문자열 프리픽스일 뿐이다.)' 추가.
- **⚪ LOW** `정확성오류` _1.4 내장 Admission Controller 표, line 196 'ServiceAccount'_
  - 문제: 'ServiceAccount: Mutating — Pod에 SA 자동 할당, 토큰 마운트' — 이것이 '내장 Admission Controller'인지 '기본 동작'인지 모호함. Kubernetes 문서에서 serviceaccount controller는 실제로 Admission Webhook이 아니라 controller-manager의 일부임.
  - 보강: 표 헤더에 '주요 내장 Admission Controller(kubeadm 기본 활성화된 것 중 CKS 시험에 자주 나오는 것들)' 명시. ServiceAccount를 별도 각주로 '참고: ServiceAccount를 Pod에 자동 마운트하는 것은 ServiceAccount Admission Controller(내장)가 담당하며, 이는 Webhook이 아니라 API Server 내부 로직이다. 다만 표에 포함시킨 이유는 Pod 생성 흐름에서 Admission 단계처럼 작동하기 때문이다.' 추가.

### daily/day04.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `용어비약` _섹션 1.1, 2, 3 전반_
  - 문제: Admission Control, Mutating/Validating Admission, PSA(Pod Security Admission), NodeRestriction, LimitRanger 등이 정의 없이 사용됨. Day 4 독자가 이 용어들을 알아야 문단을 이해할 수 있는데 첫 등장 풀이가 없음. 특히 Problem 8의 정답은 'PSA 정책이 적용되지 않는다'는데 PSA가 뭔지 학생은 Day 4에서 배우지 않음(Day 5 예고).
  - 보강: 1. 섹션 2 앞에 '보안 이해의 전제 개념' 단락 추가: 'Admission Control은 API Server가 객체를 etcd에 저장하기 전 마지막 검증 단계. Mutating AC는 요청을 수정(예: default 값 주입), Validating AC는 정책 확인(예: Pod 권한 레벨)한다. PSA는 Pod 보안 정책 중 하나로 제한 수준(Privileged/Baseline/Restricted)을 정한다.' 2. Problem 8 해설을 2~3문장으로 확장: 'Static Pod는 kubelet이 /etc/kubernetes/manifests/ 파일을 직접 읽어 생성하므로 API Server의 Admission Control(PSA 정책, ResourceQuota 검증 등)을 거치지 않는다. 따라서 manifest 파일이 권한이 높은 Pod를 정의해도 아무 검증 없이 실행된다.'
- **🔴 HIGH** `실습재현불가` _섹션 tart-infra 실습 (라인 664~742)_
  - 문제: 1. 실습 명령들(예: 'kubectl get pod kube-apiserver-dev-master')의 실행 결과가 ```text 텍스트 블록으로만 제시되어 있고, CLAUDE.md §4①에서 금지한 형식 위반. 2. '기대 출력' 섹션의 출력이 실제 클러스터에서 캡처한 것인지 불명확(실측하지 않은 느낌). 3. 예제 2~5(Audit Policy, ResourceQuota 등)는 YAML만 있고 `kubectl apply` 실행·검증 명령이 없음.
  - 보강: 1. tart-infra 실습 모든 명령의 결과를 실제 터미널 스크린샷(PNG)으로 교체. `scripts/capture-shot.sh 'kubectl get pod ...' output.png` 실행해 이미지 저장 후 `![실제 터미널](images/...png)` 삽입. 2. 예제 2~5 각각 아래에 검증 명령 추가: ```bash\nkubectl apply --dry-run=server -f audit-policy.yaml\nkubectl apply -f resource-quota.yaml -n production\nkubectl get quota,limitrange -n production\n``` 3. 실제 apply 후 결과 스크린샷 추가.
- **🔴 HIGH** `스토리라인누락` _섹션 2(Static Pod 보안 특성), 3(YAML 예제), 4(보안 흐름)_
  - 문제: Static Pod의 4가지 보안 특성(API Server 미거쳐서 Admission Control 미적용, RBAC 삭제 불가, 매니페스트 변조 즉시 반영, 컨트롤 플레인 컴포넌트가 Static Pod)이 왜 문제인지의 배경 미설명. 예: Static Pod를 왜 쓰나? (부트스트랩 체킨: API Server가 Static Pod로 실행되므로 자신을 API Server에 등록할 수 없음.) Problem 11의 Node,RBAC 조합이 왜 기본 권장인지도 표 형식만 있고 이야기 없음.
  - 보강: 1. 섹션 2 '보안 특성' 앞에 단락 추가: '컨트롤 플레인 컴포넌트(API Server, etcd, scheduler, controller-manager)는 부트스트랩 과정에서 자신을 실행해야 하는데, 아직 API Server가 없으므로 Static Pod 형태로 /etc/kubernetes/manifests에 저장되어 kubelet이 직접 관리한다. 이로 인해 다음 보안 특성이 생긴다:' 2. 각 특성마다 '위험성' 추가: '1. Admission Control 미적용 → manifest에 privileged container를 써도 검증 없이 실행' 3. Problem 11 해설 확장: 'Node 모드는 kubelet 자신만의 접근 허용(노드 자신의 Pod, 그 노드의 status만 수정 가능), RBAC는 역할 기반 제어로 일반 사용자·서비스 권한 제한. 둘을 함께 쓰면 kubelet은 자기 권한만, 나머지는 RBAC으로 제어되어 최소권한 원칙 달성.'
- **🔴 HIGH** `이해난이도` _섹션 1.3(kube-bench 결과), 3(YAML 예제), Problem 9, 16, 18_
  - 문제: kube-bench FAIL을 봤을 때 '수정 필요'라고만 했지, 실제 remediation(매니페스트 수정 후 재시작 등)이 없음. Problem 9의 KMS v2 해설: 'DEK 캐싱으로 성능 향상'은 맞지만 DEK/KEK 차이, 캐싱이 뭔지 설명 없음. Problem 16의 providers 순서: '첫 번째로 새 데이터 암호화, 나머지는 기존 데이터 복호화'는 정확하지만, 왜 이렇게 설계되었는지(keyrotation/복구 시나리오) 미설명.
  - 보강: 1. 섹션 1.3에 '대응 예시' 추가: '[FAIL] 1.2.6 Ensure that the --profiling argument is set to false → API Server 정적 Pod 매니페스트(/etc/kubernetes/manifests/kube-apiserver.yaml)에서 --profiling=false 추가 후 kubelet이 자동 감지해 재시작. 재확인: kubectl get pod kube-apiserver-* -n kube-system -o yaml | grep profiling' 2. Problem 9 해설 확장: 'KMS는 외부 키 저장소(AWS KMS, Vault 등)를 사용. DEK(Data Encryption Key)로 실제 etcd 데이터 암호화하고, KEK(Key Encryption Key)는 KMS에만 저장되어 etcd 자체에 평문으로 남지 않음. v2는 DEK를 메모리 캐시해 KMS 호출 감소로 성능 2~3배 향상.' 3. Problem 16 해설에 시나리오 추가: 'KMS v1에서 aescbc로 마이그레이션하려면, 먼저 providers에 [kms-v1, aescbc] 순서로 놓아 새 쓰기는 aescbc, 기존 읽기는 kms-v1로 처리. 모든 secret을 읽어 재쓰기하면 aescbc로 변환된다.'
- **🟡 MED** `정확성오류` _섹션 tart-infra 실습(kubeconfig 경로, ciliumnetworkpolicies 사용)_
  - 문제: 1. kubeconfig 경로: `export KUBECONFIG=~/sideproejct/...` 는 ~ 상대경로 사용. 학생이 다른 폴더에서 실행하면 경로 오류 발생. 2. `kubectl get ciliumnetworkpolicies` — Cilium 전용 API로 일반 K8s가 아님. 자격증은 CNI 중립적이어야 하는데 Cilium 의존성 생김.
  - 보강: 1. kubeconfig 경로를 절대경로 또는 git 루트 상대경로로 수정: `export KUBECONFIG=$(pwd)/kubeconfig/dev.yaml` 또는 `cd $(git rev-parse --show-toplevel) && export KUBECONFIG=kubeconfig/dev.yaml` 2. ciliumnetworkpolicies 명령을 표준 NetworkPolicy로 변경: `kubectl get networkpolicies -n cap-kcsa-d04 --no-headers | wc -l` 또는 Cilium 사용을 명시하되 표준 대체 명령도 함께 제공.
- **🟡 MED** `맥락점프` _Problem 1, 8, 그리고 §1.1 → §3 예제 순서_
  - 문제: Problem 1이 --anonymous-auth라는 플래그를 바로 묻는데, 왜 익명 접근이 위험한지 배경 설명 없음. 섹션 1.0에는 '--anonymous-auth의 기본값은 true'라 했지만, 왜 API Server는 기본적으로 익명 접근을 허용하나? (초기 설계의 접근성 vs. 보안 트레이드오프) 미설명.
  - 보강: 섹션 1.1 첫 단락에 추가: 'API Server는 기본적으로 누구든 연결할 수 있도록 설계되었으나(초기 개발 편의성), 보안상 유저 식별과 권한 검증을 해야 한다. --anonymous-auth=false로 미인증 요청을 401 거절하면, 모든 요청이 인증을 거쳐야 한다.' 또한 섹션 순서를 재구성: 1.0 배경 → 왜 이게 중요한가(위협) → 1.1 개념 정의 → 1.2 도구 → 1.3 실측.
- **🟡 MED** `구조` _섹션 4(Pod 생성 흐름)_
  - 문제: Pod 생성 흐름 flowchart(그림 3)는 9단계를 보여주는데, 각 단계가 **왜 이 순서인지** 명시 없음. 예를 들어 '인증 전에 인가를 할 수 없다'는 자명하지만, '인가 후에 Admission을 하는 이유는?' (정책 위반 객체를 일단 생성한 후 버리는 것보다, 사전에 검증해 리소스 낭비 방지) 미설명.
  - 보강: 그림 3 아래에 '주요 순서 설명' 단락 추가: '1~3 인증-인가는 '누가, 뭘 할 수 있나' 확인. 4는 Mutating Admission으로 요청 수정(default 값, sidecar 주입). 5는 스키마 검증. 6은 Validating Admission으로 정책 확인(PSA, OPA). 순서가 바뀌면: 예를 들어 Admission을 인증 전에 하면, 악의적 요청도 검증되어 불필요한 처리 발생.'
- **⚪ LOW** `용어비약` _Problem 17의 'AlwaysAllow' 모드, 문제 2의 Admission 개념_
  - 문제: Problem 2의 정답이 'C) 인증 → 인가 → Admission'인데, 여기 Admission은 '3단계 처리'인가 아니면 '개별 admission controller 플러그인의 실행'인가? 두 개념이 섞여 혼란. 학생이 Problem 4(허락 정책이 아닌 것)와 혼동 가능.
  - 보강: 섹션 4 단락 앞에 용어 정의 추가: 'API Server의 처리는 3단계: 1)인증(누구인가) 2)인가(무엇을 할 수 있는가) 3)Admission(정책 기반 수용 또는 거절/변조). Admission 단계 내에는 여러 플러그인(Mutating AC, Validating AC)이 차례로 실행된다.'
- **⚪ LOW** `실습재현불가` _예제 1(API Server YAML), 트러블슈팅 섹션_
  - 문제: 예제 1의 API Server YAML에 --authorization-mode=Node,RBAC가 있는데, 이 파일을 실제로 어느 경로에 놓아야 하고, 적용 후 어떻게 검증하는지 미설명. 트러블슈팅 섹션은 장애 시나리오만 있고, 학생이 실제로 그 장애를 유발하고 복구해보는 hands-on 미포함.
  - 보강: 예제 1 아래에 '실습: API Server 보안 플래그 확인' 단락 추가: '명령: kubectl get pod kube-apiserver-<마스터노드> -n kube-system -o yaml | grep -A5 command 로 현재 플래그 확인. 그 결과와 예제 1을 비교해 빠진 플래그(--encryption-provider-config, --audit-log-path 등)를 찾는다.' 트러블슈팅을 '학생이 직접 [FAIL] 항목을 고치기' 형태로 개편: 'dev 클러스터에서 현재 kube-bench 실행 → [FAIL] 항목 중 하나를 선택 → 해당 플래그를 매니페스트에 추가 → kubelet 재시작 대기 → kube-bench 재실행해 PASS 확인.'

### daily/day05.md · 가독성 4/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `용어비약` _2.1 ServiceAccount 기본 개념, Line 308-314_
  - 문제: 'Projected Volume'이 첫 등장하는데 정의 없음. CS 3~4학년이 이 개념을 모르면 'SA 토큰 마운트'의 동작 메커니즘을 이해 못 함.
  - 보강: Projected Volume의 정의를 1문장 추가: 'Projected Volume은 kubelet이 Pod 런타임에 동적으로 생성하는 임시 볼륨으로, 여러 정보원(ConfigMap, Secret, ServiceAccount token, downwardAPI)을 하나의 디렉터리에 병합해 마운트하는 방식이다.'
- **🔴 HIGH** `스토리라인누락` _2.2 Bound ServiceAccount Token (1.22+), Line 318-356_
  - 문제: Legacy Token의 보안 위험을 설명했지만, Bound Token 메커니즘이 텍스트로 풀어져 있지 않음. mermaid에만 흐름이 있고, '왜 kubelet이 자동 갱신하는가'라는 동기 없음. 학생이 각 단계의 '왜'를 이해 못 함.
  - 보강: 텍스트로 상세 설명 추가: '① Pod 생성 시 kubelet이 API Server의 TokenRequest를 호출 ② API Server가 JWT(유효기간 1시간, audience=해당 클러스터) 발급 ③ 토큰이 /var/run/secrets/.../token에 마운트 ④ 만료 30분 전 kubelet이 자동 갱신 요청 → 새 토큰 교체. 이렇게 하면 탈취된 토큰이 최대 1시간만 유효하고, Pod 삭제 시 토큰도 즉시 무효화된다.'
- **🔴 HIGH** `이해난이도` _3.3 PSS Restricted Pod YAML 예제, Line 481-482, 515_
  - 문제: 'NET_BIND_SERVICE는 유일한 add capability'라고만 했는데, 왜 이것만 예외인지, 1024 미만 포트가 왜 중요한지 설명 없음. CS학생이 배경 지식 없으면 이 제약을 외우기만 할 뿐 이해 못 함.
  - 보강: NET_BIND_SERVICE의 의도 설명 추가: 'NET_BIND_SERVICE는 1024 미만의 특권 포트(SSH 22, HTTP 80, HTTPS 443 등)를 바인드할 수 있게 하는 capability다. Restricted는 일반 사용자로 실행하므로 기본적으로 1024 미만 포트 바인드가 불가능한데, 웹 서버(nginx 포트 80)처럼 특권 포트가 꼭 필요한 경우만 이 capability를 add한다. 그 외 모든 capability는 제거해야 권한 상승 공격을 차단할 수 있다.'
- **🔴 HIGH** `실습재현불가` _2.3 automountServiceAccountToken, Line 375-381 + 실습 2_
  - 문제: Pod 수준 설정이 SA 수준보다 우선순위가 높다는 이론만 있고, 이를 실제로 검증하는 kubectl 명령이 없음. 학생이 클러스터에서 이 우선순위를 확인하고 확신할 수 없음.
  - 보강: 실습 명령 추가: '```bash\n# SA 수준 automountServiceAccountToken: true, Pod 수준: false 설정\nkubectl create sa test-sa -n demo\nkubectl create pod test-pod --image=nginx -n demo --serviceaccount=test-sa --dry-run=client -o yaml | sed 's/  containers:/  automountServiceAccountToken: false\n  containers:/' | kubectl apply -f -\nkubectl get pod test-pod -n demo -o jsonpath="{.spec.automountServiceAccountToken}"\n# 출력: false (Pod 수준이 우선순위 승리)\n```'
- **🔴 HIGH** `구조` _1.4 ClusterRole + RoleBinding 패턴 (Line 161-179) + 실습 1 (Line 676-709)_
  - 문제: 이론에서 'ClusterRole + RoleBinding = 해당 NS에서만'이라는 핵심을 설명했지만, 실습 1의 검증 명령(kubectl get clusterroles, clusterrolebindings)은 이 패턴을 직접 보여주는 예제가 없음. 학생이 기본 제공 ClusterRole만 보고 실제 '다중 NS에 재사용'하는 사례는 못 봄.
  - 보강: 실습 1에 구체 구성 예제 추가: '```bash\n# 실습: ClusterRole을 2개 NS에서 서로 다른 RoleBinding으로 재사용\nkubectl create clusterrole pod-viewer --verb=get,list --resource=pods\nkubectl create rolebinding pod-viewer-in-ns-a --clusterrole=pod-viewer -n ns-a --serviceaccount=ns-a:sa-a\nkubectl create rolebinding pod-viewer-in-ns-b --clusterrole=pod-viewer -n ns-b --serviceaccount=ns-b:sa-b\nkubectl auth can-i get pods --as=system:serviceaccount:ns-a:sa-a -n ns-a  # yes\nkubectl auth can-i get pods --as=system:serviceaccount:ns-b:sa-b -n ns-b  # yes\nkubectl auth can-i get pods --as=system:serviceaccount:ns-a:sa-a -n ns-b  # no (ns-a에서만 바인딩)\n```'
- **🟡 MED** `맥락점프` _3.4 PSA 3가지 모드 (Line 530-550)_
  - 문제: 'audit 모드는 위반을 Audit Log에 기록'이라고만 했는데, 학생이 이 audit log를 실제로 어디서(kube-apiserver 로그? kubectl? etcd?), 어떻게 조회하는지 모름. 'dry-run=server'처럼 실제 명령이 없음.
  - 보강: audit log 조회 방법 추가: '```bash\n# 네임스페이스에 audit 모드 활성화\nkubectl label namespace demo pod-security.kubernetes.io/audit=restricted --overwrite\n# 위반 Pod 생성 시도(예: runAsNonRoot 미설정)\nkubectl run test --image=nginx -n demo\n# Audit log 확인(kube-apiserver 로그에서 annotation으로 기록됨)\nkubectl get events -n demo  # Event로는 안 보임\n# 직접 API Server 로그 확인(kubelet SSH 후 /var/log/pods/.../kube-apiserver/.../logs/...\ngrep audit-event <logfile> | jq '.annotations["pod-security.kubernetes.io/audit-violations"]'\n```' 또는 더 간단하게 'kubectl describe pod <pod> -n demo'의 이벤트에서 PSA 위반이 보이는지 캡처.
- **🟡 MED** `용어비약` _3.3 Restricted Pod YAML, Line 504, 632 seccompProfile_
  - 문제: seccompProfile: RuntimeDefault와 Localhost의 차이가 없음. 학생이 두 값을 구분할 수 없고, 실습에서 '둘 다 Restricted를 만족하는가, 아니면 한 가지만?'을 확인 못 함.
  - 보강: seccomp 프로파일 선택 기준 추가: '```yaml\nseccompProfile:\n  type: RuntimeDefault  # 권장: 기본 seccomp 프로파일 사용(커널 정책 표준)\n  # 또는\n  type: Localhost\n  localhostProfile: custom-profile.json  # 커스텀 seccomp 정책 파일(고급, 일반적으로 필요 없음)\n```\nRestricted는 둘 다 만족하지만, RuntimeDefault(제조사 기본값)를 권장한다. Localhost는 노드 마다 커스텀 정책을 배포/관리해야 해서 운영 부담이 크다.'
- **🟡 MED** `이해난이도` _3.6 PSA 적용 시 주의사항 + 실습 3 (Line 730~747)_
  - 문제: 실습 3의 기대 출력 '`--show-labels | grep pod-security || echo "PSA 레이블 미설정"`'이 dev 클러스터에서 실제로 뭘 반환할지 불명확. 학생이 명령을 실행해도 자신의 출력이 정상인지 비교할 수 없음.
  - 보강: 기대 출력 예시 추가: '```\n=== 네임스페이스 PSA 레이블 ===\nNAME     STATUS   AGE   LABELS\ndefault  Active   1d    <none>  # PSA 레이블 미설정\nkube-system  Active  1d    pod-security.kubernetes.io/enforce=privileged\nproduction   Active  1d    pod-security.kubernetes.io/enforce=restricted,pod-security.kubernetes.io/audit=restricted\n```'
- **🟡 MED** `정확성오류` _1.9 RBAC 권한 점검 도구 (Line 276~293)_
  - 문제: rakkess, rbac-lookup, kubectl-who-can 같은 3rd-party 도구를 소개했지만, KCSA 시험에 이들이 나올 가능성은 낮음. 공식 kubectl auth만으로 충분한데, 혼합되어 있음. 우선순위 불분명.
  - 보강: 도구 소개 섹션을 'kubectl auth(필수)'와 '3rd-party 심화(선택)'로 구분: '```\n필수 점검 도구:\n- kubectl auth can-i: 개별 권한 확인\n\n(참고) 심화 도구(자격증 외):  rakkess 등\n```'
- **⚪ LOW** `스토리라인누락` _1.8 RBAC 보안 모범 사례 (Line 251~274)_
  - 문제: 'create pods/exec 신중히'라는 경고만 있고, '왜 pods/exec 권한이 위험한지'(컨테이너 내부에서 임의 명령 실행 → 클러스터 탈취)를 구체적으로 설명 안 함.
  - 보강: 트레이드오프 추가: 'pods/exec 권한이 위험한 이유: kubectl exec로 실행 중인 Pod 내부에 진입해 임의의 시스템 명령(예: cat /var/run/secrets/.../token)을 실행할 수 있어 ServiceAccount 토큰 탈취, 호스트 접근, 클러스터 정복으로 이어질 수 있기 때문이다.'
- **⚪ LOW** `용어비약` _1.3 RBAC YAML 상세, Line 79, 90 resourceNames와 escalate verb_
  - 문제: resourceNames와 escalate를 처음 언급했는데, resourceNames의 문법(리소스 이름 배열)이나 escalate의 구체적 위험(Role 권한 자체를 상승)이 명확 안 함.
  - 보강: 한 줄 설명 추가: '`resourceNames: ["my-pod"]` = 특정 Pod 이름만으로 제한(와일드카드보다 안전), `escalate verb` = 자신보다 높은 권한의 Role을 생성/수정할 수 있어 자신보다 강한 권한으로 승격 가능 — 관리자만 가능.

### daily/day06.md · 가독성 4/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `스토리라인누락` _섹션 1.0 등장배경 — STRIDE/MITRE ATT&CK 참조_
  - 문제: STRIDE·MITRE ATT&CK을 구체적 문맥 없이 언급만 함. 학생이 Lateral Movement·Information Disclosure가 실제 Pod 침해 시나리오에서 어떻게 일어나는지 상상 못 함.
  - 보강: 등장배경에 '공격자가 app Pod를 침해하면(RCE) → kubelet 접근(DA) → 같은 노드의 db Pod로 이동 시도(Lateral Movement) → NetworkPolicy 없으면 성공 → 데이터 유출' 식 그림·경로를 1개 추가. MITRE에 대한 1줄 설명(Techniques와 Tactics의 관계) 첨가.
- **🔴 HIGH** `스토리라인누락` _섹션 2.1 Secret의 기본 저장 방식_
  - 문제: Base64 vs 암호화 설명은 좋지만 '그럼 보안을 언제 거는가' 흐름이 끊김. Encryption at Rest(API Server etcd 암호화)와 RBAC 제한이 어떻게 3중방어를 이루는지 스토리 부족.
  - 보강: 섹션 2.1에 '3중 방어: 1.etcd 암호화(저장 중) 2.RBAC(읽기 제한) 3.Volume tmpfs(메모리 전달)' 그림 추가. 각 계층이 언제 뚫릴 수 있는지(예: RBAC 뚫려도 tmpfs는 보호) 명시.
- **🔴 HIGH** `용어비약` _섹션 1.1 default-deny 정책 설명_
  - 문제: 'podSelector: {}' = '모든 Pod'라는 설명은 있으나, '왜 {}는 모든 것을 선택하는가' 쿠버네티스 라벨 셀렉터 원리가 없음. 3~4학년이 처음 K8s를 배우는 학생은 {} 문법이 직관적 아님.
  - 보강: 세트 이론 간단 설명: '라벨 셀렉터는 {조건} 형태. 빈 {}: 조건 없음 = 모든 것' + 예시 '예: role: frontend는 그 라벨을 가진 Pod만, {} 는 라벨 유무 무관 모든 Pod'. 또는 'matchLabels가 빈 것은 필터 없음=전체 통과' 평문.
- **🔴 HIGH** `맥락점프` _섹션 1.4 실전 예제 — web-policy 주석 해석_
  - 문제: 'namespaceSelector: {} = 모든 NS의 DNS'라고 했는데, DNS는 왜 모든 NS(특히 kube-system)의 권한이 필요한가 설명이 없음. 학생은 '그냥 DNS pod 하나 허용이면 되지 않나?' 의문 생김.
  - 보강: 주석에 '모든 NS의 DNS 서비스(기본 kube-system의 coredns)에 접근 가능하게 함. 같은 NS coredns도 포함하려면 namespaceSelector: {} 사용' 명시. 또는 DNS 디스커버리(Pod 생성 시 injected resolv.conf가 nameserver 10.96.0.10(service CIDR 내 DNS svc IP)를 가리킴)를 1줄 추가.
- **🔴 HIGH** `실습재현불가` _전체 — 실제 kubectl 명령 검증 및 스크린샷 부재_
  - 문제: CLAUDE.md의 규칙 §4①: '명령 실행 결과는 반드시 실제 터미널 스크린샷 이미지(텍스트 블록 금지)' 인데, day06.md의 모든 kubectl 예제(NetworkPolicy 생성, Secret 확인, RBAC 테스트)는 '기대 출력' 텍스트 설명만 있고 실제 이미지가 없음. 학생이 따라 치고 '내 출력이 맞나' 비교 불가.
  - 보강: 저장소의 dev 클러스터에서 직접 실행: kubectl apply -f 1.2의 default-deny-ingress.yaml → kubectl get networkpolicies → 스크린샷(터미널). 실습 섹션 7의 모든 명령(1~4)을 dev에서 구동하고 실제 출력 캡처 이미지 삽입. 또는 '(미캡처)' 표기하고 구축 후 추가.
- **🔴 HIGH** `정확성오류` _섹션 3.2 OPA vs Kyverno 비교표 — 'Mutate 지원' 행_
  - 문제: 'OPA: 제한적, Kyverno: 완전 지원'이라 했는데, OPA도 Mutating Webhook으로 객체 수정(mutate)이 가능하고 `mutation` 블록이 있음. '제한적'이 정확한 뜻이 무엇인지 모호. 정책 생성 편의성 차이인지, 기능 자체 부재인지 불명.
  - 보강: 비교표 수정: 'OPA: Mutate 가능하지만 Rego 코드로 직접 구현 필요(학습곡선 높음) vs Kyverno: mutation 블록으로 YAML 수준 직관적 필드 변경(예: 라벨 자동추가)' 명시. 또는 표에 각주 추가.
- **🟡 MED** `이해난이도` _섹션 1.3 AND/OR 규칙 설명 — 들여쓰기 수준으로 판정_
  - 문제: '같은 from 항목 내 하이픈이 하나 = AND / 여러 개 = OR'라는 설명이 YAML 문법에 의존. '하이픈이 하나'가 무엇을 의미하는지 학생이 혼동 가능(리스트 요소 개수 vs 필드 개수).
  - 보강: 명확한 용어 사용: '- from: 블록 안에서, 같은 들여쓰기 수준의 다수 항목(예: namespaceSelector와 podSelector가 나란히) = AND. 별도 - from: 블록 여러 개 = OR.' 코드 주석으로도 표기.
- **🟡 MED** `구조` _섹션 2 Secret 관리 심화 — 외부 시크릿 관리자 부분_
  - 문제: 2.4 외부 시크릿 관리자를 다이어그램만으로 보임. Sealed Secrets가 '암호화하여 Git에 저장'이라 했는데, GitOps 없는 학생은 왜 이게 중요한지 모름. Vault·AWS Secrets Manager의 차이(동적 생성/로테이션)도 설명 부족.
  - 보강: 2.4 앞에 '내부 K8s Secret 저장 문제: 평문 etcd → 외부 관리자로 이동' 문단 추가. Vault(동적 생성·만료), AWS SM(클라우드 의존), Sealed Secrets(GitOps+암호화) 각 용도 구체화. 예: '프로덕션에서 DB 암호 매일 로테이션이 필요하면 Vault; 클라우드 서비스면 AWS SM; Git에 암호화해서 저장하고 싶으면 Sealed Secrets'.
- **🟡 MED** `용어비약` _섹션 1.5 CNI와 NetworkPolicy — Cilium L7 설명_
  - 문제: 'Cilium: L3/L4/L7' 라 했을 때, L7이 HTTP 정책이라 예시만 있고 L3/L4와의 차이(패킷 헤더 vs 페이로드)가 없음. 3~4학년이 OSI 레이어를 정확히 알지 못하면 L7 정책의 가치를 못 느낌.
  - 보강: Cilium L7 설명에 '표준 NetworkPolicy(L3/L4): 출발지 IP·도착지 IP·포트만 검사. Cilium L7: HTTP 메서드(GET/POST), URL 경로, Host 헤더 등 애플리케이션 수준 검사(예: /admin 경로만 특정 Pod 허용)' 추가.
- **🟡 MED** `맥락점프` _섹션 4 시험 출제 패턴 — 문제 출제 배경_
  - 문제: 패턴 1~6을 나열만 했는데, 왜 이 패턴들이 반복되는가(시험 설계자 관점)가 없음. 학생 입장에서 '이 6개만 외우면 합격'인지, 아니면 심화문제도 나올 수 있는지 불명.
  - 보강: '이 6가지 패턴이 KCSA 보안 도메인의 핵심 목표(Zero Trust 네트워크 + Secret 보호 + 정책 엔진 선택)를 대표하므로, 모의고사/실시험에서 반복·응용됨' 한 문장 추가. 또는 '심화: AND/OR 조합 + egress + 동시 적용 등 복합 시나리오도 출제될 수 있으니 1.3을 깊이 있게 이해할 것' 경고.
- **🟡 MED** `이해난이도` _섹션 3.3 Kyverno 정책 예제 — pattern 문법_
  - 문제: 'image: "!*:latest"' 패턴이 Kyverno 고유 문법인데, 문법 설명 없음. 학생은 '!'가 부정(not), '*'가 와일드카드라고 추측만 함. 정확한 의미(Kyverno CEL/JMESPath pattern 문법)를 모르면 정책 커스터마이징 불가.
  - 보강: 3.3 예제 앞에 'Kyverno pattern: "!값"은 NOT(부정), "*"는 와일드카드(1글자 이상), "?*"는 비어있지 않음을 의미' 간단 문법 표 또는 각주 추가. 또는 '예: disallow-latest-tag의 pattern "image: \"!*:latest\"" 는 이미지 태그가 latest가 아닌 것만 허용' 명시.
- **⚪ LOW** `맥락점프` _섹션 3.1 정책 엔진의 역할 — Admission Webhook_
  - 문제: 'Validating/Mutating Admission Webhook으로 동작한다'는 개념만 있고, 내부 흐름(요청 → webhook 호출 → approve/reject)이 없음. 4C 보안 모델의 어디에 해당하는지도 명시 부족.
  - 보강: 3.1에 '정책 엔진은 API Server의 Admission Controller 단계에서 객체 생성/수정 요청을 인터셉트해 정책 검사. ValidatingWebhook(거부만), MutatingWebhook(수정+생성)' 순서도 간단히. 또는 'API 요청 흐름: Client → API Server → Authentication → Authorization → Admission Webhook(정책 엔진) → ETCD 저장' 다이어그램(mermaid) 추가.
- **⚪ LOW** `용어비약` _섹션 2.3 Secret 유형 표 — 'kubernetes.io/service-account-token'_
  - 문제: 'SA 토큰 (Legacy)' 이라 했는데 Legacy가 무엇을 의미하는지(K8s 1.24 이후 Bound Token으로 대체됨)가 명시 부족. 학생이 '언제 사용해야 하나' 판단 못 함.
  - 보강: 표 주석 추가: 'kubernetes.io/service-account-token: 자동 생성 SA 토큰(K8s 1.24 이전, 제한 없음). K8s 1.24+부터는 Bound Token(만료·audience 제한) 권장. 호환성만 필요하면 automount 가능' 명시.

### daily/day07.md · 가독성 3/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `용어비약` _1.1~1.2 MITRE ATT&CK 섹션_
  - 문제: MITRE Corporation, Kill Chain, 컨테이너 환경 고유의 공격 벡터 등 용어 첫 등장 시 풀이 전혀 없음. '공격자의 사고 흐름(Kill Chain)'만 괄호 포함하고 나머지는 그냥 사용 — 학부생이 자료 찾아봐야 함
  - 보강: Kill Chain = 공격자가 목표 달성까지 거치는 순차적 단계를 의미. 초기 접근 → 명령 실행 → 지속성 확보 → 권한 상승 → ... 이런 식으로 확장. MITRE Corporation = 비영리 연구기관으로 실제 사이버 공격 사례를 분석해 프레임워크를 만듦. 컨테이너 고유 벡터 = 기존 Windows/Linux 서버와 달리 Kubernetes API, 이미지 레지스트리, 네임스페이스 격리 같은 컨테이너 특화 리소스를 악용하는 공격을 의미.
- **🔴 HIGH** `용어비약` _2.2 Cosign 상세 섹션, 라인 117-121_
  - 문제: OIDC, Sigstore, Fulcio CA, Rekor 투명성 로그 용어가 갑자기 등장해서 풀이 없음. '키리스 서명'은 처음 보는 학생이 의미 파악 불가능
  - 보강: 키리스 서명(Keyless Signing) = 기존처럼 비대칭 암호 키 쌍을 직접 관리하지 않고, GitHub/Google 같은 기존 계정으로 인증해 임시 인증서를 발급받아 서명하는 방식. OIDC(OpenID Connect) = 표준 인증 프로토콜(OAuth 기반). Sigstore = Linux Foundation의 보안 서명 프로젝트. Fulcio = Sigstore의 CA(인증 기관)로서 OIDC 인증 후 임시 인증서 발급. Rekor = Sigstore의 투명성 로그로 모든 서명 기록을 블록체인처럼 공개 기록해 위변조 탐지 가능.
- **🔴 HIGH** `용어비약` _2.3 SLSA 섹션, 라인 128-142_
  - 문제: '출처 증명(Provenance)'이 먼저 정의 없이 사용됨. 'Hermetic' 용어도 설명 없음
  - 보강: Provenance(출처 증명) = 소프트웨어가 어디에서, 누가, 어떤 환경에서 만들었는지 기록한 문서. SBOM, 빌드 환경, 빌드자 정보 등 포함. Hermetic Build = 외부 네트워크/환경 변수 의존 없이 빌드 정의만으로 100% 결정되는 빌드를 의미(재현성 보장).
- **🔴 HIGH** `용어비약` _3.1 Falco 섹션, 라인 172-183_
  - 문제: eBPF 드라이버, 시스템 콜(syscall), 커널 레벨 설명이 한 줄이고 더 이상 풀이 없음. 학부생(특히 OS 미수강)이 eBPF가 뭔지 모르면 Falco 원리를 못 이해
  - 보강: eBPF(Extended Berkeley Packet Filter) = 커널 가상 머신으로, 권한 있는 사용자가 커널을 수정 없이 커널 내부에서 프로그램을 안전하게 실행할 수 있는 기술. 과거엔 패킷 필터링만 가능했는데 현재는 시스템 콜 후킹, 메모리 접근 추적 등 광범위한 모니터링 가능. syscall(시스템 콜) = 애플리케이션이 커널에 특정 작업(파일 읽기/쓰기, 프로세스 생성, 네트워크 송수신)을 요청하는 인터페이스. Falco는 eBPF로 모든 syscall을 후킹해서 비정상 패턴을 탐지.
- **🔴 HIGH** `용어비약` _2.4 정적분석 vs 동적분석 표, 라인 144-162_
  - 문제: '정적 분석' '동적 분석' 용어가 표 제목으로 있지만 처음에 정의 없이 사용됨. CVE, SPDX, CycloneDX 약자도 설명 없음
  - 보강: 정적 분석(Static Analysis) = 프로그램을 실행 없이 소스 코드나 바이너리 파일을 검사하는 분석 기법. CVE(Common Vulnerabilities and Exposures) = 공개된 보안 취약점 데이터베이스. SPDX = Linux Foundation 표준 SBOM 형식. CycloneDX = OWASP의 경량 SBOM 형식. 동적 분석(Dynamic Analysis) = 프로그램을 실제로 실행하면서 행동을 감시하는 분석 기법.
- **🔴 HIGH** `스토리라인누락` _1.0 등장배경 섹션 전체 (라인 10-26)_
  - 문제: '기존 방식의 한계'만 나열하고, 컨테이너 보안이 기존 Linux 보안(전통 서버)과 **구체적으로 어떻게 다른지** 설명 부족. '공격자의 전술/기법이 컨테이너에 특화'라는 추상적 표현만 있음
  - 보강: 다음과 같이 구체화: '전통 Linux 서버는 호스트마다 SSH, 프로세스 관리자(systemd), 파일시스템이 고정적이다. 하지만 컨테이너는 (1) 몇 초 만에 수천 개 복제 가능하고, (2) Kubernetes API로 원격에서 시작/중단되며, (3) 이미지 레지스트리에서 런타임에 다운로드되므로, 기존 시그니처 기반 탐지는 속도/규모가 따라가지 못한다. 그래서 동작 패턴(시스템 콜 모니터링, API 접근 로그) 기반의 체계적 위협 모델이 필수가 됐다.'
- **🔴 HIGH** `스토리라인누락` _3.3~3.5 seccomp·AppArmor·SELinux 섹션_
  - 문제: 3가지 도구를 병렬로 나열만 하고, 왜 3가지가 동시에 필요한지, 언제 어떤 것을 써야 하는지 설명 없음. 'AppArmor와 SELinux가 상호 배타적'이라는 사실만 있고, **왜 그런지(메커니즘)는 생략**
  - 보강: AppArmor와 SELinux 차이: 둘 다 MAC(Mandatory Access Control) 방식이지만 AppArmor는 '경로 기반'(예: /bin/sh는 /etc/shadow 읽기 금지)이고 SELinux는 '라벨 기반'(예: init_t 프로세스는 admin_home_t 파일만 접근). 같은 커널이 2개 MAC을 동시에 로드하면 둘 다의 제약을 적용해서 복잡도가 폭발하므로 하나만 쓴다. 선택: Ubuntu/Debian → AppArmor(기본), RHEL/CentOS → SELinux(기본). seccomp는 '어떤 시스템 콜을 쓸 수 있는가'를 제어하는 다른 차원이므로 AppArmor/SELinux와 함께 사용 가능.
- **🔴 HIGH** `스토리라인누락` _3.7 격리 강화 기술 섹션 (라인 388-399)_
  - 문제: gVisor와 Kata Containers를 '격리 기술'로 나열하지만, 왜 기존 컨테이너(기본 runc)가 부족했는지 설명 없음. 기본 컨테이너의 보안 문제점을 모르면 강화의 필요성을 못 느낌
  - 보강: 배경: 기본 runc 컨테이너는 '리눅스 네임스페이스와 cgroup만으로' 격리한다. 그러나 (1) 커널 취약점이 발견되면 컨테이너 탈출 가능, (2) 모든 컨테이너가 호스트 커널을 공유하므로 커널 익스플로잇 한 번이 모든 컨테이너 위험. → gVisor: 사용자 공간에서 syscall을 재구현해서 '호스트 커널을 거치지 않음'. 단점: 대부분의 syscall을 재구현해야 하므로 성능 오버헤드. → Kata Containers: 각 컨테이너를 경량 VM에서 실행 (각자 커널 탑재). 가장 강하지만 메모리/부팅 오버헤드 크다.
- **🟡 MED** `이해난이도` _2.1 공급망 보안 파이프라인 (라인 80-102)_
  - 문제: SBOM, Trivy, Grype, Syft, Cosign 도구를 한 번에 흐름에 욱여넣음. 각 도구 간 관계('Trivy가 취약점 스캔', 'Grype도 취약점 스캔'이면 뭐가 다른가?)나 선택 기준이 명확하지 않음
  - 보강: 도구별 역할을 명확히: Syft = 이미지에서 패키지 목록 추출 (SBOM 생성기). Trivy = 가장 인기 있는 CVE 스캐너 (오픈소스, 무료, 정확도 높음). Grype = Anchore사 도구 (Trivy 대안, 두 개 모두 써도 됨). Cosign = SBOM과 CVE 리포트를 이미지와 함께 OCI 레지스트리에 저장하고 서명. Kyverno/Connaisseur = 배포 시점에 서명 검증 정책 적용. 학습순: Cosign → Trivy → SBOM(Syft) → Kyverno/Connaisseur.
- **🟡 MED** `이해난이도` _3.2 Falco 규칙 예제 (라인 205-234)_
  - 문제: YAML 규칙이 주어져도 'condition' 필드의 'spawned_process', 'container', 'proc.name', 'fd.name' 같은 메타데이터 필드가 어디서 오는지(eBPF 출력? K8s API?) 설명 없음
  - 보강: 'Falco 데이터 소스'(라인 199-202)와 '규칙 예제'를 재배치. 먼저 eBPF가 수집하는 syscall 정보(프로세스 이름, PID, 부모 PID, 파일 접근, 네트워크 포트 등)가 어떤 메타데이터로 변환되는지 표로 정리. 예: execve() syscall → proc.name, proc.pname, proc.pid 등. 그 다음에 규칙 예제를 보면 '아, 이 필드들은 eBPF가 주는 데이터네'라는 연결이 생김.
- **🟡 MED** `이해난이도` _3.3 seccomp 설정 YAML (라인 253-274)_
  - 문제: YAML 예제에서 'RuntimeDefault'와 'Localhost' 설정이 있지만, '어디서 프로파일을 찾는가?' '커스텀 프로파일 작성법'이 전혀 없음. `/var/lib/kubelet/seccomp/`는 라인 247에서 한 번 나오고 끝
  - 보강: 실습 가이드 추가: 'RuntimeDefault 프로파일은 containerd/CRI-O가 기본 제공(주로 /etc/certs/seccomp 또는 런타임 내장). Localhost로 커스텀 프로파일을 쓰려면 노드의 /var/lib/kubelet/seccomp/profiles/ 디렉터리에 JSON 파일(whitelist 또는 blacklist 형식)을 두고, Pod YAML에서 localhostProfile: profiles/my-profile.json으로 지정. 예: whitelist은 허용 syscall 명시, blacklist는 차단 syscall 명시. 기본값은 whitelist(보안 강함).' 구체적 JSON 예제 1개 추가.
- **🟡 MED** `맥락점프` _1.2 → 1.3 섹션 전환 (라인 42-74)_
  - 문제: 1.2에서 9대 전술을 상세 설명했는데, 1.3에서 갑자기 '시험 빈출 키워드-전술 매핑' 표만 있음. 중복인가 아니면 보충인가? 1.2를 읽은 후 1.3의 필요성이 불명확
  - 보강: 1.3을 '자격증 출제 패턴' 섹션으로 명확히. 설명: '시험에선 9대 전술을 직접 묻지 않고, 구체적 공격 시나리오(예: "kubectl exec로 명령 실행")를 제시해서 어느 전술인지 고르는 식으로 출제된다. 실제 시험 유형 5~10개 추가 예시.' 이렇게 하면 1.2는 '개념'·1.3은 '시험 응용'으로 구분 명확.
- **🟡 MED** `맥락점프` _2.1 → 2.2 → 2.3 섹션 흐름 (라인 80-142)_
  - 문제: 공급망 파이프라인(2.1)에서 Cosign, Trivy, SBOM이 한 번에 나옴 → 2.2에서 Cosign만 깊이 있게 → 2.3에서 SLSA만. 왜 이 순서인가? Cosign과 SLSA의 관계(SLSA 레벨에 Cosign이 어디 쓰이는가)가 명확하지 않음
  - 보강: 순서 재정렬: 2.1(파이프라인 개요) → 2.3(SLSA 배경: '소프트웨어 공급망 보안의 4단계 체계') → 2.2(Cosign: SLSA 레벨 2 이상에서 요구하는 서명 도구) → 2.4(정적분석). 이렇게 하면 일반적 프레임워크(SLSA) → 구체적 도구(Cosign) 순서가 논리적.
- **🟡 MED** `실습재현불가` _3.2 Falco 규칙 예제 (라인 205-234)_
  - 문제: 예제는 있지만 '이 규칙을 실제 클러스터에 적용하는 명령'이 없음. Pod에서 쉘을 실행했을 때 실제로 Falco가 경고하는 스크린샷도 없음
  - 보강: 실습 단계 추가: (1) 기본 Falco 규칙을 클러스터에 배포하는 kubectl 명령(또는 Helm). (2) 테스트 Pod를 실행하고 exec로 쉘 진입. (3) 호스트에서 `journalctl -u falco` 또는 `kubectl logs -n falco` 로 경고 확인하는 실제 스크린샷. (4) '민감한 파일 접근' 규칙을 테스트하려면 Pod 내에서 `cat /etc/shadow` 시도해서 경고 캡처.
- **🟡 MED** `실습재현불가` _3.3 seccomp 설정 YAML (라인 253-274)_
  - 문제: YAML만 있고 '이 Pod를 배포한 후 어떤 명령을 실행하면 syscall이 차단되는지' 구체 예제 없음. 학생이 '이 설정이 실제로 뭘 하는가'를 모름
  - 보강: 실습: (1) RuntimeDefault와 Unconfined Pod 2개를 동시 배포. (2) 각 Pod에서 차단되는 syscall을 시도(예: ptrace 호출). (3) RuntimeDefault Pod는 실패, Unconfined는 성공하는 화면 스크린샷. (4) `dmesg | grep -i seccomp` 로 커널 로그 확인.
- **🟡 MED** `실습재현불가` _3.4 AppArmor 설정 YAML (라인 307-324)_
  - 문제: K8s 1.30+ 신문법(securityContext.appArmorProfile)이 있지만 호환성 설명 없음. 기존 문법(`container.apparmor.security.beta.kubernetes.io/`)과의 차이도 미언급
  - 보강: 호환성 명시: 'Kubernetes 1.30 이전은 Pod annotation으로 AppArmor 프로파일을 지정했다: `container.apparmor.security.beta.kubernetes.io/<컨테이너-이름>: localhost/profile-name`. 1.30+부터 securityContext 필드로 공식 지원(stable). 기존 annotation도 계속 동작하지만 새로 쓸 땐 securityContext 사용.' 버전별 실습 명령 2가지 제시.
- **🟡 MED** `정확성오류` _2.2 Cosign 섹션, 라인 117-122_
  - 문제: 키리스 서명에서 '별도 키 관리 불필요'라고 했는데, 실제로는 Sigstore의 개인 키(signing key)가 생성되고 관리되어야 한다. '키 관리 안 해도 된다'는 마케팅 표현이 정확하지 않음
  - 보강: '키리스 서명'의 정확한 의미: '사용자가 비대칭 암호 키 쌍을 직접 생성·보관하지 않는다'는 뜻. Sigstore의 Fulcio CA가 OIDC 인증 후 임시 인증서를 발급하고, 그것으로 서명을 만들고, 나중에 폐기한다. 따라서 장기 보관할 개인 키가 없다. 대신 GitHub/Google 계정(OIDC 제공자)이 있으면 된다. 결론: '키 파일을 여러 팀원이 공유하는 복잡성이 없다.'
- **🟡 MED** `정확성오류` _3.1 Falco 섹션, 라인 194-197_
  - 문제: 'Falco가 탐지할 수 없는 것' 중 'SQL Injection 취약점 → SAST 도구 필요'라고 했는데, SAST(Static Application Security Testing)는 '응용 계층 코드 취약점'용이다. 좀 더 정확한 설명 필요
  - 보강: 'SQL Injection은 코드 로직의 문제이므로 런타임 모니터링(Falco)은 탐지할 수 없다. Falco는 syscall(시스템 계층) 행동만 본다. SQL Injection 공격 후 비정상 데이터 유출(예: 파일 쓰기)은 Falco가 탐지할 수 있지만, Injection 자체는 못 한다. 따라서 코드 리뷰(SAST·DAST) 필요.' 추가 예: 'Falco는 " /etc/shadow 파일 접근 시도"는 탐지하지만 "SQL 쿼리 문법 오류"는 못 본다.'
- **⚪ LOW** `용어비약` _3.6 위험한 SecurityContext 설정, 라인 356-386_
  - 문제: MAC(Mandatory Access Control)이 라인 278에서 처음 나오는데 풀이 없음. DAC(Discretionary Access Control)와 비교 설명도 없음
  - 보강: MAC vs DAC: DAC(재량적 접근 제어) = 파일 소유자가 권한을 정할 수 있음(예: chmod 755). MAC(강제적 접근 제어) = 시스템 관리자가 정책(정책을 위반할 수 없음)으로 정함(예: AppArmor, SELinux). Kubernetes 기본은 DAC(리눅스 UID/GID) 기반이고, AppArmor/SELinux는 그 위에 추가 MAC 계층을 올리는 것.
- **⚪ LOW** `용어비약` _라인 351, 'MCS 라벨'_
  - 문제: SELinux 컨텍스트에서 'MCS 라벨(Multi-Category Security)'이라는 용어가 설명 없이 나옴
  - 보강: MCS 라벨: SELinux 컨텍스트의 level 부분(마지막 성분). s0:c123,c456 형식. 같은 type을 가진 여러 프로세스를 '범주'로 나눠서 프로세스 간 메모리 공유 차단. s0 = 민감도(clearance level), c123,c456 = 범주. K8s에선 보통 Pod별로 고유한 c 범주를 할당해서 Pod 간 격리 강화.
- **⚪ LOW** `구조` _4. 핵심 암기 항목 (라인 403-433)_
  - 문제: 암기 항목이 너무 벌크다. 8-9개 섹션에서 나온 내용을 한 덩어리로 정렬했는데, 우선순위·출제 빈도 표시 없음
  - 보강: 암기 항목을 3단계로: (1) 필수(자격증 80% 출제 빈도): MITRE 9전술, SLSA 4단계, Cosign·Trivy·Falco 정의. (2) 중요: seccomp·AppArmor 모드, 위험 설정 5가지. (3) 추가: gVisor·Kata, SBOM 형식. 각각 별도 bullet.

### daily/day08.md · 가독성 4/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `스토리라인누락` _1.0 등장 배경(L10-30), 특히 1.2 Istio mTLS 모드(L69-95)_
  - 문제: mTLS는 Day 7의 '무엇을 방어할 것인가'라는 위협 모델 위에 '어떻게 구현하는가' 기술을 얹은 것인데, 이 전제가 명시되지 않음. 또한 '왜 STRICT/PERMISSIVE/DISABLE 3개 모드가 필요한가'에 대한 실제 프로덕션 마이그레이션 시나리오(greenfield vs brownfield)가 없어 학생이 '둘 다 사용하는 이유'를 모름.
  - 보강: 1.0을 "Day 7 위협 모델 복습 + 전송 중 공격(네트워크 스니핑/중간자 공격/위조) 시나리오 -> 암호화 + 인증의 필요성 도출" 형식으로 확장. 1.2에서 PERMISSIVE를 설명할 때 "레거시 Pod(사이드카 미주입)와 신규 Pod(사이드카 주입)의 공존 전략 -> 단계적 롤아웃"이라는 마이그레이션 스토리를 추가.
- **🔴 HIGH** `용어비약` _1.1(L32-51): 'mTLS'라는 용어와 'TLS 인증서'의 관계_
  - 문제: 일반 TLS와 mTLS의 차이를 '단방향 vs 양방향'으로만 설명하지만, 기술적 차이(클라이언트 인증서 요구, CA 신뢰 체인 구성)를 담지 않아 "인증서가 뭔데 양방향이 뭐냐"는 학생이 이해할 수 없음. '양방향'이 구체적으로 '클라이언트도 인증서를 제시하고 검증받는다'는 뜻을 명시해야 함.
  - 보강: 1.1의 '일반 TLS' 설명을 다음과 같이 확장: "TLS는 기본적으로 서버만 인증서를 제시한다(클라이언트는 신뢰할 수 있는 CA 리스트로 검증). mTLS는 클라이언트도 인증서를 준비하고 서버가 이를 검증한다. 따라서 양쪽 모두 서로를 신원으로 확인 가능하다." + mermaid에 handshake 시퀀스(client cert request - client cert send - server verify - 양쪽 모두 인증)를 추가.
- **🔴 HIGH** `맥락점프` _1.3 Cilium(L97-148)과 1.4 Service Mesh 비교(L150-166)의 연결_
  - 문제: "Cilium은 eBPF 기반 CNI, WireGuard로 노드 간 암호화"라는 설명이 "Service Mesh(사이드카 프록시)의 mTLS"와 어떻게 다른 계층에서 작동하는지 명시되지 않음. 학생은 '둘 다 암호화인데 왜 배우는가'라고 의문. Cilium은 '네트워크 계층(L3/L4 이상)', Istio는 '애플리케이션 계층(L7)' 역할을 하는 것을 도식으로 설명해야 함.
  - 보강: 1.4 비교표 위에 OSI 계층 다이어그램을 추가: Cilium(L3/L4 노드 간 암호화) vs Istio(L7 서비스 간 인증/인가) vs Linkerd(경량 L7). 1.3과 1.4 사이에 과도 문장 "Cilium은 네트워크 인프라 수준의 보안이고, Service Mesh는 애플리케이션 서비스 수준의 보안이다. 둘 다 사용 가능한가? 그렇다. 계층이 다르므로 보완 관계다"를 삽입.
- **🔴 HIGH** `실습재현불가` _Section 2 '노드 하드닝'(L170-225), 특히 2.1 컨테이너 최적화 OS(L172-190)_
  - 문제: "Bottlerocket, Talos, Flatcar Container Linux"를 설명하지만 학생이 이 저장소의 dev/staging 클러스터(일반 Ubuntu/CentOS 기반)에서 "어떻게 이것을 실습하는가"가 없음. 이미지를 갈아 끼울 수 없으므로 "이론만 읽고 손으로 경험할 수 없다". 현재 클러스터에서 '불변 루트 파일시스템의 효과 대체 검증'(예: `mount | grep ro`)이나 '최소 OS의 공격 표면 축소 효과 비교'(예: 설치된 바이너리 개수) 실습을 추가해야 함.
  - 보강: 2.1 마지막에 '현재 dev 클러스터에서의 대체 실습' 섹션 추가: (1) 노드 SSH 접속 후 `mount | grep '/ '`로 루트 FS 쓰기 권한 확인 (2) `ls /usr/bin | wc -l`로 설치된 명령 개수 비교 (3) 보안 패치 적용 프로세스 이해(자동 업데이트 vs 수동). 또는 실습 클러스터의 노드 설정 파일을 열어 "kubelet 설정이 Bottlerocket/Talos 권장과 어떻게 다른가"를 비교 분석.
- **🟡 MED** `정확성오류` _1.3 Cilium L7 정책 예제(L124-148): YAML 구문_
  - 문제: endpointSelector와 ingress의 관계가 일반적인 NetworkPolicy와 동일하므로 CiliumNetworkPolicy만의 차이(L7 규칙)가 명확하지 않음. 특히 `toPorts[0].rules.http`에 method/path가 있지만 표준 NetworkPolicy는 이를 지원하지 않는다는 명시가 부족. 또한 '경로 정규식 `/api/v1/.*`이 정확하게 무엇을 매칭하는가'가 불명확.
  - 보강: 예제 YAML 아래에 주석 추가: "# Cilium만의 고급 기능: L7 HTTP 정규식 기반 필터링 (표준 NetworkPolicy는 L4 포트만)\n# /api/v1/.* = /api/v1로 시작하는 모든 경로(예: /api/v1/users, /api/v1/orders/123)\n# 정규식: POSIX extended regexp (ERE) 지원 -> . = 임의 문자, * = 0회 이상 반복". 또한 비교표를 만들어 "표준 NP는 포트 7500으로 가는 모든 트래픽 허용, Cilium은 같은 포트의 GET /api/v1/.*만 허용"을 명시.
- **🟡 MED** `이해난이도` _Section 3 '보안 시나리오 분석'(L266-319): 3가지 시나리오 간 난이도 편차_
  - 문제: 시나리오 1(컨테이너 탈출)은 'privileged: true -> chroot /host'로 초급자도 이해 가능하지만, 시나리오 3(공급망 공격)은 '이미지 스캔/서명/Admission Policy'를 순간에 이해해야 하는데, 이들이 Day 7에서 어디까지 다뤄졌는지 명시되지 않음. 학생은 '아, Day 7에서 Trivy·Cosign을 배웠구나'하고 넘어가야 하는데 명시적 연결이 없음.
  - 보강: 시나리오 3 첫 줄에 "[Day 7 복습] Trivy(정적 분석), Cosign(이미지 서명), Kyverno/Connaisseur(검증 정책) 참조"라는 하이퍼링크 추가. 또는 시나리오별 난이도 레벨(초급/중급/고급)을 명시해서 학생이 학습 순서를 조절하도록 안내.
- **🟡 MED** `정확성오류` _2.2 '노드 보안 설정'(L193-225): kubelet 보안 파라미터 목록_
  - 문제: L204-208에 나열된 파라미터(anonymous-auth, authorization-mode, read-only-port, rotateCertificates, protectKernelDefaults)가 실제로 kubelet config에서 몇 줄 위에 있어야 하는지(kind: KubeletConfiguration), 그리고 현재 dev/staging 클러스터에서는 어떻게 설정되어 있는지 검증되지 않음. CKS 시험은 이들을 수정하는 실기인데 현재 상태를 모르면 '어디를 고쳐야 하는가'를 못 찾음.
  - 보강: 2.2 마지막에 "현재 클러스터 kubelet 설정 확인" 섹션 추가: `ssh staging-master 'cat /var/lib/kubelet/config.yaml'` 명령으로 실제 값을 출력하고, "보안 권장값(anonymous-auth: false 등)과 비교"하는 실습 추가. 또는 "CKS 시험을 위한 점검 스크립트" 제시(예: grep anonymous-auth).
- **🟡 MED** `맥락점프` _2.3 '메타데이터 서비스 보안'(L227-262)과 1.0 등장 배경의 위협 모델 연결_
  - 문제: IMDS(169.254.169.254)가 갑자기 등장. "Pod 내 공격자가 IMDS 접근 -> IAM 자격 증명 탈취 -> 클라우드 리소스 접근"이 Day 7의 '어떤 위협 모델'인지(STRIDE 맵핑), 그리고 Day 8의 mTLS/노드 하드닝과 어떤 관계가 있는지 불명확. IMDS는 Credential Access(Day 7 9대 전술)인데 왜 Day 8 노드 하드닝 섹션에 들어가 있는가?
  - 보강: 2.3 도입에 "Day 7: MITRE ATT&CK의 Credential Access 위협 -> 이번엔 클라우드 환경에서의 구체적 사례"라는 연결 문장 추가. 또는 2.0 노드 하드닝 소개 섹션을 만들어 "노드 하드닝은 (1) OS 수준(Bottlerocket), (2) kubelet 설정, (3) 네트워크(IMDS 차단)의 3계층"이라고 명시.
- **🟡 MED** `용어비약` _2.2 '파일시스템 보안'(L215-219): AIDE, Tripwire 언급_
  - 문제: "파일 무결성 모니터링(AIDE, Tripwire)"이 무엇인지, 왜 필요한지, kubelet 인증서 변조를 어떻게 탐지하는지 설명 없음. 학부생은 이 도구들을 처음 본다.
  - 보강: "파일 무결성 모니터링(AIDE, Tripwire)"에 각주: "파일의 해시(md5/sha256) 스냅샷을 주기적으로 찍어서 변조 탐지. 예: kubelet 인증서가 악의적으로 수정되었는지 감시. AIDE(Advanced Intrusion Detection Environment) = 리눅스 표준 도구. 이 과정에서는 깊이 다루지 않지만 CKS 체크리스트로 인지"라는 설명 추가.
- **⚪ LOW** `스토리라인누락` _섹션 4 '시험 출제 패턴'(L323-343)_
  - 문제: 6가지 패턴만 나열되어 있고, 각 패턴이 시험의 어느 영역(이론/실기·개념/계산·실습)에 나타나는지 분류되지 않음. KCSA는 이론만이므로 모두 객관식이지만, 패턴 4-5(AppArmor/seccomp)는 실제로는 CKS(실기)에서 중요하다는 오류가 있음.
  - 보강: 패턴 4-6 옆에 "[CKS 실기]" 라벨 추가. 또는 "시험 팁: KCSA는 개념 이해와 암기(패턴 1-3), CKS 준비는 손 실습(패턴 4-6)"이라는 구분선 추가.
- **⚪ LOW** `이해난이도` _섹션 6 '핵심 암기 항목'(L639-658)_
  - 문제: 항목들이 서로 관련 없는 짧은 구절들(예: "Flannel: NetworkPolicy 미지원!")로 나열되어 있어, 학생이 "이게 왜 중요한가"를 모름. 또한 Flannel이 Day 8의 어디에 등장했는지 문서 전체에서 찾을 수 없음.
  - 보강: Flannel 언급 제거(또는 1.3에서 Cilium과 비교할 때 추가). 암기 항목을 "Day 8 핵심 기술" 카테고리로 재그룹화: (1)네트워크 보안(mTLS·Istio·Cilium), (2) 노드 하드닝(OS·kubelet·IMDS), (3) 방어 기술(PSA·RBAC·Falco). 각 항목 옆에 "[이론]", "[실기]", "[문제 예상]" 라벨 추가.

### daily/day09.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `용어비약` _§1.0 및 §1.1_
  - 문제: STRIDE, MITRE ATT&CK, 포렌식의 정의 없이 사용. 학부생이 보안 위협 모델을 모르면 '부인 방지'와 '부인 방지 불가'의 차이를 이해 못함.
  - 보강: 등장 배경에서 'STRIDE 모델(6가지 위협: Spoofing/Tampering/Repudiation/Information Disclosure/Denial of Service/Elevation of Privilege)의 Repudiation 위협이란 공격자가 자신의 행위를 부인할 수 있는 상황'이라는 1~2문장 정의 추가. MITRE ATT&CK는 실무 위협 매핑이므로 '공격자 전술·기법 분류'로 간단히 정의.
- **🔴 HIGH** `스토리라인누락` _§1.0~§1.5 (Audit Logging 파트)_
  - 문제: Audit Logging 이전 Kubernetes의 로깅 방식이 무엇이었는지, 그것의 한계가 뭐였는지 설명 없음. 학생은 '왜 4가지 레벨이 필요한가'를 모름.
  - 보강: 등장 배경 앞에 '이전 방식: API Server는 stdout으로 요청 로그만 기록했으며, 구조화되지 않아 파싱 어려움 + 세밀한 필터링 불가 + 민감 데이터(Secret)가 고대로 로그됨'을 추가. 그 다음 '4단계 레벨로 상세도를 조절함으로써 보안(민감 데이터 차단)과 추적성(사건 원인 파악)의 균형을 맞춤'을 연결.
- **🔴 HIGH** `맥락점프` _§1 (Audit) → §2 (Compliance 프레임워크)_
  - 문제: Audit Logging이 갑자기 5가지 프레임워크 비교로 점프. 두 부분의 인과관계가 없음. 학생은 'Audit이 왜 compliance와 연결되는가'를 모름.
  - 보강: §2 첫머리에 '규정 준수 프레임워크 개요' 섹션 추가: 'CIS/NIST/SOC 2/PCI DSS/GDPR은 모두 K8s 클러스터가 보안 요구사항을 충족하는지 감시·증명하기 위해 필수이다. Audit Logging은 이 모든 프레임워크의 핵심 도구이다(활동 기록 증빙, 감사 추적).'; 각 프레임워크의 '도입 배경·필수 조직'을 명시(예: PCI DSS는 신용카드 처리 기업 필수, SOC 2는 SaaS 기업이 고객 신뢰 증빙용).
- **🔴 HIGH** `스토리라인누락` _§2.1 ~ §2.5 (5가지 프레임워크)_
  - 문제: 각 프레임워크가 언제, 왜, 누가 만들었는지 배경 없음. CIS와 NIST의 관계(CIS는 NIST를 구현하는 구체 가이드인가?), 선택 기준도 불명확.
  - 보강: 각 프레임워크마다 '배경·대상·선택 기준' 단락 추가. 예: 'CIS Benchmark는 공개 커뮤니티(Center for Internet Security) 합의 기반 실무 가이드로, 빠른 자동화를 원하는 조직이 kube-bench로 즉시 점검하는 용도. NIST CSF는 미국 정부·금융기관을 위한 사이버보안 관리 프레임워크로, 조직 전체의 5단계 성숙도를 평가. PCI DSS는 신용카드 산업이 카드 데이터 보호를 강제하는 규정.'
- **🔴 HIGH** `실습재현불가` _§4.1 및 §4.2 (실습 1, 2)_
  - 문제: 명령만 나열하고 실제 스크린샷 없음. 텍스트 출력 블록(# dev 실측 섹션)이 CLAUDE.md §4①규약 위반(텍스트 블록은 금지, 스크린샷만). 학생이 실제 실행 후 자신의 출력과 비교할 기준 없음.
  - 보강: 각 실습 명령 아래에 실제 터미널 스크린샷 이미지 삽입(CLAUDE.md §7의 `scripts/capture-shot.sh`로 캡처). 텍스트 블록(```text) 모두 삭제.
- **🔴 HIGH** `실습재현불가` _§4 (tart-infra 실습)_
  - 문제: Audit Policy를 '읽기'만 하는 실습. 학생이 직접 policy.yaml을 작성하고 적용하는 실기 없음. CIS Benchmark도 점검만 하고 실제 위반 사항을 '고치는' 실습 없음.
  - 보강: '실습 3: Audit Policy 작성 및 적용' 추가 — 'dev 클러스터의 kube-apiserver에 audit policy를 설정하고, Secret 접근 로그를 Metadata 레벨로 제한한 후, 실제로 Secret을 get 했을 때 audit.log에 데이터가 포함되지 않음을 확인하라' (단계: policy.yaml 작성 → API Server 재시작 → Secret get → log 확인). '실습 4: CIS Benchmark 개선' 추가 — 'kube-bench를 실행해 FAIL 항목을 찾고, dev 클러스터에서 한 개 항목(예: authorization-mode=Node,RBAC 설정)을 직접 고쳐서 재점검하라.'; 각 실습의 '예상 소요 시간' 명시.
- **🔴 HIGH** `정확성오류` _§1.4 - Audit Policy omitStages_
  - 문제: Secret에 `omitStages: [RequestReceived]`가 있으나, 왜 이 단계만 생략하는지 설명 없음. 학생은 '어쨌 RequestReceived도 기록되나?' 혼동.
  - 보강: Policy 예시 옆에 각 `omitStages` 항목마다 '(이유: RequestReceived 단계는 요청만 기록하고 응답을 아직 모르므로 불필요한 중복 기록)' 같은 주석 추가. Secret의 경우 '본문에 민감 데이터가 있으므로 RequestReceived 단계도 기록 금지'로 명확히.
- **🟡 MED** `용어비약` _§2.3 (SOC 2)_
  - 문제: 'AICPA'를 '미국공인회계사협회'로만 번역. SOC 1/SOC 2의 구분(SOC 1은 경영 효과성 감시, SOC 2는 보안·가용성·무결성 통제)이 명시 안 됨. Type I/II 차이는 다이어그램에만 있고 문자 설명 부족.
  - 보강: 'SOC 2는 AICPA(미국공인회계사협회)가 정의한 서비스 조직의 통제를 평가하는 기준으로, 경영·재무 감시인 SOC 1과 달리 보안·가용성·무결성을 중심으로 독립 감사를 받는 인증.'으로 확장. Type I('특정 시점의 통제 설계가 적절한가 평가, 감사 기간 수일') / Type II('6~12개월 운영 기간 동안 통제가 실제로 잘 작동했는가 평가, 더 높은 신뢰도')로 문자 설명 추가.
- **🟡 MED** `용어비약` _§2.4 (PCI DSS)_
  - 문제: '카드회원 데이터(CHD)'를 정의했으나, 'PCI DSS가 왜 필수인가'(역할·책임)를 모른 학생은 'K8s에서 PCI DSS를 어떤 상황에 적용하는가'를 모름.
  - 보강: 'PCI DSS는 신용카드 처리·저장·전송 사업자가 법적으로 반드시 준수해야 하는 표준이다. K8s 클러스터에서 카드 데이터를 다루는 애플리케이션이 돌아간다면 PCI DSS 12가지 요구사항이 전부 클러스터 설정에 반영되어야 한다.'로 맥락 추가.
- **🟡 MED** `맥락점프` _§2.1 (CIS Benchmark)_
  - 문제: 'CIS Benchmark'와 'kube-bench 도구'의 관계가 불명확. CIS가 뭔지(조직? 표준?) 설명 없음. 합의 기반(consensus-based)이 무엇인지도 모호.
  - 보강: 'CIS(Center for Internet Security)는 정부·업계 전문가들이 합의로 작성한 보안 가이드라인을 공개하는 비영리 조직이다. Kubernetes Benchmark는 그 가이드이고, kube-bench는 이 표준을 자동으로 점검하는 오픈소스 도구다(Aqua Security). kube-bench 실행 결과는 PASS/FAIL/WARN/INFO로 표시되며, 실무에서는 정기적으로 이 도구를 실행해 클러스터 보안 설정 준수도를 자동 확인한다.'로 3문장 연결.
- **🟡 MED** `이해난이도` _§1.4 - Audit Policy YAML 구조_
  - 문제: `resources`, `nonResourceURLs`, `userGroups`, `verbs` 4가지 필터가 혼재되어 있고, AND/OR 결합 로직이 명시 안 됨. Metadata만 기록할 규칙과 None으로 제외할 규칙이 순서 의존적(첫 매칭 규칙 우선)임을 강조 부족.
  - 보강: YAML 예시 전에 '규칙 처리 흐름(Audit Policy는 rules 배열을 위에서 아래로 순회하며 첫 번째로 매칭되는 규칙을 적용하고 나머지는 무시한다. 따라서 None 규칙을 먼저 배치해 노이즈를 먼저 걸러낸다.)' + 필터 AND 로직('resources + verbs + users 조건을 모두 만족하는 요청만 이 규칙 적용') 명시. 예: '헬스 체크(nonResourceURLs: /healthz*) 규칙이 None이고 먼저 나오므로, /healthz 요청은 어떤 레벨이든 로그되지 않는다.'
- **🟡 MED** `이해난이도` _§1.5 - API Server 플래그_
  - 문제: 4가지 플래그(audit-log-path, audit-policy-file, audit-log-maxage, audit-log-maxbackup, audit-log-maxsize)가 나열되었으나 각각의 영향(예: maxsize=100MB이면 로그 순환 기간은 얼마인가?)을 설명 안 함.
  - 보강: 각 플래그 옆에 '설정값의 의미와 영향' 추가. 예: '-- audit-log-maxage=30: 30일 이상 된 로그 파일 자동 삭제, 저장 공간 절약. 규제 요구사항에서 '최소 90일 보관' 같은 기준이 있다면 maxage=90으로 설정.' '-- audit-log-maxsize=100: 한 파일이 100MB에 도달하면 새 파일로 순환, 단일 파일 크기 제한으로 I/O 효율 향상.'
- **🟡 MED** `맥락점프` _§3 (핵심 암기 항목)_
  - 문제: 4개 섹션(Audit Logging, Compliance, 기타)이 갑자기 나타나고, day09의 학습 목표와 각 섹션의 관계가 불명확. 학생은 '뭐가 제일 중요한 거야?'라고 물을 수밖에 없음.
  - 보강: §3 첫머리에 '자격증 출제 비중·난도 기준으로 암기 순서' 추가. 예: 'KCSA 시험에서 Audit 4레벨은 매년 1~2문제 출제(확률 높음), Compliance 프레임워크는 3~5문제 출제되므로 프레임워크 간 차이점(Type I/II, 5기능 등)을 먼저 암기하면 점수 효율이 높다.'
- **⚪ LOW** `스토리라인누락` _§2.5 (GDPR)_
  - 문제: GDPR이 EU 법이지만, 글로벌 기업도 적용되는 이유(역외적용, 개인 데이터 주체의 위치 기준)가 없음. 학생은 'K8s를 한국에서 운영하면 GDPR을 신경 써야 하나?' 혼동.
  - 보강: 'GDPR은 EU 거주자의 개인정보를 처리하는 모든 조직(위치 무관)에 적용되므로, 한국 기업도 EU 고객 데이터를 다루면 GDPR을 준수해야 한다(역외적용). K8s 관점에서는 데이터 암호화, RBAC로 최소 권한 접근, Audit Log로 접근 기록 추적이 필수.'로 1~2문장 추가.

### daily/day10.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `용어비약` _문제 1(4C 모델), 문제 3(Zero Trust), 문제 10(kms v2), 문제 22(Encryption at Rest)_
  - 문제: 첫 등장하는 용어(4C 모델의 4개 계층, NetworkPolicy, KMS, Encryption at Rest)가 정의/풀이 없이 사용됨. 학부생이 사전지식 없이 읽으면 답을 고를 수 없음.
  - 보강: 각 도메인(Overview/Cluster/Fundamentals 등) 시작 전에 '이 섹션의 핵심 용어 정의' 박스 추가. 예: [Overview] 섹션 앞에 '4C 모델=Cloud(외부)/Cluster(K8s)/Container(컨테이너)/Code(소스)의 4개 보안 계층' 한 줄 추가.
- **🔴 HIGH** `스토리라인누락` _전체 50문제, 특히 문제 8(API Server 흐름), 17(Static Pod), 30(MITRE), 31(SLSA)_
  - 문제: 각 기술의 등장 배경(왜 필요한가), 직전 기술의 한계, 무엇이 나아졌는가, 트레이드오프가 전혀 없음. 학생이 '이 개념은 실제로 언제/왜 쓰나' 이해할 수 없음.
  - 보강: 각 문제의 정답 아래에 '개념 해석' 1~2문장 추가. 예: 문제 8(API Server 순서) → '정답: C. 순서를 지켜야 하는 이유는 인증 없는 요청을 거부하기 위해, 미인가 사용자가 API를 호출해도 먼저 신원을 확인하고 권한을 검증하기 때문이다.'
- **🔴 HIGH** `이해난이도` _Fundamentals(문제 19-29: RBAC/NetworkPolicy/PSA), Threat(문제 30-37: MITRE/SLSA/Falco)_
  - 문제: 선수 개념 설명 없이 기술이 등장. 예: 문제 19에서 ClusterRole, RoleBinding 용어가 정의 없이 사용됨. 문제 20에서 'PSS Restricted'가 무엇인지 설명 없음. 학생이 이전 day 학습을 안 하면 절반 이상 문제를 풀 수 없음.
  - 보강: 각 도메인의 맨 처음에 '이 섹션의 선수 개념' 섹션 추가. 예: [Fundamentals] 섹션 앞에 'RBAC=Role-Based Access Control로 사용자에게 권한을 할당하는 메커니즘' 1~2줄 설명.
- **🔴 HIGH** `맥락점프` _도메인 간 연결(Cluster→Fundamentals: API Server 인가→RBAC, Fundamentals→Threat: Pod 정책→런타임 공격)_
  - 문제: 각 도메인이 독립적으로 제시되어 개념 간 연결성이 없음. 예: 문제 9(authorization-mode: Node,RBAC)와 문제 19(RBAC ClusterRole)는 같은 RBAC 기술이지만 분리되어 '어떻게 함께 작동하는가' 설명이 없음.
  - 보강: 섹션 3의 '핵심 암기 항목'처럼, 문제 풀기 전에 '개념 지도' 흑백 다이어그램 추가. 예: 'API Server 요청 → 인증(사용자 확인) → 인가(RBAC로 권한 확인) → Admission(정책 검증)' 흐름도를 mermaid로 표시.
- **🔴 HIGH** `실습재현불가` _섹션 5 'tart-infra 실습'(993-1040줄): 실습 1·2의 bash 커맨드와 기대 출력_
  - 문제: 실습 커맨드의 출력이 텍스트 블록으로 삽입되어 있고('```text'), 실제 tart 클러스터에서 실행한 스크린샷이 아님(CLAUDE.md §4①의 규칙 위반). '기대 출력'은 실제 실행 결과가 아니라 추측일 가능성 높음. 학생이 자신의 개발 환경에서 따라 해도 출력이 다르면 검증 불가.
  - 보강: 실습 1·2를 실제 tart dev 클러스터에서 실행하고, 터미널 스크린샷 이미지로 교체. 각 커맨드 아래에 '실제 출력(스크린샷)' 이미지 삽입. 텍스트 블록 대신 'kubectl ... | wc -l'의 결과를 실제 캡처로 보여주기.
- **🔴 HIGH** `구조` _day10.md 전체 구조_
  - 문제: 이 파일은 'KCSA 종합 모의시험'인데, 각 문제가 day 1-9의 학습을 전제함. 하지만 day 1-9 문서가 미완성 상태(CLAUDE.md의 '§11 현황')이므로, 이 파일 단독으로는 '개념 이해 + 실습 재현'이 불가능. 학부생이 day10만 읽고 자격증 문제를 풀 수 없음.
  - 보강: day10.md를 'day 1-9 최종 검증'으로 재정의하고, 각 문제에 '이 문제는 day N에서 학습한 내용 기반'이라는 주석 추가. 또는 '독립 실행 모의시험'을 목표하려면, 각 도메인마다 '개념 미니강의' 1~2페이지를 섹션 1 전에 삽입.
- **🟡 MED** `정확성오류` _문제 10(kms v2), 문제 20(readOnlyRootFilesystem), 문제 28(Flannel NetworkPolicy)_
  - 문제: 문제 10: 'kms v2가 프로덕션 권장'이라 하지만, 많은 프로덕션이 여전히 aescbc/aesgcm 사용. 문제 20: readOnlyRootFilesystem이 '필수 아님'인데, 실제로는 데이터 지속성이 필요한 Pod에서는 적용 불가능한 경우가 많음(왜 필수 아닌지의 배경 없음). 문제 28: Flannel이 'NetworkPolicy 미지원'이라 하지만, CNI는 네트워킹만 제공하고 정책 구현은 별개 컴포넌트라는 설명 부족.
  - 보강: 문제 10: '(K8s 1.27+에서 권장, 기존 프로덕션은 aesgcm 사용)' 추가. 문제 20: '(컨테이너는 로그를 /tmp나 emptyDir에 쓰는 경우가 많아 필수 아님)' 배경 추가. 문제 28: '(Flannel은 오버레이 네트워킹만 제공하며, NetworkPolicy 구현은 Cilium·Calico 같은 정책 엔진 필요)' 명확히 함.
- **🟡 MED** `이해난이도` _문제 22(Secret 저장 방식), 문제 23(automountServiceAccountToken)_
  - 문제: 정답 설명이 너무 간결해 학부생이 맥락을 못 이해. 예: 문제 22에서 'Base64 인코딩(평문)'이라 하는데, 학생이 'etcd에 평문 저장된다'는 의미를 못 알 수 있음. 문제 23에서 '토큰 탈취 위험'이라 하지만, 어떤 시나리오에서 탈취되고 피해가 무엇인지 불명.
  - 보강: 각 정답 설명에 '왜' 1문장 추가. 문제 22: 'Base64 인코딩은 암호화가 아니므로 etcd에 저장될 때 평문 상태. 누군가 etcd 데이터베이스 파일에 접근하면 Secret을 읽을 수 있다.' 문제 23: 'ServiceAccount 토큰은 Pod 내 /run/secrets 에 저장되는데, 만약 Pod가 해킹되면 공격자가 이 토큰으로 API Server에 접근해 다른 리소스를 조회/삭제할 수 있다.'
