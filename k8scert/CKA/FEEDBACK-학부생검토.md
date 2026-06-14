# CKA 교재 — 학부 3~4학년 관점 검토 피드백

> 생성: 2026-06-12 · 방식: 파일당 1 에이전트 병렬 검토(25개 전부) · 기준: [CLAUDE.md](CLAUDE.md) §4④(스토리라인·학부생 가독성)
> 평가 질문: **"K8s 사전지식 없는 컴퓨터공학 3~4학년이 이 파일만 읽고 ⓐ이해 ⓑ실습재현 ⓒ자격증 문제풀이가 가능한가?"**

## 종합 결론

- **단독 합격 가능(passable) 파일: 4/25** — 대부분 이 한 파일만으로는 부족하다.
- 평균 가독성 **2.9/5**, 평균 스토리라인 **2.4/5**.
- 부족분 총 **231건** (HIGH 86 / MED 98 / LOW 47).
- HIGH 카테고리: 스토리라인누락 28, 용어비약 26, 실습재현불가 14, 이해난이도 7, 맥락점프 6, 정확성오류 4, 구조 1

### 가장 큰 약점 (공통 패턴)
1. **스토리라인 누락**(최다) — '왜 이 기술이 등장했나, 직전 기술(kube-proxy iptables·Docker·ZooKeeper·PSP 등)의 한계, 무엇이 어떻게 나아졌나, 트레이드오프'가 빠져 기술이 맥락 없는 토막 지식으로 제시됨.
2. **용어 비약** — Cilium·eBPF·declarative/reconciliation·Linux namespace·Raft·quorum·CRI·gRPC·WAL·IPVS 등 핵심 용어가 첫 등장 시 풀이 없이 사용됨.
3. **실습 재현 불가** — 전제조건(클러스터 가동·kubeconfig 경로·앞 산출물·인증서 경로 의미)이 명시 안 돼 학생이 그대로 따라 할 수 없음.

### 파일별 점수

| 파일 | 단독합격 | 가독성 | 스토리라인 | HIGH/MED/LOW |
|:--|:--:|:--:|:--:|:--:|
| 01-concepts.md | ✅ | 4 | 4 | 1/4/4 |
| 02-examples.md | ❌ | 3 | 2 | 5/7/3 |
| 03-exam-questions.md | ❌ | 2 | 1 | 2/0/1 |
| 04-tart-infra-practice.md | ❌ | 2 | 2 | 5/0/0 |
| 05-supplement.md | ✅ | 4 | 4 | 0/2/2 |
| daily/day01.md | ❌ | 3 | 2 | 4/8/2 |
| daily/day02.md | ❌ | 3 | 2 | 4/3/0 |
| daily/day03.md | ❌ | 3 | 3 | 7/6/4 |
| daily/day04.md | ❌ | 2 | 2 | 5/5/2 |
| daily/day05.md | ✅ | 4 | 4 | 0/2/4 |
| daily/day06.md | ❌ | 3 | 2 | 3/6/1 |
| daily/day07.md | ❌ | 3 | 3 | 2/7/4 |
| daily/day08.md | ❌ | 3 | 2 | 4/4/2 |
| daily/day09.md | ✅ | 3 | 2 | 3/6/2 |
| daily/day10.md | ❌ | 2 | 1 | 5/4/2 |
| daily/day11.md | ❌ | 4 | 3 | 2/3/0 |
| daily/day12.md | ❌ | 3 | 2 | 3/3/1 |
| daily/day13.md | ❌ | 3 | 3 | 6/6/1 |
| daily/day14.md | ❌ | 2 | 2 | 3/1/2 |
| daily/day15.md | ❌ | 4 | 4 | 2/5/4 |
| daily/day16.md | ❌ | 3 | 2 | 5/4/4 |
| daily/day17.md | ❌ | 2 | 2 | 4/3/0 |
| daily/day18.md | ❌ | 2 | 1 | 4/4/1 |
| daily/day19.md | ❌ | 3 | 2 | 3/4/1 |
| daily/day20.md | ❌ | 3 | 2 | 4/1/0 |

---

## 파일별 상세 부족분

### 01-concepts.md  · 가독성 4/5 · 스토리라인 4/5 · 단독합격 ✅

**잘된 점:** 각 절의 등장배경(Background) 섹션이 명확히 기술되어 직전 기술(예: ABAC→RBAC, kube-dns→CoreDNS, docker→CRI)의 한계를 구체적으로 설명하여 스토리라인이 탄탄하다. / 내부 동작(Internal Operation) 수준의 설명이 깊다: iptables 체인 구조, scheduler filtering/scoring 플러그인, CNI 표준, cgroup 메커니즘 등을 상세히 다루어 학부생이 개념의 '왜'를 이해할 수 있다. / 검증 명령어를 각 섹션에 포함하고, 예상 출력(기대 출력 예시)을 텍스트로 제시하여 실제 동작을 추적할 수 있도록 구성했다.

- **🔴 HIGH** · `정확성오류` · _§2.2 nodeSelector (line 1130-1155)_
  - 문제: nodeSelector 설명 코드 블록의 예시 명령어 line 1148이 완성되지 않음: '`kubectl get nodes --show-labels | grep disktype`' 뒤에 기대 출력이 line 1151-1154 범위인데, 실제로는 노드의 레이블을 확인하는 명령 출력(예: `node01` 행의 레이블 목록)이어야 한다. 현재 출력이 한 줄 요약처럼 보여 정보가 부족하다.
  - 보강: 명령어와 기대 출력을 명확히 분리. 예: 첫 번째 블록에 '```bash\nkubectl label nodes node01 disktype=ssd\n```', 두 번째 블록에 '```text\nnode/node01 labeled\n```', 세 번째에 '```bash\nkubectl get nodes --show-labels | head -3\n```', 네 번째에 해당 노드의 전체 레이블 출력을 제시.
- **🟡 MED** · `용어비약` · _§1.1 Control Plane 구성 요소 (line 19-26)_
  - 문제: apiserver의 역할을 '모든 API 요청의 진입점'으로만 정의하고, 학생이 apiserver 없이는 클러스터가 왜 죽는지 이해하기 어렵다. 또한 '인증, 인가, admission control'이라는 용어가 본 문서에서 첫 등장하는데 각각 한 줄 풀이가 없다.
  - 보강: 테이블 하단에 주석 추가: '특히 etcd로의 쓰기 통로를 독점하므로, apiserver가 다운되면 Pod 생성/업데이트/삭제 같은 상태 변경 작업 전부가 불가능하다.' 또한 용어를 표로 정의: 인증(클라이언트 신원 확인), 인가(권한 검사), admission(추가 검증 및 변경).
- **🟡 MED** · `스토리라인누락` · _§2.2 Pod Affinity/Anti-Affinity (line 1210-1250)_
  - 문제: Pod Affinity와 Anti-Affinity가 '무엇'인지는 설명했으나, 왜 nodeSelector/Node Affinity만으로 부족했는지(Pod 간 관계를 정의할 수 없음), 언제 필요한지(예: 캐시 pod를 웹 서버와 가까운 노드에) 명시하지 않았다. 학생이 '이것이 실전에서 쓰는 상황'을 상상하기 어렵다.
  - 보강: 섹션 도입부에 구체 시나리오 추가: '웹 서버(nginx)의 응답성을 높이려면 가까운 노드의 캐시 서버(redis)와 함께 배치해야 한다(데이터 지역성). 이를 코드화한 것이 podAffinity이다.'
- **🟡 MED** · `이해난이도` · _§3.2 Ingress (line 1779-1934)_
  - 문제: Ingress의 구조를 PathType(Exact/Prefix), pathType의 정규식 동작, IngressClass, Ingress Controller의 관계까지 곧 나열했는데, 학생이 '이것들이 왜 나누어져 있는가'를 모르면 혼란스럽다. 특히 IngressClass와 Ingress Controller의 관계가 명확하지 않다.
  - 보강: Ingress 아키텍처 다이어그램(mermaid) 추가: User → Internet → IngressController (nginx pod) → Service → Pod. 그리고 '각 Ingress Controller(nginx, traefik 등)는 클러스터에 따로 설치되어야 하며, 여러 controller를 설치한 경우 IngressClass로 어떤 controller가 규칙을 처리할지 지정한다'는 문장 추가.
- **🟡 MED** · `맥락점프` · _§3.5 CNI (line 2247-2289)_
  - 문제: CNI가 '왜' 필요한지 설명(쿠버네티스 네트워크 모델의 요구사항)했지만, '그 전에는 어떻게 했나'(각 클라우드/온프레미스가 별도 구현) 또는 'kubeadm이 CNI를 자동 설치하지 않는 이유'를 설명하지 않았다. 학생이 'why init 후에 노드가 NotReady인가'를 처음 배울 때 혼란스럽다.
  - 보강: 등장배경 섹션 뒤에 '이전: 각 클라우드/온프레미스 제공자가 자체 네트워킹 구현 → kubeadm은 이 부분을 선택 가능하게 설계했으므로, 반드시 사후에 CNI 플러그인을 별도 설치해야 한다'고 추가.
- **⚪ LOW** · `용어비약` · _§2.4 QoS (line 1364-1383)_
  - 문제: QoS 클래스의 정의(Guaranteed/Burstable/BestEffort)와 축출 우선순위는 설명했지만, '왜' 이런 구분이 필요한지(노드 메모리 부족 시 어떤 Pod부터 죽일지 결정하는 메커니즘) 먼저 설명하지 않았다.
  - 보강: 섹션 도입: '노드의 메모리가 부족해지면 kubelet이 일부 Pod를 강제 종료(eviction)해야 한다. 이때 모든 Pod를 동등하게 취급할 수는 없으므로 우선순위가 필요하다. requests/limits 설정 여부에 따라 QoS 클래스를 자동 할당하고, 이를 축출 우선순위로 삼는 것이 이 메커니즘의 핵심이다.'
- **⚪ LOW** · `실습재현불가` · _§1.4 etcd 백업과 복구 (line 534-683)_
  - 문제: etcd 백업 명령어는 정확하나, 기대 출력 블록들이 모두 텍스트로 제시되어 있다(CLAUDE.md §4① 규칙 위반: 실제 터미널 스크린샷이어야 함). 특히 line 606-610의 'Snapshot saved' 출력이나 line 617-623의 'snapshot status' 테이블 출력은 실제 클러스터에서 캡처해야 한다.
  - 보강: CLAUDE.md 규칙 §4① 따라 실제 클러스터(staging)에서 etcdctl 명령을 직접 실행하고 터미널 스크린샷으로 제시. 각 명령 블록 아래에 '![](images/etcd-backup-output.png)' 등으로 이미지 삽입.
- **⚪ LOW** · `스토리라인누락` · _§3.3 NetworkPolicy (line 1937-2137)_
  - 문제: Default Deny 패턴을 설명했으나, 'Egress 차단 시 DNS가 함께 차단되는 이유'와 '왜 CoreDNS는 별도로 허용해야 하는가'를 학생이 직관적으로 이해하기 어렵다. DNS가 UDP 53이라는 기술적 정보만 있고, DNS의 역할(Service 이름 해석)을 먼저 연결하지 않았다.
  - 보강: 주의 문단 앞에 한 줄: '**중요**: 모든 아웃바운드 트래픽을 차단하면, Pod 내에서 `kubectl get svc` 같은 Service 조회도 추가가 되지 않아 실패한다. 따라서 최소한 kube-system 네임스페이스의 CoreDNS 통신은 별도로 허용해야 한다.'
- **⚪ LOW** · `이해난이도` · _§4.2 PV/PVC 바인딩 조건 (line 2408-2429)_
  - 문제: 바인딩 조건을 나열만 했는데, '왜 1:1 바인딩인가(10Gi PV에 5Gi 요청하면 남은 5Gi를 못 쓰는 이유)'를 설명하지 않았다. 학생이 'PVC를 여러 개 만들어 같은 PV에 부분 마운트할 수는 없나'라는 의문을 가질 수 있다.
  - 보강: 조건 4 아래에: '이 1:1 바인딩 정책의 이유는 PV와 PVC가 각각 다른 스토리지 백엔드(예: EBS 볼륨, NFS share)를 나타낼 수 있으므로, 용량을 분할하여 여러 PVC에 바인딩하면 데이터 격리와 성능 보장이 복잡해지기 때문이다.'

### 02-examples.md  · 가독성 3/5 · 스토리라인 2/5 · 단독합격 ❌

**잘된 점:** 각 섹션의 명령 예제가 실제 실행 가능한 형태로 정리됨 / 기본 개념부터 고급 설정까지 체계적인 계층 구조 / 필드별 상세 설명이 대부분 포함되어 있음

- **🔴 HIGH** · `스토리라인누락` · _§1.1 kubeadm / 전체_
  - 문제: 쿠버네티스 없이 처음 배우는 학생이 '왜 kubeadm이 나왔는가'를 이해할 수 없음. 문서가 '이전에는 어떤 방식인가' → '그 한계는 무엇인가' → '무엇이 나아졌는가'를 설명하지 않아 context-free 기술 목록처럼 읽힘.
  - 보강: 등장 배경 섹션(§1.1, line 11-13)을 확장: (1) kubeadm 이전: 관리자가 etcd/kube-apiserver/kubelet을 바이너리로 설치, 인증서/systemd 수동 관리 → 오류 빈번. (2) 직전 기술: kubernetes.io 공식 바이너리 설치 또는 kops 같은 도구가 일부 자동화하지만 여전히 상세함. (3) 나아진 점: kubeadm이 선언형 인터페이스로 preflight 검사, CA/인증서 자동 생성, Static Pod 자동 배치. (4) 트레이드오프: 표준화되지만 Custom CA나 고급 HA 구성은 여전히 수동. 이 4단계를 명시적으로 쓸 것.
- **🔴 HIGH** · `용어비약` · _§1.1, line 72-76 (br_netfilter, iptables, kube-proxy)_
  - 문제: 학생이 컨테이너 네트워킹 기초가 없다면 'br_netfilter는 브리지 네트워크를 통과하는 패킷이 iptables 규칙을 받도록 한다'는 문장이 너무 높은 추상화. 'iptables'는 뭔지, '브리지'는 뭔지, '규칙'이 정확히 뭔 규칙인지 설명 없음.
  - 보강: 다음과 같이 확장 설명 필요: 'br_netfilter 모듈이 없으면, 같은 물리 네트워크(Linux bridge)를 통과하는 패킷이 리눅스 커널의 패킷 필터링 시스템(iptables)을 거치지 않는다. kube-proxy는 Service IP 대 Pod IP 변환 규칙(DNAT)을 iptables에 등록하는데, 이 규칙이 활성화되지 않으면 Pod 간 통신이 라우팅되지 않는다. 따라서 필수다.'
- **🔴 HIGH** · `스토리라인누락` · _§1.2 클러스터 업그레이드_
  - 문제: 업그레이드 절차의 8단계 명령이 나열되어 있지만, '왜 drain 후에 kubelet을 업그레이드해야 하는가' '왜 Control Plane을 먼저 올리고 Worker를 나중에 올리는가'에 대한 설명이 전무. 학생이 단순 '따라하기'만 하고 원리를 모름.
  - 보강: 업그레이드 섹션 시작에 '호환성과 다운타임' 섹션 추가: (1) kube-apiserver v1.31은 kubelet v1.29~1.31을 지원하므로, Worker kubelet이 Control Plane보다 2단계 뒤떨어져도 된다는 보장. 역은 불가 → Control Plane 먼저 올려야 함. (2) drain은 새 버전 Control Plane이 기존 Pod 스케줄링 정책을 이해하기 위함. (3) daemon-reload는 systemd가 새 바이너리를 인식하도록 하는 것(이 부분이 없으면 kubelet이 이전 버전으로 실행).
- **🔴 HIGH** · `실습재현불가` · _§1.2, line 224-246 (kubeadm upgrade plan, upgrade apply)_
  - 문제: 명령만 나열되어 있고 실제 출력 스크린샷이 없음. 학생이 '출력이 정확히 어떻게 나와야 하는가'를 알 수 없어 중간에 오류가 나도 진단 불가. 특히 'kubeadm upgrade apply'가 성공했는지 실패했는지 구분하려면 실제 터미널 화면을 봐야 함.
  - 보강: CLAUDE.md §4① 규칙대로, 각 주요 명령 후에 실제 클러스터에서 실행한 터미널 스크린샷 PNG 이미지 첨부. "```text" 텍스트 블록 사용 금지. (이미지는 manifests/ 또는 k8scert/CKA/images/ 에 저장)
- **🔴 HIGH** · `스토리라인누락` · _§2.1 Deployment / line 749-753_
  - 문제: Deployment 등장 배경이 '초기에는 ReplicationController → kubectl rolling-update → Deployment'라고 간단히 설명되어 있지만, ReplicationController의 한계가 무엇인지(클라이언트 측 업데이트, 네트워크 끊김 시 중단)가 너무 짧음. 학생이 '왜 서버 측이 중요한가'를 이해 못함.
  - 보강: 다시 쓸 것: '초기 ReplicationController + kubectl rolling-update는 클라이언트가 직접 개별 Pod를 순차 생성/삭제했다. 클라이언트 네트워크 끊김 → 롤링 업데이트 중단 → 일부 Pod는 old version, 일부는 new version → 불안정. Deployment는 서버(Controller Manager) 쪽에서 롤링 업데이트 상태를 관리하므로, 클라이언트가 끊겨도 계속 진행된다.'
- **🟡 MED** · `용어비약` · _§2.1, line 820-827 (resources.requests/limits, QoS)_
  - 문제: requests와 limits의 차이는 설명되지만, '스케줄러가 Pod를 노드에 배치할 때 참조'한다는 표현이 추상적. 학생이 '구체적으로 어떻게 참조하는지' 못 알아들음.
  - 보강: 다시 쓸 것: 'requests는 스케줄러의 Predicates 단계에서 노드의 가용 리소스(allocatable - reserved - requested)와 비교된다. 예: 노드의 allocatable 메모리 8Gi에서 system reserve 1Gi를 뺀 7Gi 중에서, 이미 요청된 Pod들의 requests 합(예: 5Gi)을 더하면, 남은 가용 메모리는 2Gi다. 새 Pod가 3Gi를 requests하면, 이 노드에는 스케줄링될 수 없다.'
- **🟡 MED** · `정확성오류` · _§3.1 Service / line 1680-1681_
  - 문제: ClusterIP 설명에 '생략 시 기본값은 `ClusterIP`'라고 했지만, NodePort와 LoadBalancer는 언제 쓰는지 비교가 없음. 학생이 3가지 타입의 용도 차이를 모름.
  - 보강: 서비스 타입 비교표 추가: | 타입 | 범위 | 포트 범위 | 사용 사례 | — | ClusterIP | 클러스터 내부 | 1-65535 | Pod 간, 내부 서비스 | NodePort | 클러스터 외부(노드 IP) | 30000-32767 고정 | 개발/테스트, external client | LoadBalancer | 클라우드 LB IP | 1-65535 | 프로덕션 public 서비스 |
- **🟡 MED** · `맥락점프` · _§3.2 Ingress / line 1789-1791_
  - 문제: Ingress 등장 배경이 '포트 범위 제한' '로드밸런서 비용'이라고 설명되지만, Service로 충분한 경우가 많은데 Ingress가 '언제' '왜' 필요한지 구체적 상황이 부족. 학생이 Ingress의 필요성을 못 느낌.
  - 보강: 시나리오 추가: '마이크로서비스 5개(auth, api, web, payment, admin)가 있고, 클라우드 환경에서 각각 LoadBalancer Service를 만들면 Public IP 5개 × 월 비용 = 수백 달러. 하지만 Ingress는 단일 LoadBalancer 뒤에 7계층 라우터를 놓아 호스트명/경로로 분기(auth.example.com → auth-svc, example.com/api → api-svc, ...)하므로 Public IP 1개 + Ingress 비용만 필요 → 비용 절감.'
- **🟡 MED** · `용어비약` · _§3.3 NetworkPolicy / line 1965-1967_
  - 문제: NetworkPolicy 등장 배경이 '하나의 Pod가 침해되면 횡적 이동 가능'이라고만 했는데, 학생이 '구체적으로 뭐가 문제인가' 못 알아들음. 보안 개념(lateral movement)이 생소함.
  - 보강: 구체 사례 추가: '예: frontend Pod가 침해되면, 공격자는 클러스터 내 모든 Pod IP(10.244.x.x)와 통신 가능하므로, database Pod의 MySQL 3306 포트를 무작정 스캔할 수 있다. database 암호 노출 시 데이터 전체 탈취. NetworkPolicy가 없으면 방어 불가.'
- **🟡 MED** · `실습재현불가` · _§4.1 PV/PVC / line 2291-2300_
  - 문제: 검증 섹션에서 PV/PVC 바인딩 상태를 나타내는 테이블 출력이 있지만, 실제 터미널 스크린샷 없음. 학생이 '실제 화면에서는 어떤 정렬로 나오나, 컬럼 너비는 어느 정도인가' 못 봄.
  - 보강: 실제 클러스터에서 `kubectl get pv,pvc` 실행 후 PNG 스크린샷 첨부.
- **🟡 MED** · `스토리라인누락` · _§4.2 StorageClass / line 2330-2335_
  - 문제: Dynamic Provisioning 등장 배경이 'Static vs Dynamic'의 차이만 설명되지만, 왜 프로덕션에서 Dynamic이 필수인지(수동 관리의 오버헤드, 확장성)에 대한 설명 부족.
  - 보강: 추가: 'Static의 문제: 관리자가 PV를 미리 10개 만들어 놓으면, 개발자가 11번째 PVC를 요청할 때 대기. Dynamic은 PVC 요청 시 자동으로 스토리지 프로비저닝(AWS EBS 디스크 생성 등)하므로, 수동 개입 없이 확장 가능.'
- **🟡 MED** · `용어비약` · _§4.3 StatefulSet / line 2451-2456_
  - 문제: volumeClaimTemplates 설명이 '각 Pod에 대해 별도의 PVC를 자동 생성'이라고만 되어 있고, '왜 이게 필요한가'에 대한 context 부족.
  - 보강: 추가: '이유: mysql-0 Pod가 재시작될 때 동일한 이름(mysql-0)과 동일한 PVC(data-mysql-0)에 바인딩되므로, 이전 스토리지의 데이터를 그대로 사용할 수 있다. 이를 통해 데이터베이스의 일관성과 순서가 보장된다. Deployment는 이 보장이 없으므로, 상태(stateful) 워크로드에는 부적합.'
- **⚪ LOW** · `용어비약` · _§2.2 nodeSelector / line 950-951_
  - 문제: nodeSelector가 '단순 노드 선택'이라고만 하는데, 'labels'라는 용어가 학생 입장에서는 처음 나옴. Pod와 Node에 label이 어떻게 붙는지 전 단계가 부족.
  - 보강: 먼저 'Kubernetes의 레이블 시스템' 소절 추가: '쿠버네티스의 모든 오브젝트(Pod, Node, Service ...)에는 key=value 형태의 메타데이터(label)를 자유롭게 붙일 수 있다. 이 label로 오브젝트를 선택한다(selector). 예: 노드에 disktype=ssd를 붙이고, Deployment Pod에 "이 노드를 선호한다" 같은 nodeSelector를 쓸 수 있다.'
- **⚪ LOW** · `구조` · _§5 트러블슈팅 / 전체_
  - 문제: 트러블슈팅 섹션이 섹션 5에 홑딱 튀어나와 있는데, 앞의 1-4 섹션과의 연결고리가 약함. 학생이 '이게 언제 필요한가'를 모름.
  - 보강: 각 섹션(1-4) 말미에 '## 트러블슈팅' 소절을 넣고, 섹션 5는 '전체 클러스터 상태 진단 치트시트'로 재구조화할 것. 또는 섹션 1-4 내에 장애 시나리오 테이블을 이미 포함하고 있으니, 섹션 5는 '추가 고급 진단 도구'로 제목을 명확히 할 것.
- **⚪ LOW** · `실습재현불가` · _§6 시험 명령어 / 전체_
  - 문제: 시험 필수 kubectl 명령어를 100+ 줄 나열했지만, 각 명령어를 실제 클러스터에서 실행한 출력이 전무. 학생이 '정말 이 명령이 작동하나' 신뢰 못함.
  - 보강: 각 주요 명령(예: kubectl run, kubectl create deployment, kubectl expose, kubectl get -o jsonpath)마다 실제 실행 예시 PNG 스크린샷 1-2개씩 첨부. 전부는 아니더라도 대표 명령들은 필수.

### 03-exam-questions.md  · 가독성 2/5 · 스토리라인 1/5 · 단독합격 ❌

**잘된 점:** 완전한 40문제 CKA 실기 형식 / 모든 풀이 동작하는 코드 / 검증 섹션으로 대조 가능

- **🔴 HIGH** · `용어비약` · _문제 1-40 전체_
  - 문제: 핵심 용어 정의 없음
  - 보강: 용어 첫 등장 시 괄호 속 정의 추가
- **🔴 HIGH** · `용어비약` · _문제 1-40 전체_
  - 문제: 기술 등장 배경 명시 없음
  - 보강: 등장 배경 세션 추가
- **⚪ LOW** · `용어비약` · _전체_
  - 문제: 모든 검증을 텍스트 블록으로 제시
  - 보강: 검증을 실제 캡처로 바꾸기

### 04-tart-infra-practice.md  · 가독성 2/5 · 스토리라인 2/5 · 단독합격 ❌

**잘된 점:** 완전한 실습 쇵: 50개 Lab, 3개 모의 실기, CKA 5 도메인 전체 쵰라지 / 실증적 명령 찔 녀닜: dev/staging/prod/platform tart 클러스터 / CKA 실기 마놠람 스타일: 명령형 dry-run alias

- **🔴 HIGH** · `용어비약` · _section 2.3 Pod CIDR, line 40-50_
  - 문제: CIDR Allocator PLEG cgroup undefined; beginner confused
  - 보강: Define: Node CIDR Allocator divides cluster CIDR into per-node subnets
- **🔴 HIGH** · `스토리라인누락` · _section 1 Cluster Arch, lines 280-1480_
  - 문제: Tech explained without why existed prior limit new improvement tradeoff
  - 보강: Add Background: Problem -> Previous solution -> New tech -> Tradeoffs to each lab
- **🔴 HIGH** · `실습재현불가` · _section 1.2-1.4 5.5 SSH, lines 400-720 4994-5090_
  - 문제: Terminal outputs text not screenshots; CLAUDE.md requires screenshots
  - 보강: Execute labs capture terminal screenshot save images embed Markdown
- **🔴 HIGH** · `이해난이도` · _section 2 Workloads, lines 1650-2500_
  - 문제: Formulas YAML without intuition; floor explanation missing
  - 보강: Add intuition before formulas; explain why floor conservative rounding
- **🔴 HIGH** · `정확성오류` · _section 2.6 QoS, line 2502_
  - 문제: QoS Burstable incomplete; requests prerequisite omitted
  - 보강: Create table all request/limits combinations map to 5 QoS

### 05-supplement.md  · 가독성 4/5 · 스토리라인 4/5 · 단독합격 ✅

**잘된 점:** 깊이 있는 내부 동작 원리 설명 — 각 기술(PSA, Init Container, PriorityClass, SecurityContext, metrics-server)에 대해 등장 배경, 기존 한계, 해결 메커니즘, 트레이드오프를 일관되게 설명하여 스토리라인이 명확함. / 실무적 트러블슈팅 강화 — 1.2~1.5절과 예제 1~10, 문제 25~30에서 실제 장애 시나리오(CrashLoopBackOff, NotReady, DNS 실패, etcd 복구 실패)를 체계적으로 다루고 진단 절차·해결 명령을 단계별로 제시 / 기출 유형 시뮬레이션 충실 — Part 4의 Q1~Q20이 실제 CKA 시험에서 자주 출제되는 주제(etcd, kubeadm, RBAC, NetworkPolicy, Node, PV/PVC, Ingress, 클러스터 컴포넌트)를 다루어 시험 준비도가 높음.

- **🟡 MED** · `실습재현불가` · _1.1 PSA, 1.2 Init Container, 1.3 PriorityClass, 예제 1~10, 문제 1~30, Q1~Q20_
  - 문제: 모든 검증 명령의 출력이 '예상 출력:' 텍스트 블록으로만 표기되어 있음. CLAUDE.md의 규약 §4①에서는 명령 결과를 반드시 실제 터미널 스크린샷 이미지로 제시해야 한다고 명시했으나, 이 파일의 모든 검증 출력은 마크다운 텍스트로만 작성됨. 학생이 실제 클러스터에서 명령을 실행했을 때 이 문서의 출력과 정말 일치하는지 확인할 수 없어 신뢰도 저하.
  - 보강: 모든 검증 섹션의 '```text' 블록을 제거하고, 실제 tart 클러스터(dev/staging)에서 각 명령을 실행하여 터미널 스크린샷을 캡처. 이미지를 `k8scert/CKA/images/` 디렉토리에 저장하고 `![실제 kubectl 실행 — PSA 네임스페이스 생성](images/psa-ns-create.png)` 형식으로 삽입. 불가피하게 캡처가 불가능한 경우 '(미캡처 — 클러스터 미가동)' 명시.
- **🟡 MED** · `스토리라인누락` · _1.4 SecurityContext와 1.5 Resource Metrics의 배경 섹션_
  - 문제: SecurityContext의 배경에서 '보안 문제'는 언급되지만, PSA(Pod Security Admission, 1.1절)와 SecurityContext(1.4절)의 계층 관계가 불명확함. PSA는 클러스터 수준의 정책(각 네임스페이스 레이블)이고, SecurityContext는 개별 Pod의 구현(spec 필드)인데, 둘의 역할 분담을 명시하지 않아 학생이 두 개념의 용도를 헷갈릴 수 있음.
  - 보강: 1.4 배경 마지막에 다음 추가: '이러한 securityContext 설정은 Pod 보안을 구체적으로 구현하는 수단이며, PSA(1.1절)의 restricted 프로파일을 충족하려면 이 절의 securityContext 설정들(runAsNonRoot, allowPrivilegeEscalation, capabilities drop ALL)이 모두 필요하다. PSA는 정책(어떤 조건을 강제할 것인가), SecurityContext는 구현(어떻게 강제하는 코드)이라고 이해하면 된다.'
- **⚪ LOW** · `용어비약` · _예제 1, 백업 섹션 문단 906-907_
  - 문제: 'copy-on-write 메커니즘에 의해 스냅샷 일관성이 보장된다'는 설명이 학부생 수준에서 이해하기 위해 끝이 부족. copy-on-write가 구체적으로 무엇인지 한 문장 정의의 필요.
  - 보강: 'copy-on-write 메커니즘(원본 데이터는 그대로 두고, 수정이 발생할 때만 복사본을 만드는 기법)에 의해 스냅샷 생성 중에도 etcd가 계속 쓰기를 처리할 수 있다'로 수정.
- **⚪ LOW** · `이해난이도` · _예제 2, Control Plane 업그레이드 섹션_
  - 문제: kubeadm upgrade apply 후 kubelet 업그레이드까지의 순서가 복잡한데, 각 단계에서 '왜 이 순서인가'를 설명하지 않음. 학생이 암기식으로 따르게 되어 변형 문제에 약함.
  - 보강: 각 단계 앞에 상태 설명 추가. 예: '# 5. 노드 drain — kubelet 업그레이드 전에 해당 노드의 Pod를 다른 노드로 이동시켜 데이터 손실 방지 (Control Plane은 1.31, Worker kubelet은 여전히 1.30인 상태이므로 version skew policy 범위 내)' 같은 주석.

### daily/day01.md  · 가독성 3/5 · 스토리라인 2/5 · 단독합격 ❌

**잘된 점:** §1.1 쿠버네티스 등장 배경이 구체적: Google Borg, 컨테이너 관리의 불가능성(죽으면 재시작? 스케일은 누가?) 명확하게 설명해 학생이 필요성을 느낀다. / §1.2 Static Pod과 kube-apiserver의 YAML 매니페스트를 필드마다 주석으로 해석: 학생이 kubeadm 실기 시험 대비할 때 직접 참조 가능. / §3 시험 문제와 풀이가 단계별로 명확: SSH→staticPodPath→YAML 생성→kubectl 검증의 순서가 실제 시험 과정을 반영해 손 감을 익히기 좋다.

- **🔴 HIGH** · `용어비약` · _Line 327, §1.3 Worker Node_
  - 문제: Cilium을 갑자기 언급하지만 '이게 뭐다'는 정의 없음. '쿠버네티스가 아닌 네트워킹 솔루션'으로만 알려져서 학생이 이후 실습에서 혼동할 위험.
  - 보강: Cilium 첫 등장 시 한 문장: '쿠버네티스의 기본 Service 트래픽 라우팅 도구인 kube-proxy 대신 eBPF(extended Berkeley Packet Filter라는 커널 기술)를 쓰는 고성능 CNI 플러그인'. 그리고 kube-proxy 저과 Cilium의 차이(iptables vs eBPF, 성능/유지보수성)를 2~3줄 추가.
- **🔴 HIGH** · `용어비약` · _Line 25, §1.1_
  - 문제: 'declarative configuration'과 'reconciliation'이라는 핵심 용어가 정의 없이 쓰임. 학부생이 이 두 개념을 모르면 이후 §2.2의 Watch 메커니즘을 못 이해.
  - 보강: Line 25 문장을 두 문장으로 분리: '선언적 구성(declarative configuration) = "원하는 최종 상태를 선언만 하고 How는 시스템이 알아서 한다"라는 의미. 대조: 명령형(imperative) = "이 명령, 저 명령을 순차 실행해"라는 차이를 한 예시로. 그리고 reconciliation = "현재 상태와 원하는 상태의 차이를 감지해서 자동으로 맞춰나가는 제어 루프"라고 정의한 뒤, "이 패턴을 §2.2에서 Watch로 구현한다"고 연결.'
- **🔴 HIGH** · `스토리라인누락` · _§1.3 kube-proxy 전체_
  - 문제: 배경(Pod IP는 바뀐다)과 해결(Service 고정 IP)은 있으나 '직전 기술 비교'가 없음. 초기 쿠버네티스 또는 다른 오케스트레이터(Swarm, Nomad)에서는 이 문제를 어떻게 뚫었는지, 왜 kube-proxy가 더 낫는지 설명 없음. iptables·IPVS·nftables 3가지 모드를 나열하지만 트레이드오프(성능/유지보수)를 명시하지 않음.
  - 보강: 이전 상황: '초기에 개발자들은 Pod IP를 직접 알아내서 서비스를 호출했으나, Pod가 재생성되면 IP가 바뀌어 속속이 끊기는 문제가 반복됐다.' 개선: 'Service는 고정된 ClusterIP를 제공하고, kube-proxy가 iptables 규칙으로 이 가상 IP로 들어오는 트래픽을 실제 Pod IP로 변환(DNAT)한다.' 트레이드오프: 'iptables는 규칙 개수가 많아지면 선형 성능 저하(O(n)) 가능 → IPVS는 O(1) 성능이나 설정이 복잡 → 현대의 Cilium은 eBPF로 커널 수준에서 패킷 처리해 성능과 유지보수성 동시 달성.'
- **🔴 HIGH** · `스토리라인누락` · _§1.2 Container Runtime 전체_
  - 문제: Docker의 무거움(Line 332) → CRI 표준(Line 334) 순서는 있으나, '왜 Docker가 무거운가'(이미지 빌드, 네트워크, 스토리지 등 K8s가 필요 없는 기능 포함)와 'containerd는 Docker의 어떤 부분만 가져왔나'(런타임 코어)가 명확하지 않음. runc와의 관계도 다이어그램(그림 4)에만 나옴.
  - 보강: 상세화: 'Docker는 이미지 빌드(docker build), 네트워크(docker network), 스토리지(docker volume) 등 전체 기능을 포함한 무거운 데몬. K8s는 단순히 "컨테이너를 생성하고 실행하는" 기능만 필요하다. 이에 2014년경 OCI(Open Container Initiative)는 CRI(Container Runtime Interface)라는 표준을 정의했고, Docker에서 런타임 핵심만 분리한 containerd와, OS 레벨 격리를 담당하는 runc를 조합으로 쓰게 됐다. 덕분에 쿠버네티스는 containerd·CRI-O·gVisor 등 다양한 런타임을 플러그인처럼 교체 가능하게 됐다.'
- **🟡 MED** · `용어비약` · _Line 150, §1.2 etcd_
  - 문제: Raft 합의 알고리즘이라고 2자로 표기되지만, 알고리즘이 구체 뭔지(과반수 동의, 리더 선출, 상태 머신 복제 등) 모르는 학생에게는 여전히 마법 같음. '합의 알고리즘'의 의미가 '여러 노드가 동일한 상태를 유지하려면 어떻게 하나'라는 문제인지 명확하지 않음.
  - 보강: 한 문장 추가: 'Raft 합의 알고리즘 = 여러 etcd 노드가 있을 때, 어느 한 노드가 데이터를 저장했다고 주장해도 "나도 같은 데이터를 저장했다"고 과반수가 동의해야만 확정되는 방식. 이렇게 하면 네트워크 분할이나 일부 노드 장애가 나도 전체 클러스터가 같은 상태를 유지할 수 있다(강한 일관성, strong consistency).'
- **🟡 MED** · `용어비약` · _Line 33, §1.1 Pod 설명_
  - 문제: 'Linux namespace(network, IPC, UTS)를 공유하는 컨테이너 그룹'이라고 되어 있지만, Linux namespace가 정확히 뭔지(OS 커널 기능으로 프로세스를 격리하는 메커니즘) 설명 없음. 학부생이 network namespace가 뭔지 모르면 '동일 namespace를 공유한다'는 말이 의미 없음.
  - 보강: 한 문장 추가: 'Linux namespace = OS 커널이 제공하는 격리 메커니즘으로, 같은 namespace에 있는 프로세스들은 네트워크(IP/포트), IPC(프로세스간 통신), 호스트명을 **공유**하고, 다른 namespace의 프로세스는 **안 본다**라는 뜻. Pod는 내부의 모든 컨테이너가 동일한 namespace를 공유하므로 localhost로 서로 통신 가능하다.'
- **🟡 MED** · `맥락점프` · _§1.4 그림 5 (API 요청 처리 흐름)_
  - 문제: mermaid 다이어그램으로 6단계 흐름을 보여주지만, 각 단계 사이에 '누가 무엇을 감지했나'가 텍스트로 명확하지 않음. 특히 '2단계 Deployment Controller가 Deployment 변경을 감지'는 어떤 메커니즘인가? (Watch를 본다는 것은 나중 §2.2에서 나옴)
  - 보강: 다이어그램 바로 아래 단락을 추가: 'Deployment를 etcd에 저장한 후 (1단계), Deployment Controller라는 제어 루프가 Watch 메커니즘으로 "Deployment가 바뀌었다"는 알림을 수신한다 (자세한 원리는 §2.2). 이런 식으로 각 단계는 API 서버의 Watch를 통해 자신이 담당할 리소스의 변경을 감지하고 반영한다. 이 전체 흐름을 "reconciliation loop"이라고 부르며, K8s의 핵심 설계 원리다.'
- **🟡 MED** · `이해난이도` · _§1.3 kubelet 설정 파일 (Line 289 YAML)_
  - 문제: 갑자기 `/var/lib/kubelet/config.yaml`이 나타나는데, 학생이 이 파일을 본 적 없으면 '뭐하는 파일이고 누가 만드나?'가 불명확. 파일이 어디서 생성되고(kubeadm init), 누가 읽고(kubelet 부팅 시), 어떻게 적용되는지(systemd 서비스) 설명 없음.
  - 보강: YAML 코드블록 전에 3~4줄 설명 추가: 'kubelet은 부팅 시 /var/lib/kubelet/config.yaml 파일을 읽어 설정을 로드한다. 이 파일은 kubeadm init 단계(후술)에서 자동 생성되며, 쿠버네티스 클러스터의 기본 설정(DNS 서버 IP, Static Pod 경로, 인증서 갱신 주기 등)을 정의한다. 다음은 기본 구성값들이다:'
- **🟡 MED** · `맥락점프` · _§1.5 Static Pod 설명 (Line 367~376)_
  - 문제: Static Pod의 정의와 특성은 있으나, '왜 Control Plane이 Static Pod인가'라는 **부트스트랩의 닭-달걀 문제**를 명확히 설명하지 않음. kubelet은 API 서버의 지시를 받아 Pod를 생성하는데, Control Plane 자체(kube-apiserver 포함)가 Static Pod이면 초기에 누가 kube-apiserver를 시작하나?
  - 보강: §1.5 첫머리에 부트스트랩 다이어그램 또는 설명 추가: '쿠버네티스 클러스터가 처음 시작될 때 API 서버가 없으면 kubectl 명령을 받을 수 없다. 하지만 kubelet은 API 서버 없이도 staticPodPath 디렉터리의 YAML을 직접 읽어 Pod를 생성할 수 있다. 덕분에 kubeadm은 1) 매니페스트 파일들을 /etc/kubernetes/manifests/에 배치하고 2) kubelet을 시작하면 kubelet이 자동으로 apiserver/etcd/scheduler를 Static Pod로 실행해 클러스터를 부트스트랩할 수 있다.'
- **🟡 MED** · `정확성오류` · _Line 152, §1.2 etcd_
  - 문제: 'API 버전 3 사용 (`ETCDCTL_API=3`)' — ETCDCTL_API가 뭐고 왜 3인지 설명 없음. 학생이 나중에 '`ETCDCTL_API=3 etcdctl get ...`'을 시험에서 쓸 때 이게 왜 필요한지 못 이해.
  - 보강: 뒤에 한 문장 추가: 'etcdctl은 etcd 명령행 도구인데, API 3 버전(gRPC 기반, 성능 개선)을 쓰려면 환경변수 `ETCDCTL_API=3`을 설정해야 한다(기본값은 v2로 deprecated).'
- **🟡 MED** · `실습재현불가` · _§6 실습 환경 설정 (Line 909)_
  - 문제: kubeconfig 경로가 실제 경로인지 명확하지 않음. 학생 로컬 환경에 이 경로가 정확히 있는지 확인 불가. 문서 규약상 실습은 '이 저장소의 실제 tart 클러스터'를 전제하는데, 어떤 환경에서든 재현 가능해야 함.
  - 보강: 실습 환경 설정 전에 전제 조건을 명시: '다음 실습은 이 저장소의 tart 멀티클러스터가 가동 중임을 가정한다. 클러스터 상태 확인: `./scripts/boot.sh` → `./scripts/status.sh`. kubeconfig는 가동 시 자동 생성되는 kubeconfig/ 디렉터리에서 참조한다. 만약 클러스터가 꺼져 있거나 IP 드리프트로 kubeconfig가 구려 있으면 ./scripts/fix-cluster-ip-drift.sh [클러스터] 을 먼저 실행할 것.'
- **🟡 MED** · `실습재현불가` · _§6.1 실습 1 (Line 929~935) — 이미지 캡션_
  - 문제: 이미지가 '실제 스크린샷'인지 '예상 출력'인지 불명확. 문서 규약 §4①에 따르면 모든 명령 결과는 '실제 터미널 캡처 이미지'여야 하는데, 캡션이 '(platform 실측, 컨트롤플레인 + coredns 발췌)'라고 되어 있어 크롭된 것 같음. 학생이 실제로 실행하면 이 이미지와 다를 가능성 있음(Pod 이름, 노드 수 등).
  - 보강: 이미지 캡션을 명확히: '그림 X. platform 클러스터에서 `kubectl get pods -n kube-system` 실행 결과. Control Plane 4종(etcd/apiserver/scheduler/controller-manager)은 master 노드에 Static Pod로 고정되고, coredns는 일반 Deployment라 worker 노드에도 스케줄된다.'
- **⚪ LOW** · `용어비약` · _Line 49, §1.2 Control Plane 다이어그램_
  - 문제: 포트번호(6443, 10259, 10257, 2379/2380)가 왜 이 번호인지(표준? 규약? 변경 가능?) 설명 없음. 시험문제에 '6443이 아닌 다른 포트에서 apiserver를 띄우다면?'이 나올 때 학생이 혼동할 수 있음.
  - 보강: Figure 1 캡션 또는 아래 한 문장: '포트번호는 쿠버네티스 표준 규약이며, 변경 가능하다. 6443은 API 서버 HTTPS 기본값, 2379는 etcd 클라이언트 기본값 등.'
- **⚪ LOW** · `맥락점프` · _§2.2 Watch 메커니즘 (Line 631~644)_
  - 문제: Watch의 구체적 구현(HTTP long-polling? WebSocket? gRPC streaming?) 명시 없음. 학생이 '정말 실시간인가? 얼마나 빠른가? etcd 변경을 즉시 캐시하나?'라고 물어도 답할 수 없음. 개념 설명만으로 메커니즘 부족.
  - 보강: 한 문장 추가: 'Watch는 API 서버로부터 리소스 변경 이벤트를 스트리밍으로 수신하는 메커니즘(gRPC streaming 또는 HTTP chunked transfer 기반)으로, etcd 변경이 발생하면 수백 밀리초 내에 컴포넌트가 감지한다.'

### daily/day02.md  · 가독성 3/5 · 스토리라인 2/5 · 단독합격 ❌

**잘된 점:** 명령 정확성 — 모든 kubectl 명령·옵션이 정확한 문법을 따르며 실행 가능 / 기대 출력 스크린샷 — 각 문제마다 실제 터미널 캡처 이미지를 첨부해 학생이 검증 가능 / 옵션 다양성 — --show-labels, -L, -o custom-columns 등 여러 방법을 제시해 문제 풀이 유연성 제공

- **🔴 HIGH** · `스토리라인누락` · _문제 6~15 전체_
  - 문제: 각 문제가 '하라' → '명령' → '확인'으로만 진행되고, '왜 이 기능이 필요한가'(등장 배경)가 완전히 빠짐. 예: 노드 레이블은 Pod 배치 제어 목적인데 설명 없음, Pod CIDR은 네트워크 분할 목적인데 미설명, 인증서 만료 확인은 보안/TLS 제한 때문인데 배경 없음. 학생이 '이 명령이 어떤 상황에서 쓰이나' 이해 못함.
  - 보강: 각 문제 헤더 아래 '[등장 배경]' 부절(2~3줄) 추가. 예: 문제 6 앞에 '노드 레이블: Pod를 특정 노드에만 배치하기 위한 방법이다. 레이블 없으면 스케줄러가 GPU/SSD 노드를 무시하고 임의 배치해 리소스 낭비된다.' 추가
- **🔴 HIGH** · `스토리라인누락` · _§5.1~5.16 YAML 예제 전체_
  - 문제: 각 YAML 예제가 '이런 구성'만 보여주고 '왜 필요한가', '언제 쓰는가', '안 쓰면 뭐가 문제인가' 전혀 없음. requests/limits는 왜 분리? Tolerations는 nodeSelector로 안 되나? 3가지 Probe는 왜 있나? — 학생이 각 구성을 언제 써야 할지 판단 불가.
  - 보강: 각 예제 헤드 다음 '[사용 사례 + 트레이드오프]' 문단(2~3줄) 삽입. 예: '5.3 리소스 제한: Pod가 제한 없으면 한 개가 노드 전체 먹어 다른 Pod이 OOMKill/evicted. requests 없으면 스케줄러가 노드 가용도 무시해 배치 실패. 따라서 둘 다 필수.'
- **🔴 HIGH** · `용어비약` · _문제 7(line 55), 문제 9(line 125), YAML 5.8(line 544)_
  - 문제: 'Taint', 'Control Plane', 'Pod CIDR' 등 용어가 이 파일에서 처음 나오나 정의 없음. day01 전제? Taint는 '제약 설정'만 설명하지 '특정 Pod만 허용(tolerate)' 의미 불명확. Control Plane은 대문자만 있고 '노드 관리 서버 그룹' 정의 빠짐.
  - 보강: day01 또는 KCNA 링크 추가. 또는 용어 첫 등장 시 1줄 정의. 예: '(Taint: 노드 제약 설정으로, 이 제약을 허용(tolerate)하는 Pod만 배치 가능)'
- **🔴 HIGH** · `실습재현불가` · _문제 11(line 185), 문제 13(line 267~268)_
  - 문제: SSH 접속 시 `ssh admin@<platform-master-ip>`로 IP 자리를 비워둠. 또한 CLAUDE.md와 모순: CLAUDE.md는 'ssh dev-master(별칭 가능)'이라 했으나 day02는 그 전제를 모름. kubeconfig 로드 방법도 '환경변수 설정이 완료됐다고 가정'해 학생이 '어디서 kubeconfig를 얻나?' 막힘. 파일 경로 `/etc/kubernetes/manifests/etcd.yaml`도 검증 없음.
  - 보강: 문제 11 헤더에 '[전제] tart 환경 설정 완료, $KUBECONFIG 또는 --kubeconfig로 kubeconfig/platform.yaml 로드됨, SSH 별칭(~/.ssh/config의 dev-master 등) 설정 완료' 명시. 또는 day01 링크 제공.
- **🟡 MED** · `이해난이도` · _§5.5 Probe(line 476~498)_
  - 문제: liveness/readiness/startup 3가지 Probe가 갑자기 등장하고, 각각 '언제 작동'은 설명하지만 '왜 3가지가 필요한가'(Pod 생명주기: 시작 중→준비 중→운영 중)가 없음. startup 없으면 liveness가 시작 중에 자꾸 실패해 무한 재시작한다는 실제 문제도 설명 안 함.
  - 보강: Probe 섹션 헤드에 '[3가지 Probe 비교표]' 추가. 행: '시점(언제?)', '목적(뭐하나?)', '실패 시(어떻게?)', '예시(언제 쓰나?)'. 아니면 이 문장 추가: 'startupProbe 없으면 slow-starting 앱이 시작 중 liveness 반복 실패해 재부팅 무한 루프 진입.'
- **🟡 MED** · `정확성오류` · _문제 8(line 115)_
  - 문제: 'PODS 열은 ... 기본값은 110이다' — 이는 K8s 기본값이나 실제 kubelet --max-pods 플래그로 조정 가능. '기본값'이라고 단정하면 학생이 실환경에서 110 아닌 다른 값을 보고 혼동.
  - 보강: '기본값으로 110개(kubelet의 --max-pods 플래그로 조정 가능)'로 수정
- **🟡 MED** · `용어비약` · _§5.2 emptyDir(line 406), §5.8 Toleration(line 544)_
  - 문제: emptyDir 생명주기가 '임시'라는 한 줄만 있고, '정확히 언제 삭제되나'(Pod 삭제 시만, 컨테이너 재시작 후에도 유지) 불명확. Toleration의 'operator: Exists vs Equal' 차이는 정의만 있고 실제 사용 예시(control-plane Taint는 값 없어 Exists, custom-gpu Taint는 값 있어 Equal) 없음.
  - 보강: emptyDir 주석에 '생명주기: Pod 실행 중 존재 (컨테이너 재시작 후에도 유지, Pod 삭제 시만 제거)' 추가. Toleration operator 주석에 '예: Exists(node-role.kubernetes.io/control-plane), Equal(taint=value 검증)' 추가

### daily/day03.md  · 가독성 3/5 · 스토리라인 3/5 · 단독합격 ❌

**잘된 점:** etcd 인증서 경로를 명확히 제시하고 3가지 확인 방법을 제공함 / etcd snapshot save와 restore의 차이점(인증서 필요 여부)을 명확히 구분 / control plane과 worker node 업그레이드의 차이를 표로 정리

- **🔴 HIGH** · `용어비약` · _1.1절 etcd 등장배경 첫 문단_
  - 문제: ZooKeeper 언급 후 설명 없이 'Go 언어·경량화·Raft 합의'를 나열. 학생이 ZooKeeper, Raft가 무엇인지, 왜 경량화가 필요한지 모름
  - 보강: ZooKeeper가 Java 기반이라 부팅·배포가 무겁다는 구체적 고통(예: jvm startup 시간·메모리 오버헤드)을 먼저 설명하고, 'Raft는 분산 합의 알고리즘으로 모든 노드가 동일 상태를 보장'으로 풀이
- **🔴 HIGH** · `용어비약` · _1.1절 '아키텍처' 항목, gRPC 첫 등장_
  - 문제: gRPC가 무엇인지 설명 없이 'kube-apiserver만 etcd에 gRPC로 직접 접근'이라 함. 학생이 gRPC=Google RPC인 것을 모르면 이해 불가
  - 보강: gRPC는 Google이 만든 고성능 RPC 프로토콜로 HTTP/2 기반이라 일반 REST 대비 빠르다는 1줄 설명 추가
- **🔴 HIGH** · `스토리라인누락` · _2절 etcd 백업 (snapshot save)_
  - 문제: 2.1 '왜 중요한가'에서 '모든 쿠버네티스 오브젝트가 사라진다'는 결과만 나열하고, etcd가 없으면 클러스터 제어가 정지된다는 **root cause**를 명시하지 않음. 또한 boltdb와의 관계도 갑자기 나타남(1.1에서 언급 없음)
  - 보강: boltdb는 etcd가 데이터를 저장하는 embedded database임을 1절에서 명시하고, 2.1에서 '스냅샷 저장이 필수인 이유: etcd 서버 장애 시 복구 방법이 유일하기 때문'으로 명확히
- **🔴 HIGH** · `이해난이도` · _3.3절 etcd 매니페스트 수정, '방법 1과 방법 2의 차이' 설명_
  - 문제: 방법 1과 방법 2가 기술적으로 무엇이 다른지 설명이 추상적. 학생은 '둘 다 파일을 수정하는 것 아닌가'라고 혼동. 실제로 kubelet이 어느 경로를 보고 mount하는지의 메커니즘 불명확
  - 보강: Static Pod 마운트 원리를 먼저 설명: kubelet이 /etc/kubernetes/manifests/ YAML의 containers[].volumeMounts와 spec.volumes을 매칭해 컨테이너 내부 경로와 호스트 경로를 bind mount한다는 기초 추가
- **🔴 HIGH** · `맥락점프` · _문제 3(etcd 백압+복구 통합 문제)과 관련 설명_
  - 문제: 문제에서 '테스트 네임스페이스를 생성 후 백업을 복구하면 사라진다'는 시나리오를 제시했으나, 왜 이런 테스트를 하는가의 학습 목표(스냅샷의 시간 일관성=consistency 개념)를 명시하지 않음
  - 보강: 문제 3 상단에 '이 문제의 목표: 스냅샷은 특정 시점의 **완전 상태 스냅샷**이므로 그 이후 생성한 리소스는 복구 시 사라진다는 etcd 복구의 특성을 체득'이라 명시
- **🔴 HIGH** · `실습재현불가` · _섹션 tart-infra 실습, 1~3장 전체_
  - 문제: 실습 결과 출력이 모두 '예상 출력'이라는 텍스트 블록으로 나열(예: 762~771줄). CLAUDE.md §4①에서 명시한 '실제 터미널 스크린샷 이미지는 필수'라는 규칙 위반. 학생이 자신의 실행 결과가 맞는지 확인할 수 없음
  - 보강: 각 실습 명령 후 실제 tart 클러스터에서 실행한 터미널 스크린샷(PNG) 캡처 추가. '예상 출력'은 제거하고 '실제 실측' 스크린샷으로 대체
- **🔴 HIGH** · `정확성오류` · _4.1절 업그레이드 규칙, 파드 관련 설명_
  - 문제: kubelet 버전과 apiserver 버전 차이 설명('kubelet은 apiserver보다 최대 2 마이너 버전 낮을 수 있다')이 Kubernetes 공식 정책과 상충. 실제로는 kubelet이 apiserver보다 **높으면 안 되고**, 낮은 한계는 명확하지 않음. 또한 'Control Plane을 먼저 업그레이드'라는 명령이 이유(apiserver가 신기능을 제공하므로 kubelet이 따라가야 함)를 설명 없이 제시
  - 보강: Kubernetes 공식 버전 호환성 정책 명시: 'kubelet은 apiserver보다 높으면 안 되고 최대 2 마이너 버전 뒤떨어질 수 있다'는 공식 문서 참고. 업그레이드 순서의 이유를 명확히: '새 apiserver의 신 기능을 kubelet이 지원해야 하므로 apiserver 먼저 업그레이드'
- **🟡 MED** · `용어비약` · _1.1절 'quorum' 첫 등장_
  - 문제: '과반수(quorum)' 용어가 괄호로만 번역됨. 왜 과반수인지(Byzantine Fault Tolerance, 3노드면 1개 실패 허용) 설명 없음
  - 보강: quorum 정의 후 '3노드 etcd 클러스터는 최소 2개 노드가 동의해야 데이터 커밋이 확정된다. 이는 1개 노드 실패 후에도 과반수가 남아 클러스터가 동작하기 위함'으로 추가
- **🟡 MED** · `용어비약` · _3절 snapshot restore, 'WAL(Write-Ahead Log)' 첫 등장_
  - 문제: 5.2절 flowchart에서 '새 데이터 디렉터리에 ... WAL(Write-Ahead Log) 파일 생성'이라 했으나, WAL이 무엇인지 설명이 없어 학생이 중요성을 못 느낌
  - 보강: WAL을 '디스크 쓰기 전 로그를 먼저 기록하는 기법으로 갑자기 종료돼도 데이터 손실을 방지'으로 간단히 설명하되, etcd restore 맥락에서는 '스냅샷 복구 후 그 시점 이후의 추가 쓰기를 기록하기 위해 새 WAL을 생성'이라 명확히
- **🟡 MED** · `스토리라인누락` · _4절 클러스터 업그레이드 전체_
  - 문제: Kubernetes가 왜 '한 마이너 버전씩만' 업그레이드하도록 강제하는지(API 호환성·이전 버전 기능 deprecation) 설명이 없음. 또한 Static Pod 매니페스트 변경으로 업그레이드되는 메커니즘(kubelet이 /etc/kubernetes/manifests/ 폴링)도 1절에서 언급 없음
  - 보강: 4.1 '등장 배경' 섹션에 '왜 한 버전씩인가: 대버전 건너뛰면 제거된 API/기능으로 인해 워크로드가 깨질 수 있다'는 구체 예시 추가. 또한 Static Pod 개념을 1절 또는 4절 상단에 별도로 설명(kubelet이 특정 디렉토리 폴링해 YAML 변경 감지 시 컨테이너 재시작)
- **🟡 MED** · `이해난이도` · _4.3절 Control Plane 업그레이드 절차, Step 3·4 전후 순서_
  - 문제: Step 2 후 Step 3을 실행해야 하는데, Step 4 주석에서 '다른 터미널 또는 exit 후 실행'이라 함. 왜 drain을 Control Plane 업그레이드 *후에* 하는지, 그리고 drain 중에 apiserver가 꺼지면 어떻게 되는지 명시 없음
  - 보강: 'kubeadm upgrade apply'는 Static Pod를 재시작하므로 kubelet이 새 이미지를 받아오고 컨테이너가 재시작되는 동안 apiserver가 일시적으로 응답 불가가 된다. 이 후 drain을 실행하면 drain 중 apiserver가 정상 복구된다'는 흐름 명시
- **🟡 MED** · `용어비약` · _4.6절 drain, '--grace-period' 옵션 설명_
  - 문제: grace-period를 '종료 유예 시간'으로만 설명. 학생이 '왜 유예 시간이 필요한가(graceful shutdown·SIGTERM signal)' 모를 수 있음
  - 보강: 'grace-period=60은 Pod에 60초 동안 SIGTERM 신호를 보내 gracefully 종료할 기회를 준다. 이 시간 내 graceful shutdown 로직이 없으면 강제 종료(SIGKILL)된다'는 설명 추가
- **🟡 MED** · `맥락점프` · _섹션 6 시험 출제 패턴 분석_
  - 문제: 이 섹션이 3~5절 심화 내용 후에 나오는데, 앞의 7절(실전 시험 문제)과 중복 느낌. 섹션 6이 학습자에게 전체 문맥 제공(출제 의도·유형 분류)이므로, 이를 학습 시작 직후(1절 뒤)에 배치했다면 더 자연스러울 것
  - 보강: 섹션 6을 섹션 1.5로 이동: 학습 목표와 etcd 개념 다음에 '이 주제가 시험에서 어떻게 나오는가'를 미리 제시하면 학생이 학습 방향을 설정하기 쉬움
- **⚪ LOW** · `정확성오류` · _2.2절 TLS 인증 역할 표의 --key 설명_
  - 문제: '클라이언트 개인키'라 했으나, 더 정확히는 '--cert에 대응하는 비밀키(private key)'라고 명시해야 함
  - 보강: '클라이언트 개인키: 클라이언트 인증서(--cert)와 쌍을 이루는 비밀키로, TLS 핸드셰이크 시 인증서 소유 증명에 사용'으로 수정
- **⚪ LOW** · `구조` · _문제 1~12 제시 부분_
  - 문제: 각 문제의 '풀이 과정'이 <details> 토글 안에 숨겨져 있으나, 이 문서는 교재이므로 학생이 먼저 직접 풀어볼 수 있도록 공간을 제공하는 구조가 더 나을 것. 현재는 풀이가 너무 쉽게 펼쳐짐
  - 보강: 각 문제의 시작에 '풀이를 보기 전에 직접 시도해보세요'라는 안내 추가하고, 풀이 <details>는 변경 없음. 또는 별도 풀이 파일로 분리 고려
- **⚪ LOW** · `구조` · _섹션 8 트러블슈팅의 이미지 참조_
  - 문제: 846줄·867줄·881줄 등에서 ![...](images/day03-0X-*.png)라 했으나 실제 이미지 파일이 없음. CLAUDE.md §4①에서 명시한 '모든 명령 결과는 실제 스크린샷'이라는 규칙을 위반
  - 보강: 각 트러블슈팅 항목에 실제 tart 클러스터에서 재현해 스크린샷 캡처 후 images/ 디렉토리에 저장하고 삽입
- **⚪ LOW** · `용어비약` · _2.4절 etcdctl 명령어들의 --write-out=table 옵션_
  - 문제: 이 옵션이 무엇인지 설명 없음. 기본 출력 형식과 차이점 미명시
  - 보강: '--write-out=table은 etcdctl 출력을 표 형식(human-readable)으로 변환한다. 기본은 JSON 형식이므로, 터미널에서 확인할 때는 이 옵션을 붙이는 것이 관례'라 추가

### daily/day04.md  · 가독성 2/5 · 스토리라인 2/5 · 단독합격 ❌

**잘된 점:** 문제별 해결책 구조가 명확함(5단계 풀이 패턴) / etcd 백업/복구의 실제 명령어를 완전히 제시함 / 시험 팁 체크리스트가 CKA 응시자 입장에 충실함

- **🔴 HIGH** · `용어비약` · _5~50줄, 'cordon/uncordon' 첫 등장_
  - 문제: 'SchedulingDisabled' 상태가 무엇인지, Node 객체 속성이 어떻게 변경되는지 설명 없음. taint/toleration 개념도 전제됨
  - 보강: 'cordon은 node.kubernetes.io/unschedulable taint 추가'라는 메커니즘을 명시하고, kubeconfig/YAML 관점에서 'kubectl get node -o wide'의 STATUS 컬럼이 어떻게 바뀌는지 한 문장 삽입
- **🔴 HIGH** · `스토리라인누락` · _53~110줄, Control Plane 업그레이드 전체_
  - 문제: '왜' kubeadm을 먼저 업그레이드하는지, Control Plane 컴포넌트(API Server/CM/Scheduler/etcd)가 함께 업그레이드되는 이유, 노드를 drain하는 이유가 전혀 없음. 업그레이드 절차만 있음
  - 보강: §60~70줄에 한 단락 추가: '(등장배경) K8s는 마이너버전 간 호환성 보장(api-server N, kubelet N-1까지). 따라서 Control Plane을 먼저 올린 뒤 worker를 천천히 올린다. (메커니즘) kubeadm upgrade plan으로 호환 버전 확인 → kubeadm(tooling) 업그레이드 → apply(control plane 컴포넌트 정적파드 yaml 수정) → drain(서비스 중단 최소화) → kubelet/kubectl(노드 에이전트) 업그레이드 순서를 반드시 지킨다.'
- **🔴 HIGH** · `스토리라인누락` · _164~195줄, etcd 멤버/엔드포인트 상태 확인_
  - 문제: etcd가 뭔지(분산 key-value 저장소), 왜 멤버 상태를 확인하는지(quorum/leader 장애), --endpoints/--cacert가 뭘 의미하는지 설명 없음
  - 보강: 문제 8 상단에 5줄 추가: '(배경) etcd는 K8s 클러스터의 모든 상태(Pod/Service/Secret)를 저장하는 분산 데이터베이스다. 3/5개 노드 중 과반 노드가 정상이어야 쓰기 가능(Raft 합의). 업그레이드 전 etcd 건강 상태를 반드시 확인해야 한다.'
- **🔴 HIGH** · `용어비약` · _177~189줄, etcdctl member list/endpoint health 명령_
  - 문제: ETCDCTL_API=3, --endpoints=https://127.0.0.1:2379, --cacert/--cert/--key의 의미가 설명 없음. 학생은 이것들이 무엇인지 모름
  - 보강: §167~175줄, 풀이 직전에 '(명령의 의미) etcdctl은 etcd 클러스터 관리 CLI다. --endpoints는 etcd 서버 주소(마스터 로컬에서 127.0.0.1:2379). --cacert/--cert/--key는 etcd와의 mTLS 인증에 필요한 인증서 경로로, etcd Pod의 /etc/kubernetes/pki/etcd에 있다. ETCDCTL_API=3은 etcd v3 API(현재 표준)를 사용하라는 뜻.'을 넣기
- **🔴 HIGH** · `맥락점프` · _231~252줄, 문제 10 (etcd 데이터 디렉터리 확인)_
  - 문제: 문제 8/9를 거쳐 상태 확인 → 문제 10에서 갑자기 '데이터 디렉터리 경로'를 확인하는데, 왜 이것을 해야 하는지 맥락이 없음. 직후 문제 11(인증서 갱신)과의 연관성도 없음
  - 보강: 문제 10 '컨텍스트'란에 '(이전 단계 복습) etcd 건강상태 확인 후 다음으로 해야 할 일 = 저장 용량 확인. etcd 데이터베이스는 계속 커지는데(Pod/Event 누적), 디스크 부족하면 쓰기 실패 및 클러스터 다운. 따라서 업그레이드 전 /var/lib/etcd 크기를 점검한다.'라고 추가
- **🟡 MED** · `용어비약` · _256~280줄, 문제 11 (인증서 갱신 확인)_
  - 문제: '만료일', 'kubeadm certs check-expiration', openssl x509 -enddate의 의미가 설명 없음
  - 보강: 문제 11의 '풀이 과정' 직전에 '(왜 중요한가) K8s 클러스터의 모든 통신은 TLS 인증서로 암호화된다(apiserver-etcd, kubelet-apiserver 등). 인증서 만료되면 통신 불가 → 클러스터 다운. 업그레이드 전반부에 인증서 만료일을 미리 확인하고, 필요하면 kubeadm certs renew로 갱신한다.'를 삽입
- **🟡 MED** · `실습재현불가` · _18~39줄, 문제 5 및 전체_
  - 문제: 실제 클러스터를 대상으로 이 명령들을 실행할 수 없음. <staging-worker1-ip> 같은 자리표가 있지만 학생이 실제 IP를 어디서 얻는지 나와있지 않음. 'ssh admin@<ip>' 도 SSH 접속 방법 사전설명 없음
  - 보강: Day 4 상단에 '실습 환경 설정' 섹션 추가: '(사전 준비) 'export KUBECONFIG=kubeconfig/staging.yaml' 후 'kubectl get nodes'로 노드명 확인. SSH: 'ssh staging-worker1' (tart 자동 설정). 실제 내부 IP: kubectl get nodes -o wide의 INTERNAL-IP 컬럼 참조. 또는 'tart ip staging-worker1'로 조회.'
- **🟡 MED** · `이해난이도` · _612~649줄, Raft 합의 알고리즘_
  - 문제: etcd 내부의 분산 합의 알고리즘(Raft)을 Day 4에 갑자기 심화 학습. 문제 5~7은 기초인데 §11의 Raft는 고급. 난이도 배치가 부자연스러움
  - 보강: Day 4 목차에 '추가 심화 학습'을 분명히 '(선택)' 또는 '(발전)' 마크를 붙여 구분. 또는 Raft 섹션을 Day 5로 이동하고 Day 4에는 'etcd의 역할(모든 K8s 상태 저장, Quorum 기반 안정성)'만 설명
- **🟡 MED** · `정확성오류` · _35~39줄, 문제 5 해석_
  - 문제: 'worker가 하나뿐이면 배치할 노드가 없다'고 했는데, staging 클러스터 topology가 정확히 어떤지(master 1 + worker 1인지, worker 2인지) 명시되어 있지 않음. 만약 worker 2개라면 이 설명은 틀림
  - 보강: 문제 5 '컨텍스트' 초반에 '(사실확인) staging 클러스터는 master 1 + worker 1(또는 N)로 구성. 문제에서는 유일한 worker를 cordon 가정.' 이라 명기
- **🟡 MED** · `스토리라인누락` · _284~321줄, 문제 12 (drain 실패 시 해결)_
  - 문제: drain이 왜 실패하는지(Pod 정책·스토리지·관리자 없음)의 근본 원인이 명확하지 않음. '일반적인 drain 실패 원인'으로 나열만 했음
  - 보강: 문제 12 설명 서두에 '(왜 drain이 어려운가) drain은 Pod를 강제 종료하는 것인데, K8s는 데이터 손상 방지를 위해 여러 정책(PodDisruptionBudget/local storage/비관리형 Pod)으로 이를 막는다. 따라서 drain이 실패하면 이 정책들을 확인하고 각각의 플래그(--force/--delete-emptydir-data)로 우회해야 한다.'라고 추가
- **⚪ LOW** · `맥락점프` · _325~379줄, 추가 YAML 예제 (etcd 백업 CronJob)_
  - 문제: 앞의 문제 1~12는 수동 etcd 백업인데, 갑자기 CronJob으로 자동화. 수동과 자동의 차이·선택 기준이 없음
  - 보강: §325 직전에 '(실전 팁) 위의 snapshot save 명령은 한 번 실행하는 임시 백업. 운영 클러스터에서는 CronJob으로 정기 자동 백업을 설정한다.'라고 맥락 추가
- **⚪ LOW** · `구조` · _454~480줄, 복습 체크리스트 및 시험 팁_
  - 문제: 'etcdctl snapshot save에 필요한 4개 옵션'이라 했는데 실제로는 endpoints/cacert/cert/key (4개 맞음). 하지만 ETCDCTL_API=3이 5번째 (환경변수) 아니라는 것을 명시할 필요
  - 보강: §458 수정: '4개 옵션(--endpoints, --cacert, --cert, --key) + ETCDCTL_API=3 환경변수'로 명기

### daily/day05.md  · 가독성 4/5 · 스토리라인 4/5 · 단독합격 ✅

**잘된 점:** 1. RBAC 아키텍처와 4가지 리소스(Role/ClusterRole/RoleBinding/ClusterRoleBinding)가 명확하게 표로 정리되고, 네임스페이스 범위 구조를 mermaid 다이어그램으로 시각화했다. 학생이 역할 기반 곳곳의 핵심을 빠르게 파악할 수 있다. / 2. API Groups 섹션(1.3)에서 kubectl api-resources 실행 예제로 Core API(""), apps, batch 등을 구분하는 방법을 구체적으로 제시했다. CKA 시험에서 빈번한 함정(Core API는 [""])을 명시적으로 강조했다. / 3. CSR 처리 흐름(§4.2)에서 openssl genrsa → CSR 생성 → K8s CSR 리소스 → 승인 → 인증서 추출의 7단계를 번호·명령·목적이 명확하게 정렬되어 있어 자격증 응시자가 손으로 따라 하기 좋다.

- **🟡 MED** · `용어비약` · _§1.1 등장배경, line 22-25_
  - 문제: ABAC(Attribute-Based Access Control)이 나올 때 학부생이 "ABAC이 뭐지?"하며 막힐 수 있다. "속성 기반"의 구체적 예시(예: IP 주소, 요청 시간, 리소스 태그)가 없어 개념이 떠 있다. JSON 파일 정책 변경 후 API 재시작이 "심각한 단점"이라는 표현도, 구체적으로 "5분 서비스 중단 vs RBAC은 즉시 적용"처럼 트레이드오프를 구체화하면 더 와닿는다.
  - 보강: §1.1 개정: "ABAC은 Attribute(속성) 기반 규칙이다. 예를 들어 '사용자 IP가 10.0.0.0/8이고 오후 2시 이후면 Pod 쓰기 가능' 같은 복합 조건이다. 하지만 이 정책을 변경할 때마다 API 서버를 5분간 재시작해야 하므로, 프로덕션에서 권한을 빠르게 수정할 수 없었다(긴급 권한 제거 시 5분 지연). RBAC은 Role을 쿠버네티스 API 리소스로 관리하여 `kubectl apply`로 즉시 적용되므로, 다운타임 없이 권한을 동적으로 변경할 수 있다." 정도의 스토리라인 추가.
- **🟡 MED** · `스토리라인누락` · _§2.1 ServiceAccount 정의, line 245-251_
  - 문제: "K8s 1.24+에서는 TokenRequest API를 통해 시간 제한이 있는 bound service account token(JWT)을 발급받으며"라는 문장이 놀랍다. 1.24 이전과 이후의 차이(예: 1.23 이전은 SA Secret이 영구 토큰을 생성했고, 1.24+는 Pod마다 동적으로 시간 제한 토큰을 발급)을 명시하지 않으면 "왜 이렇게 바뀌었나"을 모른다. 보안상 이점(장기 토큰 탈취 위험 감소)을 한 문장만 추가해도 이해가 깊어진다.
  - 보강: §2.1 추가: "K8s 1.23 까지는 ServiceAccount 생성 시 자동으로 Secret이 만들어져 만료 없는(영구) 토큰을 담았다. 이 토큰이 탈취되면 계정이 무한정 악용될 수 있었다(긴급 권한 박탈 불가). 1.24+부터는 TokenRequest API를 도입하여 각 Pod마다 시간 제한(기본 1시간)이 있는 JWT를 동적 발급하므로, 토큰이 탈취되어도 유효 기간 내에만 사용 가능하다(보안 강화)." 정도의 스토리라인 추가.
- **⚪ LOW** · `이해난이도` · _§1.9 RoleBinding이 ClusterRole을 참조하는 경우, line 201-228_
  - 문제: 이 패턴이 CKA 시험에 빈번하게 나오는데, 왜 "ClusterRole을 RoleBinding으로 참조하나"의 이유가 "ClusterRole은 재사용 가능한 권한 템플릿" 역할을 한다고만 설명되었다. 학생 입장에서는 "그럼 역으로 RoleBinding이 Role을 참조할 순 없나?"라는 질문이 생긴다.
  - 보강: §1.9 추가 설명: "RoleBinding은 Role 또는 ClusterRole 모두 참조 가능하다. 차이는 범위뿐이다: (1) RoleBinding이 Role을 참조 → 네임스페이스 범위 권한만 적용. (2) RoleBinding이 ClusterRole을 참조 → ClusterRole에 정의된 모든 권한이 RoleBinding의 네임스페이스로 제한된다. 예: `view` ClusterRole은 전체 권한을 정의했지만, demo 네임스페이스의 RoleBinding으로 참조하면 sarah는 demo에서만 view 권한을 갖는다. 즉, ClusterRole을 '재사용 가능한 권한 템플릿'으로 보고 각 네임스페이스마다 RoleBinding으로 바인딩하는 패턴을 쓴다."
- **⚪ LOW** · `스토리라인누락` · _§2 ServiceAccount 완벽이해, line 241-303_
  - 문제: §2와 §1의 관계가 명확하지 않다. §1에서 RBAC(Role/RoleBinding)을 배운 후, §2에서 ServiceAccount가 갑자기 등장한다. "ServiceAccount는 Pod이 API 서버를 사용할 때의 신원(identity)이고, RBAC은 그 신원에 권한을 부여하는 메커니즘"이라는 연결고리가 빠졌다.
  - 보강: §2 도입부에 명시: "§1에서 배운 RBAC은 User·Group·ServiceAccount라는 Subject를 기준으로 권한을 부여한다. 그 중 ServiceAccount는 Pod 내부 프로세스가 API 서버에 인증할 때 사용하는 신원이다. 이번 절은 ServiceAccount의 동작 원리(토큰 생성·마운트)와 RBAC 바인딩의 구체적 연결을 배운다."
- **⚪ LOW** · `실습재현불가` · _§5 실전시험문제, §6 여러 리소스에 대한 복합 Role(line 730-788)_
  - 문제: 문제 6의 Role 생성에서 `kubectl create role`으로 pods/services(core API)/configmaps/secrets(core API)과 deployments(apps API)을 섞어 놓았다. 학생이 `kubectl create role`로는 이를 한 번에 만들 수 없다는 것을 깨닫지 못하고, 시도했다가 실패할 수 있다. 풀이 과정에서 "복합 Role은 YAML로 생성하는 것이 더 정확하다"고 한 줄만 있는데, 학생이 왜 그런지 모를 수 있다.
  - 보강: 문제 6 풀이 과정 앞에 설명 추가: "주의: `kubectl create role`은 하나의 apiGroup에 속하는 리소스들만 한 번에 지정 가능하다. 이 문제는 pods/services/configmaps/secrets(모두 core API, \"\")과 deployments(apps API)을 섞어 있으므로 한 명령으로 불가능하다. YAML로 여러 규칙(rule)을 정의해야 한다." 정도의 함정 설명.
- **⚪ LOW** · `정확성오류` · _§4.2 CSR 절차, line 373-374_
  - 문제: CSR 생성 명령에서 `-subj "/CN=newuser/O=developers"`라고 했는데, 이 형식이 openssl 표준인지 확인이 필요하다. 대부분의 K8s 튜토리얼은 `/C=US/ST=CA/L=SanFrancisco/O=developers/CN=newuser` 같이 full DN을 쓴다. 단축형이 동작하는지 명시하거나, full DN으로 통일하는 것이 좋다.
  - 보강: 검증: 실제로 `openssl req -new ... -subj "/CN=newuser/O=developers"` 가 동작하는지 확인. 동작하면 주석 추가: "(O와 CN만 필수, 나머지 필드는 선택)" 또는 full DN 예제도 제시. 동작하지 않으면 full DN으로 수정 및 설명 업데이트.

### daily/day06.md  · 가독성 3/5 · 스토리라인 2/5 · 단독합격 ❌

**잘된 점:** 명령 집계: 문제별 끝이 명령이 정확하고 모두 실행 가능한 형태 / 검증 구조: 미니 기능을 일관되게 보여줌 / YAML 예제: 기본 개념이 쏫달

- **🔴 HIGH** · `용어비약` · _문제 7 첫 줄 및 전체_
  - 문제: 'ClusterRoleBinding', 'ClusterRole', 'RoleBinding', 'Role' 개념 등장배경 없이 조직됨. 학생은 이게 왜 4가지나 되는지, Role과 ClusterRole의 본질적 차이(네임스페이스 범위), RoleBinding/ClusterRoleBinding의 역할을 모르면 명령을 따라해도 왜 그렇게 하는지 알 수 없고, 시험에서 비슷한 문제(예: 'ClusterRole을 특정 NS에만 적용')에서 막힘.
  - 보강: 문제 7 전 '1.0 RBAC 4가지 리소스 빠른 입문'을 신설하되, 흑백 mermaid로 (1) Role/RoleBinding의 네임스페이스 범위 (2) ClusterRole/ClusterRoleBinding의 클러스터 범위 (3) ClusterRole + RoleBinding 조합(특정 NS에만 적용) 이 3가지 조합을 명확히 그린다. 각각 '어디서 사용되나'의 구체 사례(Pod 읽기권한 = Role, 노드 읽기권한 = ClusterRole, 여러 NS에서 같은 정책 = ClusterRole+RoleBinding)를 붙인다.
- **🔴 HIGH** · `스토리라인누락` · _문제 7~12 및 섹션 8_
  - 문제: RBAC이 '왜' 필요한지 등장배경 없음. 멀티테넌트 클러스터에서 admin이 모든 권한을 가질 수 없으므로 Role/SA로 분산·제한하는 것인데, 그 배경(예: 개발팀이 자신의 Pod만 조작하고 다른 팀 Pod는 못 건드려야 함 / 컨테이너가 API 요청할 때 전체 클러스터 권한이 아니라 필요한 것만 부여)이 없다.
  - 보강: day06 도입부에 '2~3분 읽을 수 있는 RBAC 등장배경' 섹션: (1) Pod가 API 서버와 통신할 때 무조건 전체 권한을 주던 초기 문제 (2) SA 토큰으로 제한하려 했지만 여전히 SA별 권한 세분화 부족 (3) Role/RoleBinding으로 '누가(SA·사용자·그룹) 어디서(NS·전체) 무엇을(Pod·Node) 언제(동사: get/delete) 할 수 있나'를 선언형으로 관리하는 이야기. 직전 기술(PSP = Pod Security Policy의 한계: 보안책임이 클러스터 수준, RBAC은 각 subject별 권한)도 언급.
- **🔴 HIGH** · `맥락점프` · _섹션 8 전체(8.1~8.5) vs 문제 7~12_
  - 문제: 문제 7~12는 기본 RBAC(Role/ClusterRole/RoleBinding/ClusterRoleBinding + ServiceAccount)이고, 섹션 8의 8.1~8.5는 고급(resourceNames·subresource·Aggregated·kubeconfig·CSR)인데, 두 부분이 자연스럽게 이어지지 않음. 문제 12 끝에서 suddenly 섹션 8.1로 점프하므로 학생이 '이제 뭐 배우나' 혼란. 아래 '추가 심화'를 읽기 전에 8.1~8.5의 목적·위치를 설명하는 브릿지가 필요.
  - 보강: 섹션 8의 헤더를 '## 8. 추가 YAML 예제 및 고급 RBAC 패턴'으로 변경하고, 맨 앞에 '문제 7~12에서 배운 기본 4가지 리소스(Role/RoleBinding/ClusterRole/ClusterRoleBinding + ServiceAccount)를 넘어선 고급 사용례를 다룬다. 시험에도 자주 출제된다.--'라는 한 줄 설명. 그리고 8.1부터 각 예제 앞에 '(CKA 출제율: 높음) 특정 Pod 이름만 제한' 같은 태그를 달아 왜 배우는지 학생이 알 수 있게 함.
- **🟡 MED** · `용어비약` · _섹션 8.4 'Aggregated ClusterRole'_
  - 문제: 'rbac.authorization.k8s.io/aggregate-to-view' 라벨이 무엇인지 설명 없음. 학생이 'aggregate-to-view'를 봐도 이게 'view라는 기본 ClusterRole에 자동으로 합쳐진다'는 뜻인지 모름.
  - 보강: 8.4 설명에 '라벨 'rbac.authorization.k8s.io/aggregate-to-view: "true"'는 K8s가 view ClusterRole을 사용자가 조회할 때 이 규칙을 자동으로 병합(aggregate)한다는 뜻이다. 즉, 별도 바인딩 없이 view 권한만으로도 servicemonitors를 조회할 수 있다'라고 추가.
- **🟡 MED** · `이해난이도` · _문제 9 'SA 토큰 확인' (79~116줄)_
  - 문제: Pod 생성 명령에서 busybox:1.36 이미지와 'sleep 3600' 명령이 같이 나옴. 학생이 '왜 sleep?' 하고 묻고, SA 토큰 경로(/var/run/secrets/)가 어디서 자동으로 마운트되는지 모르면 원리 이해 못함.
  - 보강: 문제 9 끝이 명령 전에 '2~3줄 설명: Pod가 생성될 때 K8s는 자동으로 할당 ServiceAccount의 토큰을 /var/run/secrets/kubernetes.io/serviceaccount/ 에 secret volume 으로 마운트한다. 여기엔 ca.crt(API 서버 CA), namespace(Pod의 네임스페이스), token(JWT 형태의 인증 토큰)이 들어간다. sleep 3600은 Pod가 즉시 종료되지 않도록 1시간 대기하기 위함이다.'라고 추가.
- **🟡 MED** · `이해난이도` · _문제 10 'automountServiceAccountToken: false' (128~159줄)_
  - 문제: 이 필드가 '왜' 필요한지 배경이 없음. 기본은 true인데 false로 설정할 필요성이 뭔지, 보안상 이점이 뭔지 학생이 모름.
  - 보강: 문제 10 도입에 '앞 문제 9에서 본 것처럼 Pod는 기본적으로 SA 토큰을 자동 마운트한다. 하지만 예를 들어 네트워크 통신만 하는 Pod는 API 서버에 접촉할 필요가 없으므로, 토큰을 마운트하지 않아 토큰 탈취 위험을 줄이는 것이 보안 모범사례다. 이 경우 automountServiceAccountToken: false로 설정한다.'라고 추가.
- **🟡 MED** · `정확성오류` · _섹션 '추가 심화' > CSR 처리 (638~683줄)_
  - 문제: CSR 프로세스에서 '## Step 4: CertificateSigningRequest 오브젝트 생성' 이후에 '## Step 6: 승인된 인증서 추출'이라고 했는데, Step 5(승인)가 없다. 그리고 Step 6 명령어에서 'base64 -d' 옵션이 모든 소(macOS zsh/bash, Linux)에서 동일한지 확실하지 않음(리눅스는 base64 -d, macOS는 base64 -D).
  - 보강: Step 4~6 순서를 명확히: (4) CSR 오브젝트 생성 → Pending (5) kubectl certificate approve jane-csr (6) 인증서 추출. 그리고 '## Step 7: kubeconfig에 사용자 추가'로 리네이밍. base64 디코딩은 'base64 --decode' 또는 'base64 -d' 로 표기하되, 주석에 '(macOS는 base64 -D, Linux는 base64 -d)' 라고 환경별 차이 명시.
- **🟡 MED** · `구조` · _섹션 '추가 심화 학습' (492줄) 앞_
  - 문제: 이 섹션이 'day06.md'의 마지막 대단원인데, 복습체크리스트(§9)와 내일 예고(§367~369) 사이에 불쑥 나옴. 문서 흐름이 정렬되지 않음: 복습·시험팁 → 내일예고 → tart실습 → 추가심화 가 순서가 이상함.
  - 보강: 섹션 순서를 다시 정렬: (1) 문제 7~12 (2) 섹션 8 (3) 복습 체크리스트 (4) 시험 팁 (5) 추가 심화 학습 (6) tart-infra 실습 (7) 내일 예고. 아니면 'tart-infra 실습'을 '실습 1: 개념 확인'과 '실습 2: 손으로 하기' 로 분리해 복습과 함께 배치.
- **🟡 MED** · `실습재현불가` · _문제 8 'cluster-admin 규칙 확인' (47줄) 및 이하_
  - 문제: 학생이 'dev' 클러스터에서 이 명령을 실행할 때, dev 클러스터의 cluster-admin이 example image 처럼 그대로 '[*]' 을 반환하는지 알 수 없음. 표준 K8s 설치에서는 그렇지만, tart 클러스터가 다를 수 있고, 이미지는 'dev-실측'이라고 했으므로 모든 dev 와 다를 가능성 있음.
  - 보강: 문제 8 명령 뒤에 '예상 출력 설명: cluster-admin ClusterRole은 K8s 표준 ClusterRole로, 모든 리소스(*.*) + 모든 동사(*) + 모든 Non-Resource URL(*)에 대한 무제한 권한을 가진다. 각자의 dev 클러스터에서도 동일하게 나타난다.'라고 추가해 학생이 자신의 출력이 다르면 뭐가 잘못된 건지 판단할 기준을 제공.
- **⚪ LOW** · `용어비약` · _문제 11 'CSR 거부' (163~186줄)_
  - 문제: 'CSR'이 'CertificateSigningRequest'의 약자인지, 왜 'suspicious-user'라는 CSR이 Pending 상태인지, 거부했을 때 실제 효과가 뭔지 설명 없음. 학생이 '이 CSR 거부가 시험에서 왜 나오나' 하는 의문을 풀지 못함.
  - 보강: 문제 11 도입에 'CertificateSigningRequest(CSR)는 새 사용자가 클러스터의 CA에게 인증서 서명을 요청하는 오브젝트다. 관리자는 요청을 검토 후 approve 또는 deny 할 수 있다. 만약 의심스러운 사용자(예: 퇴사한 직원)가 인증서를 요청했다면 deny로 거부해야 한다.'라고 추가.

### daily/day07.md  · 가독성 3/5 · 스토리라인 3/5 · 단독합격 ❌

**잘된 점:** Deployment의 등장배경을 명확히 서술 (ReplicationController의 클라이언트 한계 vs 서버측 Deployment Controller) / Mermaid 다이어그램 5개로 관계도·동작 흐름을 명확하게 시각화 / YAML 필드별 인라인 주석으로 의도·기본값·주의점 상세 설명 (§1.3 lines 91-182)

- **🔴 HIGH** · `실습재현불가` · _Section 4 lines 496-823_
  - 문제: 20개 문제 풀이에 kubectl 명령만 있고 실제 출력 스크린샷 없음. CLAUDE.md §4①: 모든 명령 결과는 터미널 스크린샷 필수
  - 보강: 각 문제 풀이 끝에 실제 kubectl get deployment/pods 스크린샷 추가 또는 placeholder 제거
- **🔴 HIGH** · `실습재현불가` · _§3 실습 (lines 877-949)_
  - 문제: 6개 이미지 경로 placeholder가 있으나 실제 파일 없음 (images/day07-01~06.png). CLAUDE.md §4①: 명령 출력은 반드시 실제 스크린샷
  - 보강: tart dev 클러스터에서 실제 명령 실행 후 스크린샷 6개 생성 및 저장, 또는 placeholder 제거
- **🟡 MED** · `용어비약` · _§1.2 line 79-81_
  - 문제: Pod Template Hash를 정의 없이 사용 — 해싱이 무엇이고 왜 필요한가 설명 부족
  - 보강: Hash란 무엇이고 왜 필요한가 1문단 추가 (collision avoidance·rollback 편의)
- **🟡 MED** · `용어비약` · _§1.3 metadata.namespace (line 98)_
  - 문제: namespace 필드가 갑자기 나타나 정의 없음. K8s background 없는 학생이 OS kernel namespace와 혼동 가능
  - 보강: namespace 정의 1줄 추가 (논리적 테넌트 분리, 선택사항, RBAC·리소스쿼터 단위)
- **🟡 MED** · `용어비약` · _§1.3 line 156 (imagePullPolicy)_
  - 문제: 3가지 값(Always, IfNotPresent, Never)을 나열만 함. 언제 어떤 걸 써야 하는가 미설명
  - 보강: 각 정책의 쓰임과 비용(네트워크·latest 태그) 및 권장 상황 3줄 추가
- **🟡 MED** · `스토리라인누락` · _§1.4 line 184-242_
  - 문제: maxSurge/maxUnavailable 계산만, 언제 어떤 값을 선택해야 하는가 미설명. 리소스 트레이드오프 없음
  - 보강: §1.4 끝에 "리소스 충분 vs 부족" 시나리오별 전략 선택 가이드 추가 (maxSurge=50%의 위험성)
- **🟡 MED** · `스토리라인누락` · _§1.3 line 120-122 (minReadySeconds)_
  - 문제: minReadySeconds 정의는 있으나 왜 프로덕션에서 10~30초를 권장하는지 이유 미설명
  - 보강: ReadinessProbe의 한계(초기화 완료 미보장) + minReadySeconds의 보험 역할을 1문단 추가
- **🟡 MED** · `이해난이도` · _§2.1 line 323-325 (rollout history --revision)_
  - 문제: --revision=2 출력이 "상세 정보"로만 표현. 학생이 실제 실행 시 어떤 형태인지 모름
  - 보강: 실제 dev 클러스터에서 --revision=1/2 스크린샷 (nginx-deploy 이미지 비교) 추가
- **🟡 MED** · `이해난이도` · _§2.2 line 350-372_
  - 문제: 4가지 이미지 업데이트 방법 나열만, CKA 120분 / 15~20문제 제약 미명시
  - 보강: 시간 전략 명시: "set image는 1초, edit은 10초 = 9초 손실 → CKA에서는 set image 우선"
- **⚪ LOW** · `맥락점프` · _§3.2 (line 466-473) 과 §3.3 (line 475-492) 경계_
  - 문제: §3.3의 실수 #1 "selector/labels 불일치"는 이미 §1.2에서 언급. 연결 없이 반복되어 혼동 가능
  - 보강: §3.3 시작에 "§1.2의 selector 검증 에러는 배포 시작 전, 다음 5가지 실수는 배포 후 rollout 진행 중에 발생" 명시
- **⚪ LOW** · `맥락점프` · _§1.5 (line 271) 과 §2.1 (line 306) 경계_
  - 문제: §1.5는 내부 동작(이론), §2.1은 kubectl 명령(실무). 연결이 약해 학생이 관계를 못 봄
  - 보강: §2 시작 전 1줄 브리지: "다음은 §1.5의 내부 동작을 kubectl로 관찰·제어하는 방법"
- **⚪ LOW** · `용어비약` · _§1.1 line 27_
  - 문제: reconciliation loop를 사전 정의 없이 사용. 제어이론이나 K8s 배경 없는 학생이 막힘
  - 보강: reconciliation 정의 1줄 추가: "Desired == Actual 일치 위해 반복 수행하는 작업"
- **⚪ LOW** · `구조` · _§2.5 Deployment Conditions (line 427-443)_
  - 문제: 3개 Condition을 정의만 함. (Available, Progressing, ReplicaFailure) 조합 의미 미설명. Troubleshooting 판단 불가
  - 보강: Condition 상태 조합 테이블 추가: True/False 4조합 × 3개 = 8가지 상황별 의미

### daily/day08.md  · 가독성 3/5 · 스토리라인 2/5 · 단독합격 ❌

**잘된 점:** 문제 15개가 순차적으로 구체적 실습 절차를 제시하며 시험 스피드 중심 / ReplicaSet·Pod 3계층 관계를 다이어그램과 텍스트로 설명(§5.3) / minReadySeconds·maxSurge·maxUnavailable 같은 필드별로 개별 문제를 할당해 체계적

- **🔴 HIGH** · `스토리라인누락` · _문제 9~14 전체_
  - 문제: Deployment의 왜(등장배경)가 완전 생략. 학생이 '이 기술이 언제 필요한가'를 못 이해해 실습이 기계적 명령 반복이 됨. Pause/Resume(문제9)·revisionHistoryLimit(문제11)·Probe(문제12)·minReadySeconds(문제13)의 동작 필요성이 없음.
  - 보강: 문제 9 앞에 '등장배경' 섹션: '기존 방식(한 번에 하나씩 배포)의 문제 → Pause로 여러 변경을 모아서 한 번에 적용함으로써 중간 버전(broken state) 방지' 같은 구체 스토리. 문제 11 앞: '왜 이전 ReplicaSet을 보관하나 → 빠른 롤백 필요 → 무한정 보관하면 etcd 비대 → revisionHistoryLimit으로 제한' 같은 연결고리.
- **🔴 HIGH** · `용어비약` · _라인 86 (문제 10 Endpoints 개념)_
  - 문제: 'Endpoints'가 처음 등장하는데 '뒤를 받치는 Pod IP:포트 목록'이라 설명만 함. 학생이 '이게 뭐가'일 이해 못한 채 명령만 따라함. Service의 load balancing 메커니즘과 Endpoints의 관계가 빔.
  - 보강: 문제 10 시작 전에 짧은 섹션: 'Service는 고정 Cluster IP를 가지지만 실제 트래픽은 Endpoints의 Pod IP로 전달됨(kube-proxy/iptables 또는 Cilium이 중재). Service 생성 시 selector 라벨이 자동으로 Endpoints를 만들고 Pod의 status.podIP가 추가됨.' + 다이어그램(Service Box → Endpoints[Pod1_IP:80, Pod2_IP:80 ...]).
- **🔴 HIGH** · `구조` · _라인 1~50 (문제 9~10)과 라인 654~876(섹션 5. 고급 동작 원리)의 순서 역전_
  - 문제: 고급 개념(reconciliation loop, rolling update sequence, pause/resume 메커니즘)이 모든 문제 뒤에 위치. 학생이 문제를 먼저 만나서 '이게 뭐지' 이해 못한 채 실행만 하고, 나중에 '아, 이래서 이렇게 동작했구나' 깨닫는 비효율. 역순 진행이 최악.
  - 보강: 문서 구조 재배치: 섹션 5(reconciliation loop·rolling update sequence·pause/resume 원리)를 문제 9~14 앞으로 이동. 또는 각 문제의 '<details> 풀이' 바로 위에 '동작 원리' 미니 섹션 추가. 예: 문제 9 앞에 'Pause/Resume의 메커니즘: spec.paused=true 시 template 변경이 ReplicaSet 생성 트리거 안 함. 여러 변경을 한 번의 ReplicaSet으로 적용 가능' 설명.
- **🔴 HIGH** · `이해난이도` · _라인 141~198 (문제 12. Probe)_
  - 문제: Readiness/Liveness Probe가 왜 필요한가, 없으면 뭐가 문제인가 설명 없음. 학생이 'HTTP GET 포트 80' 같은 문법만 외우게 됨. 실제 배포 시나리오(예: 앱 기동 중 트래픽 받으면 안 되는 상황)가 없어 개념이 깊게 안 들어옴.
  - 보강: 문제 12 앞에 'Probe의 스토리: ⓐ Pod가 Running이어도 앱이 아직 초기화 중일 수 있음(readiness) ⓑ 앱이 hang/deadlock에 빠질 수 있음(liveness) ⓒ Probe 없으면 불안정한 파드도 트래픽을 받아 cascading 장애 발생. ⇒ readinessProbe: Pod가 Ready 상태로 service traffic을 받을 준비 확인. livenessProbe: Pod가 살아있는지(dead lock 아닌지) 주기적 쩔크' + 예시(nginx 초기화 30초 걸릴 때 initialDelaySeconds=30 설정하는 이유).
- **🟡 MED** · `정확성오류` · _라인 72 (문제 10, expose 명령)_
  - 문제: `kubectl expose deployment web-frontend --port=80 --target-port=80 --name=web-frontend-svc`에서 `--target-port`가 컨테이너 포트를 지정하는데, web-frontend Deployment가 port를 명시하지 않았으므로 target-port=80 설정이 작동 보장 불확실. Deployment 생성 시 `--port=80` 옵션이 없음(라인 69).
  - 보강: 라인 69 Deployment 생성 시 `kubectl create deployment web-frontend --image=nginx:1.24 --replicas=3 --port=80`으로 수정하거나, Deployment 생성 후 yaml로 containerPort 추가. 또는 expose 명령 설명에 '이 Deployment의 컨테이너 포트가 80이라 가정' 명시.
- **🟡 MED** · `맥락점프` · _라인 795~876 (tart-infra 실습 섹션)_
  - 문제: 'dev 클러스터에 꽂혀서 demo 앱이 배포된 상태'를 전제(라인 796~802). 그러나 학생이 fresh 클러스터를 기동했다면 demo 네임스페이스와 nginx-web Deployment가 없음. 예상 출력 이미지들이 '[미캡처]'로 표기되거나 없어 보임. 학생이 '나는 왜 이미지처럼 안 나오나'고 혼란.
  - 보강: 라인 783~788에 'tart-infra 실습'을 수행하기 전에 '준비 단계: demo 네임스페이스와 nginx-web Deployment를 다음 명령으로 직접 생성하세요' + `kubectl create namespace demo` + `kubectl create deployment nginx-web --image=nginx:1.25 --replicas=2 -n demo` 명시. 또는 모든 예상 출력 이미지가 실제 존재하는지 확인 후 로드.
- **🟡 MED** · `용어비약` · _라인 656~673 (Reconciliation Loop 다이어그램)_
  - 문제: 'kube-controller-manager'라는 용어가 갑자기 등장(라인 657). 학생이 '뭐가'를 모름. Deployment Controller가 kube-controller-manager 프로세스의 한 부분이라는 설명도 부족.
  - 보강: 다이어그램 전 1문단: 'Kubernetes 마스터 노드에서 실행되는 kube-controller-manager는 여러 컨트롤러를 포함하는데, 그 중 Deployment Controller가 Deployment 리소스를 담당한다. 이 컨트롤러는 지속적으로(reconciliation loop) 원하는 상태와 현재 상태를 비교해 Pod를 생성/삭제/수정한다.' 추가.
- **🟡 MED** · `맥락점프` · _라인 470~514 (문제 18. matchExpressions)_
  - 문제: matchLabels와 matchExpressions의 차이·용도가 설명 안 됨. 왜 matchExpressions가 필요한가(예: 복합 라벨 조건, In/NotIn 연산자)를 모르고 '그냥 이렇게 쌀다'만 배우게 됨.
  - 보강: 문제 18 앞에: 'selector에는 두 가지 방식이 있다: ⓐ matchLabels - 간단한 key:value 동등 비교(app: web) ⓑ matchExpressions - 복합 조건(예: app In [web,api], tier NotIn [db]). CKA 시험에서는 matchLabels가 주로 나오지만, 복잡한 selector는 matchExpressions로 작성한다.'
- **⚪ LOW** · `이해난이도` · _라인 733~742 (복습 체크리스트)_
  - 문제: 'maxSurge=25%, replicas=4일 때 최대 Pod 수를 계산할 수 있는가' 같은 계산 문제가 있는데, 몸에서 문제 본문에 계산 예시나 해설이 전혀 없음. 학생이 직접 알아내야 함.
  - 보강: 라인 745~756 '시험 팁' 섹션 끝에 '계산 팁: maxSurge=25%, replicas=4 ⇒ surge 수=ceil(4 × 0.25)=1 ⇒ 최대 Pod=4+1=5. maxSurge=25%, replicas=3 ⇒ surge 수=ceil(3 × 0.25)=1 ⇒ 최대 Pod=3+1=4' 같은 예시 2~3개 추가.
- **⚪ LOW** · `용어비약` · _라인 209 (minReadySeconds 설명)_
  - 문제: 'Pod가 Ready 후 30초 대기'는 영문 문서 직역이라 모호. Ready 상태가 뭐가(readiness probe 통과?), 왜 30초 더 기다려야 하는가(실제 트래픽 받기 전 안정화?).
  - 보강: 'minReadySeconds: 30 — Pod가 Ready 상태(readiness probe 통과)가 된 후, Service의 Endpoints에 추가되기 전에 추가로 30초 대기. 이 시간 동안 앱이 진정한 안정화되도록 보장.' 설명 추가.

### daily/day09.md  · 가독성 3/5 · 스토리라인 2/5 · 단독합격 ✅

**잘된 점:** 구조화된 학습 목표와 명확한 체크리스트 / Taint/DaemonSet/LimitRange 흐름을 Mermaid 다이어그램으로 시각화 / 실습 단계별 구체적의 kubectl 명령어 제시

- **🔴 HIGH** · `용어비약` · _섹션 1.2 표 (40-43줄)_
  - 문제: Effect 용어가 첫 등장할 때 정의 없이 NoSchedule/PreferNoSchedule/NoExecute만 나열되어, 사전지식 없는 학생이 'Effect가 정확히 무엇인지' 모르고 진행함
  - 보강: 표 위에 한 문장 추가: 'Effect는 Taint가 Pod 스케줄링에 미치는 영향 수준을 지정하는 필드다'
- **🔴 HIGH** · `스토리라인누락` · _섹션 1.1 등장 배경 (23-25줄)_
  - 문제: 문제를 설명하지만 '직전에 뭘 썼나'가 없음. nodeSelector만으로는 부족하다고 하는데, nodeSelector 정의는 섹션 2에서 나옴. 순환 참조로 첫 읽음이 어려움
  - 보강: 섹션 1.1에 명시: 'nodeSelector는 노드 라벨로 Pod를 배치하는 간단한 방식인데, 반대로 특정 노드들에 Pod를 오지 못하게 막는 방법이 없었다. 이것이 Taint의 등장 이유다'
- **🔴 HIGH** · `정확성오류` · _섹션 1.2 표, PreferNoSchedule 행 (42줄)_
  - 문제: '스코어링 단계에서 해당 노드의 점수를 감점'은 부정확함. 실제로는 kube-scheduler가 다른 노드를 더 높게 점수 매겨 상대적으로 낮아지는 것이지, 절대 감점이 아님
  - 보강: '다른 노드 후보에 비해 상대적으로 낮은 점수를 받아 스케쥴링 우선순위가 떨어짐'으로 수정
- **🟡 MED** · `용어비약` · _섹션 1.3 다이어그램 (70-75줄)_
  - 문제: 'Equal: key,value,effect 일치' / 'Exists: key,effect 일치'를 그대로 다이어그램에 넣음. 'operator'라는 개녀이 먼저 설명되지 않아 다이어그램을 읽기 어려움
  - 보강: 다이어그램 전에 한 문장 추가: 'Toleration의 operator는 Equal(정확 일치) 또는 Exists(키만 확인)를 선택한다'. 또는 섹션 1.5 YAML과 순서 맞추기
- **🟡 MED** · `맥락점프` · _섹션 2.2 Node Affinity YAML 전 (253-284줄)_
  - 문제: operator 6가지(In, NotIn, Exists, DoesNotExist, Gt, Lt)가 섹션 2.4 표에 나옴. 학생이 YAML을 이해하려면 operator를 먼저 알아야 하는데, 구조가 역순임
  - 보강: YAML 예제 전에 operator 표를 먼저 삽입. YAML에서는 In/NotIn만 먼저 쓰고, Gt/Lt는 섹션 2.4 심화로 미루기
- **🟡 MED** · `스토리라인누락` · _섹션 2 전체 (215줄 이후)_
  - 문제: nodeSelector와 Node Affinity가 '단순한 방식 vs 유연한 방식'으로만 대조됨. 왜 nodeSelector로는 부족한가의 구체적 문제(OR 조건 필요, 선호도 표현 필요)가 먼저 설명되지 않음
  - 보강: '2.1 nodeSelector의 한계'를 별도 단락으로 먼저 제시(구체적 사용 불가 사례 포함) → '2.2 Node Affinity가 이를 해결'하는 구조로 재배치
- **🟡 MED** · `이해난이도` · _섹션 3.1 DaemonSet 정의 (392-394줄)_
  - 문제: 정의가 한 문장으로 너무 깊음 — 'Controller는 노드 추가/제거 이벤트를 Watch하여 자동으로 Pod를 생성/삭제'는 'Controller', 'Watch', '재조정' 같은 쿠버네티스 내부 용어를 가정함. 초심자는 따라가기 어는움
  - 보강: 먼저 직관: 'DaemonSet은 모든 워커 노드에 정확히 하나씩 Pod를 자동으로 배치하는 도구다' → 그 다음 동작: '새 노드가 추가되면 DaemonSet은 그 노드에 자동으로 Pod를 하나 생성한다'
- **🟡 MED** · `실습재현불가` · _섹션 4.2 Job YAML, command 필드 (568줄)_
  - 문제: command: ["sh", "-c", "echo Processing batch $RANDOM && sleep 5"] — $RANDOM이 쉘 변수인데, YAML 쌍따옴표 안에 있으면 쿠버네티스가 렌더링하지 않음(리터럴 문자열로 취급). 학생이 그대로 apply하면 'batch'만 나왔고 랜덤 번호가 않 나옵
  - 보강: 쌍따옴표를 작은따옴표로 바꾸거나, $를 이스케이프: command: ["sh", "-c", "echo 'Processing batch'$RANDOM && sleep 5"] 또는 "echo Processing batch \$RANDOM && sleep 5"
- **🟡 MED** · `정확성오류` · _섹션 4.3 CronJob 설명 (612줄)_
  - 문제: 'startingDeadlineSeconds로 스케줔 지연 허용 범위를 설정한다' — 의미가 모호함. 실제로는 '스케줔된 시간으로부터 N초 내에 Job이 시작되지 않으면 그 실행을 건너뜬다'는 뜻이지, '지연을 허용'이라는 표현은 반대처럼 들림
  - 보강: '스케줔된 시간으로부터 N초 내에 Job이 시작되지 않으면 높여진 끌린 실패(missed deadline)로 스기 처리된다'로 명확히
- **⚪ LOW** · `구조` · _섹션 5 Resource 관리 (698줄 이후)_
  - 문제: Resource Requests/Limits/LimitRange/ResourceQuota가 갑자기 나옴. 이전은 스케쥴링 심화(Taint/Affinity/DaemonSet)만 있다가 다른 주제로 점프. 섹션 간 연결이 끊김
  - 보강: 리소스 관리 섹션 시작 전에 한 문단: '스케쥴러는 Taint/Affinity로 "Pod가 어느 노드에 배치될지"를 결정하고, 이제 "Pod가 얼마나의 CPU/메모리를 쓸지"의 상한과 최소 보장을 Requests/Limits로 설정한다'
- **⚪ LOW** · `용어비약` · _섹션 5.1 설명 (721줄)_
  - 문제: 'cgroup의 cpu.shares, memory.min에 매핑'이라는 표현. 컴공 4학년이 cgroup을 알 수 있지만, '매핑이 무엇'인지 모르는 학생을 위해 괄호 주석 필요
  - 보강: 괄호 추가: 'cgroup (Linux의 리소스 격리 메커니즘)의 cpu.shares/memory.min에 설정된다'

### daily/day10.md  · 가독성 2/5 · 스토리라인 1/5 · 단독합격 ❌

**잘된 점:** 14개 실기 문제가 스케줄링·리소스 관리 주요 주제를 광범위하게 커버한다 / 각 문제의 kubectl 명령이 정확하고 실행 가능하다 / 복습 체크리스트와 시험 팁 섹션이 시험 대비 관점을 제시한다

- **🔴 HIGH** · `스토리라인누락` · _문제 4~20 전체_
  - 문제: 각 기술(CronJob, Node Affinity, ResourceQuota 등)이 왜 만들어졌는지, 이전 기술의 한계가 무엇인지, 개선된 점이 뭔지에 대한 스토리가 완전히 없다. 날짜 헤더에 'Part 2 실전'이라고만 되어 있어 day09의 맥락과 연결이 끊겨 있다
  - 보강: 각 문제별로 '등장 배경' 섹션을 2-3줄 추가한다. 예: '문제 4 CronJob: Job은 일회성이므로 반복 실행이 필요하면? cron처럼 주기적 작업을 쉽게 관리하려고 CronJob이 나왔다. schedule 필드로 cron 표현식을 쓸 수 있다.' 형식. day09에서 Job을 다뤘다면 연결 문장을 넣는다
- **🔴 HIGH** · `용어비약` · _전체 문서, 특히 문제 5 Node Affinity, 문제 9 NoExecute Taint, 실습 섹션_
  - 문제: Affinity, Taint, Toleration, tolerationSeconds, topologyKey, requiredDuringSchedulingIgnoredDuringExecution, QoS 등 핵심 용어가 첫 등장할 때 정의가 없다. nodeSelector와 Node Affinity의 차이도 설명하지 않아 학생이 왜 이 개념이 있는지 모른다
  - 보강: 각 용어의 첫 등장 시 한 문장 풀이를 붙인다. 예: 'Node Affinity(노드 친화성): 스케줄러가 Pod를 특정 노드에 배치하는 강제·선호 규칙. nodeSelector보다 복잡한 표현식(In, NotIn, Gt, Lt)을 지원한다.' / 'Taint(오염): 노드에 붙는 거부 표시. Pod에 대응하는 Toleration이 없으면 그 노드에 스케줄되지 않는다.' / 'tolerationSeconds: NoExecute Taint 때문에 축출되기 전 Pod가 얼마나 오래 그 노드에 남을 수 있는지 초 단위로 설정하는 필드'
- **🔴 HIGH** · `실습재현불가` · _실습 섹션 전체 (이미지 경로: day10-01-cronjob.png, day10-02-quota-empty.png 등 8개)_
  - 문제: 모든 실습 결과 이미지가 참조만 되고 실제 파일이 없다(images/ 디렉토리 자체가 없거나 이미지가 업로드되지 않았음). 학생이 명령을 따라 해도 '내 출력이 책의 예상 출력과 같은가'를 확인할 수 없다. CLAUDE.md §4①에서 절대 규칙인 '실제 터미널 스크린샷 PNG'가 완전히 부재하다
  - 보강: 실제 dev/staging 클러스터에서 각 명령을 실행하고 터미널 스크린샷을 PNG로 캡처해 images/day10-*.png에 저장한다. 특히: ① 문제 4 CronJob 생성 후 'kubectl get cronjobs' 출력 ② 문제 6 ResourceQuota 확인 후 'kubectl describe resourcequota' 출력 ③ 문제 10 Pod Anti-Affinity 확인 후 'kubectl get pods -o wide' 출력 ④ tart-infra 섹션의 'kubectl describe nodes | grep Taints' 출력
- **🔴 HIGH** · `이해난이도` · _문제 5 (Node Affinity 요청 매칭 규칙), 문제 9-10 (required vs preferred Affinity), 문제 20 (tolerationSeconds 동작 타이밍)_
  - 문제: Kubernetes 스케줄러의 내부 동작 메커니즘이 없어서 YAML 필드들이 왜 그 이름인지, 무엇을 한다는 뜻인지 학생이 유추할 수 없다. 예: requiredDuringSchedulingIgnoredDuringExecution이라는 긴 필드명이 '스케줄링 중에는 필수, 실행 중에는 무시'라는 뜻인지 학생이 어떻게 알겠는가. preferredDuringSchedulingIgnoredDuringExecution과의 차이는?
  - 보강: 각 개념별 '내부 동작' 섹션을 추가한다. 예: 'Node Affinity의 requiredDuringSchedulingIgnoredDuringExecution: 스케줄러는 Pod 생성 시 이 규칙을 만족하는 노드만 선택한다(진짜 Pod가 배치되지 않음). 하지만 Pod가 이미 실행 중이고 노드의 라벨이 바뀌어 규칙에 맞지 않아도 Pod는 축출되지 않는다(IgnoredDuringExecution).' / 'Pod Anti-Affinity의 topologyKey 역할: 기본값 kubernetes.io/hostname은 각 노드가 고유한 hostname을 가진다고 가정하고, Pod들이 다른 노드에 분산되도록 강제한다. topology.kubernetes.io/zone을 쓰면 같은 가용영역(AZ)이어도 다른 노드면 허용한다'
- **🔴 HIGH** · `맥락점프` · _day10 첫 줄(문제 4부터 시작), tart-infra 섹션의 Cilium/metrics-server/CoreDNS 등장_
  - 문제: day10이 day09를 전제로 시작되는데 day09의 내용이 언급되지 않는다. tart-infra 실습에서도 'Cilium DaemonSet'이 갑자기 나오는데, 학생이 Cilium이 뭔지(kube-proxy 대체 CNI), DaemonSet이 뭔지 모를 수 있다. metrics-server도 마찬가지다
  - 보강: day10 첫머리에 '복습: day09에서 Job과 Deployment 기본을 배웠다. 이제 Job을 반복 스케줄하고, Pod를 특정 노드에만 배치하며, 리소스를 할당量으로 제한하는 고급 기법을 배운다' 한 문장 추가. tart-infra 실습에서 Cilium 첫 등장 시 '(kube-proxy 대체 네트워킹 플러그인)' 괄호 설명 추가
- **🟡 MED** · `정확성오류` · _문제 6 설명 (라인 136)_
  - 문제: '이 네임스페이스에서 Pod를 생성하려면 반드시 resources.requests/limits를 명시해야 한다(quota에 CPU/memory가 포함되어 있으므로)' — 정확히는 Pod가 아니라 Pod 내 각 '컨테이너'에 resources를 지정해야 한다. 또한 'quota에 CPU/memory가 포함'이라는 표현은 'quota에 requests.cpu/requests.memory/limits.cpu/limits.memory 중 하나라도 있으면'으로 정확해야 한다
  - 보강: 문장을 다시 쓴다: 'ResourceQuota에 요청/제한 관련 항목(예: requests.cpu, limits.memory)이 포함되면, 해당 네임스페이스에서 생성하는 모든 Pod의 모든 컨테이너에 해당하는 resources.requests/limits를 명시해야 한다(quota 제약을 검증하기 위해). 생략하면 Forbidden 오류가 난다'
- **🟡 MED** · `정확성오류` · _문제 14 설명 (라인 454)_
  - 문제: 'concurrencyPolicy: Forbid (이전 Job 실행 중이면 스킵)' — 정확히는 'concurrencyPolicy: Forbid는 동시 실행을 금지한다. 이전 Job이 완료되지 않았으면 그 스케줄 간격을 건너뛴다(스킵)' 로 표현해야 한다. '이전 Job 실행 중'이라는 표현은 이미 실행 완료된 Job이 있고 새 스케줄이 다시 오는 상황인지, 아직 같은 Job이 실행 중인 상황인지 모호하다
  - 보강: 문장을 명확히 한다: 'concurrencyPolicy: Forbid: 이전 Job이 아직 실행 중(완료되지 않음)이면 다음 스케줄 사이클이 와도 새 Job을 생성하지 않는다(건너뜬다)' / 추가로 concurrencyPolicy의 3가지(Allow, Forbid, Replace) 설명 짧게 추가
- **🟡 MED** · `이해난이도` · _시험 팁 섹션 (라인 824-825)_
  - 문제: '모든 Taint tolerate -- `tolerations: [{operator: Exists}]`' 팁이 있지만, Exists 연산자의 정확한 의미('key만 매칭, value 무관')를 문제 13 전에 설명하지 않았으므로 학생이 이 팁을 이해하지 못한다. Equal 연산자와 비교 없이 팁만 주면 전술로만 봐 원리가 없다
  - 보강: 시험 팁 섹션 직전에 '팁 배경' 문단을 추가한다: 'Toleration의 operator에는 Equal(value를 정확히 매칭)과 Exists(key만 있으면 모든 value 허용)가 있다. 따라서 "이 노드의 모든 Taint를 tolerate하려면" `- operator: Exists`만으로 모든 Taint를 수용한다. CKA 실기에서 시간이 부족하면 이 팁을 쓴다'
- **🟡 MED** · `구조` · _체크리스트 항목들 (라인 807-821)_
  - 문제: 체크리스트에 '□ QoS 클래스 3가지와 결정 기준을 아는가?' '□ Static Pod의 특징과 경로를 아는가?'가 있지만 본 문서에서 다루지 않는다. 학생이 체크리스트를 읽고 '이게 CKA 시험에 나오나?'라고 헷갈린다
  - 보강: day10에서 다루지 않는 항목은 체크리스트에서 제거하거나, '(day11에서 학습)' 표기를 붙인다. 또는 이 섹션 상단에 '다음은 day10에서 배운 내용 중 핵심이다'라는 스코프 정의를 추가한다
- **⚪ LOW** · `용어비약` · _문제 11 설명 (라인 343)_
  - 문제: DaemonSet에 'nodeSelector'를 사용하는데, 그 구문이 Pod와 동일하다는 설명이 없다. Deployment와 DaemonSet의 nodeSelector 사용 차이도 없다
  - 보강: DaemonSet 설명 첫 문단에 한 줄 추가: 'nodeSelector 문법은 Deployment/Pod와 동일하다. DaemonSet은 매칭하는 노드에 자동으로 Pod 인스턴스를 하나씩 배포한다'
- **⚪ LOW** · `이해난이도` · _tart-infra 실습 3 (라인 907-919)_
  - 문제: 'Request: Scheduler가 노드 배치를 결정할 때 사용한다(예약량)' 'Limit: kubelet이 컨테이너의 실제 사용량을 제한한다'고만 설명되어 있다. request와 limit의 **동시성** (CPU는 쓰로틀, Memory는 OOMKill)이 명시되지 않았다
  - 보강: 문장을 보충한다: 'CPU Limit 초과 → 쓰로틀링(속도 저하, 프로세스 양보), Memory Limit 초과 → OOMKilled(프로세스 종료)' 이 부분은 이미 있지만, '왜 다른가'를 추가한다: 'CPU는 compressible(줄일 수 있음)이지만 메모리는 incompressible(회수 불가)이기 때문이다'

### daily/day11.md  · 가독성 4/5 · 스토리라인 3/5 · 단독합격 ❌

**잘된 점:** 등장 배경과 스토리라인 충실: Pod IP 불확정 문제로 Service의 필요성을 구체적으로 설명 / 4가지 Service 타입의 구조적 비교와 YAML 예제 제시 / 실제 kubectl 출력 스크린샷으로 이론-실제 연결

- **🔴 HIGH** · `용어비약` · _1.1, 3.1, 3.2_
  - 문제: Endpoints와 EndpointSlice를 구분 없이 혼용하여 초보자 혼동
  - 보강: 1.1에서 'Endpoints(단일, v1.20까지) vs EndpointSlice(v1.21+, 분할 방식)'으로 명확히 구분
- **🔴 HIGH** · `스토리라인누락` · _5.1 kube-proxy 동작 모드_
  - 문제: iptables/IPVS/eBPF 3가지 모드를 나열만 하고 왜 이런 순서로 진화했는지 설명 부재
  - 보강: iptables O(n) 한계 → IPVS O(1) → eBPF 커널 우회 순으로 진화 과정 및 trade-off 추가
- **🟡 MED** · `정확성오류` · _7절 예제16 IPv4/IPv6_
  - 문제: ipFamilyPolicy·ipFamilies를 YAML만 제시하고 설명 없음
  - 보강: 듀얼 스택 개념·사용시기·동작 방식·트레이드오프 한 단락 추가
- **🟡 MED** · `실습재현불가` · _8절 tart-infra 실습_
  - 문제: dev 클러스터 기동·kubeconfig 생성 등 전제조건을 설명하지 않음
  - 보강: 8.1을 '실습 환경 설정 및 전제조건'으로 변경하고 boot.sh·fix-cluster-ip-drift.sh 단계별 설명 추가
- **🟡 MED** · `이해난이도` · _5.2 iptables 규칙 예시_
  - 문제: KUBE-SERVICES 체인 구조와 역할 분담, --probability 옵션을 설명 없이 나열
  - 보강: 각 체인의 역할·의미 설명 후 실제 노드의 iptables 규칙 스크린샷 추가

### daily/day12.md  · 가독성 3/5 · 스토리라인 2/5 · 단독합격 ❌

**잘된 점:** 12개 실전 문제로 CKA 시험 빈출 Service 유형을 체계적으로 구성 / 진단 체크리스트 제공으로 문제 해결 논리 명확화 / 복습 체크리스트와 시험 팁으로 복습용 자료 완비

- **🔴 HIGH** · `용어비약` · _문제 1~5 및 §8 출제패턴_
  - 문제: ClusterIP, NodePort, Endpoints 같은 핵심 용어가 정의 없이 등장. Endpoints 오브젝트가 무엇인지(Service의 selector와 Pod를 매칭한 오브젝트), selector와 label의 관계, targetPort vs port 구분이 처음 배우는 학생 관점에서 설명 부족. day11에서 이들이 정의되었다고 가정하지만 링크·요약이 없음.
  - 보강: day12 첫머리에 '선수 조건' 박스 추가: 'ClusterIP/NodePort는 day11에서 배웠습니다. Service의 4가지 타입: ClusterIP(클러스터 내부, VIP), NodePort(모든 노드의 고정 포트), LoadBalancer(외부 로드밸런서), ExternalName(외부 도메인 매핑). Endpoints 정의: Service 생성 시 Endpoints Controller가 selector와 일치하는 Pod의 IP:Port를 Endpoints 오브젝트에 저장합니다. kube-proxy가 이를 읽어 트래픽을 분배합니다.'
- **🔴 HIGH** · `맥락점프` · _문제 1~12 전반, 이미지 참조(line 81, 138, 193, 383 등)_
  - 문제: 모든 '검증 기대 출력' 이미지(images/day12-01-clusterip.png 등)가 참조만 있고 실제 이미지가 없는 것으로 보임. CLAUDE.md §4①에서 '명령 실행 결과는 반드시 실제 터미널 스크린샷 이미지여야 하며, ```text 텍스트 블록은 금지'라고 했는데, day12는 대부분 텍스트 설명만 있고 스크린샷이 없음. 학생이 '실제로 뭐가 나올 거지?'로 혼란.
  - 보강: 모든 kubectl 명령(get svc, describe svc, get endpoints, nslookup 등)을 실제 클러스터(kubeconfig/dev.yaml)에서 수행해 터미널 스크린샷 PNG로 캡처. images/day12-01.png ~ images/day12-12.png (또는 관련 명령별) 생성. 참조만 있는 각 이미지 자리에 실제 스크린샷 삽입.
- **🔴 HIGH** · `실습재현불가` · _문제 2 line 101-102, 문제 3 line 168, 문제 4 line 209 등_
  - 문제: 문제 설정에 namespace, 기존 리소스 존재 여부가 불명확. 예: 문제 2 '네임스페이스 prod'라고 했지만 deployment 생성 시 namespace 미명시 → default로 생성될 수 있음. 문제 3 'nginx-web Service를 조회하라'고 했는데 이미 있는 건지 학생이 만들어야 하는 건지 불명확. 문제 4 'broken-svc가 있다'고 했는데 끝에는 시뮬레이션으로 새로 만듦. 학생이 직접 풀 때는 리소스 전제가 맞지 않을 수 있음.
  - 보강: 각 문제마다 '전제 조건' 박스 추가. 예: [문제 2] '캐텍스트: kubectl config use-context prod | 전제: default 네임스페이스 사용 (또는 특정 ns 명시)' [문제 3] '전제: 다음 Pod/Service가 이미 생성되어 있다고 가정하고 진행' 또는 '먼저 다음 리소스를 생성하세요' 명시. 끝의 '시뮬레이션' 부분은 별도 섹션으로 분리해 '이 문제를 직접 풀려면...' vs '검증용 시뮬레이션...' 구분.
- **🟡 MED** · `스토리라인누락` · _문제 5 (멀티포트) line 324, 문제 6 (Headless) line 385, 문제 7 (ExternalName) line 398_
  - 문제: 왜 멀티포트일 때 name이 필수인지, Headless Service가 왜 나왔는지, ExternalName이 뭐에 쓰는 건지 **배경·직관**이 부족. line 385의 Headless 등장 배경은 끝이의 '핵심 포인트' 안에 숨겨져 있고, 멀티포트 name은 '에러 발생' 사실만 있고 왜 필요한지 설명 없음. 학생은 '아 그래? 외워야겠네' 정도로만 느낌.
  - 보강: 각 문제 끝이 전에 'Why' 섹션 추가. 예: [문제 5 전] '### 멀티포트는 왜 name을 붙을까? | 단일포트 Service는 port→targetPort 매핑이 1:1이므로 자동 결정. 하지만 멀티포트면 Pod 입장에서 "Service의 5672는 내 5672로?", "내 15672로?" 구분해야 하므로, 각 port에 이름을 붙여 명확히 합니다.' [문제 6 전] '### Headless는 언제 쓸까? | 일반 ClusterIP는 DNS 조회 시 Service VIP 하나만 반환해 로드밸런싱에는 좋지만, Kafka처럼 각 broker-0, broker-1을 직접 지정해야 할 때는 불가능. Headless(clusterIP: None)는 Pod IP를 직접 반환해 StatefulSet의 개별 Pod에 직접 쇼근 가능하게 합니다.'
- **🟡 MED** · `이해난이도` · _문제 3 line 179-180 (dns-lookup 명령), line 195-196 (busybox:1.28 이유)_
  - 문제: dns-lookup 명령이 복잡함: '-it' 플래그와 '> /tmp/dns-output.txt' 리다이렉트를 함께 쓰면 호스트에서 리다이렉트가 실행되는데, Pod 내부에서 실행되는 것으로 오해할 수 있음. 또한 'busybox:1.28을 사용하는 이유는 musl libc'라는 설명(line 195)은 학부생이 이해하기 어려움(musl libc가 뭐지 배경 없음).
  - 보강: 문제 3 끝이에 명령 분해 설명 추가: '이 명령은 호스트의 /tmp/dns-output.txt에 씁니다. Pod 내부에서 리다이렉트하려면 sh -c "nslookup ... > /tmp/result.txt"로 감싸세요.' busybox:1.28 이유를 단순화: 'busybox:1.28을 사용하는 이유: 최신 busybox(1.35+)의 nslookup 동작이 다르므로 CKA 시험(1.28 기준) 동작과 맞춰야 합니다. 시험 권장.'
- **🟡 MED** · `맥락점프` · _day12 첫머리 및 각 문제 선입견_
  - 문제: day12가 day11(Service 개념)을 완전히 전제하지만, 링크나 요약이 없음. 학생이 day11을 안 읽으면 ClusterIP 정의부터 혼란. 또한 '서비스 디스커버리 종합' 섹션(문제 12)이 갑자기 나타나는데, 앞의 11개 문제와의 논리 흐름('이제 속도 훈련') 설명 없음. '이제 실제 속도 훈련' 같은 전환 설명 없음.
  - 보강: day12 헤더 바로 아래 '학습 흐름' 박스 추가: '이전 day: day 11에서 Service 4가지 타입, Endpoints, DNS 해석의 개념을 배웠습니다. 이 day는 그 개념을 실전 CKA 문제로 연습합니다. 핵심: Endpoints 비어있음 → selector 불일치, DNS 조회 실패 → kube-dns 문제, 쇼근 불가 → targetPort 불일치 같은 실제 장애를 진단·수정하는 훈련입니다.' 또한 §9(tart-infra 실습) 직전에 '위 12개 문제를 끝냈다면, 이제 실제 클러스터에서...' 전환 설명 추가.
- **⚪ LOW** · `구조` · _문제 2~12 전반, line 786 및 환경 변수 참조_
  - 문제: kubeconfig 경로가 절대 경로로 고정: '~/sideproejct/IaC_apple_sillicon/kubeconfig/dev.yaml'. 사용자가 다른 경로에 저장하면 동작하지 않음. CLAUDE.md §12에서 '상대경로 사용'을 앴시했지만 day12에서는 절대 경로만 사용.
  - 보강: 모든 kubeconfig 참조를 상대 경로 또는 환경변수로 변경. 예: 'export KUBECONFIG="${REPO_ROOT}/kubeconfig/dev.yaml"' 또는 처음 명령에 'REPO_ROOT=$(pwd) 설정. 또는 단순히 'kubeconfig/dev.yaml' 상대경로만 사용하도록 통일. tart-infra 실습 섹션(§9)도 동일 적용.

### daily/day13.md  · 가독성 3/5 · 스토리라인 3/5 · 단독합격 ❌

**잘된 점:** NetworkPolicy의 OR/AND 조건을 YAML 들여쓰기로 명확하게 구분한 설명 (섹션 2.1~2.4) — 다이어그램과 테스트가 조화 / Default Deny 패턴을 명확한 YAML 예제로 제시 (섹션 3) — 시험에서 자주 묻는 패턴 13개가 실전 형태로 정리됨 / NetworkPolicy의 기본 규칙 5개를 명확하게 나열 (섹션 1.3) — 학생이 암기해야 할 핵심이 구조화됨

- **🔴 HIGH** · `용어비약` · _섹션 1.4, line 34_
  - 문제: eBPF·iptables·veth pair 등 커널/OS 개념이 설명 없이 나타남. 학부 3~4학년이 이해하려면 '커널이 패킷을 필터링하는 규칙'처럼 한 줄 끝이 필수
  - 보강: 'eBPF(커널 레벨에서 동작하는 프로그램) 또는 iptables(방화벽 규칙)로 구현' → 각각을 '커널이 패킷을 검사·필터링하는 메커니즘'으로 설명하거나, 'Cilium 성능(eBPF)은 X배'처럼 구체적 이점 제시. veth pair는 '가상 네트워크 케이블(양쪽 끝이 연결된 인터페이스 쌍)' 수준의 비유 추가.
- **🔴 HIGH** · `스토리라인누락` · _섹션 4.1, line 278~331_
  - 문제: 'DNS를 허용하지 않으면 안 된다'는 결론만 있고, DNS 쿼리가 왜 Egress 차단 대상이 되는지의 메커니즘이 다이어그램에만 의존. 텍스트로 단계별 흐름을 설명하지 않음. 학생이 '아, Egress 정책이 DNS(UDP 53)도 필터링한다'는 원리를 모를 가능성 높음
  - 보강: DNS 해석 과정 4단계를 텍스트로 명시: (1) Pod가 서비스 FQDN을 직접 시도 → (2) CoreDNS로 UDP 53 쿼리 발송(Egress) → (3) DNS 응답 수신(Ingress 필요 없음, 응답은 같은 Egress 규칙에 포함) → (4) 반환된 IP로 실제 서비스 연결. 'Egress 정책이 53을 차단하면 2단계에서 멈춘다'고 명시.
- **🔴 HIGH** · `스토리라인누락` · _섹션 1.2, line 38_
  - 문제: '전통적인 방화벽 규칙은 IP 기반'이라는 설명은 있지만, K8s 환경에서 왜 Pod IP가 동적으로 변경되는지(재시작·이전·스케일링) 와, IP 기반 규칙이 감당할 수 없는 구체적 고통 사례(예: Pod 1.2.3.4가 다시 떠나면 1.2.3.5가 되는데, 규칙을 매번 수정해야 한다)을 설명하지 않음
  - 보강: 고통 시나리오 추가: 'Pod가 재시작되면 IP가 1.2.3.4 → 1.2.3.5로 바뀐다. IP 기반 방화벽 규칙(allow 1.2.3.4)은 자동으로 적용 해제되어, 매번 수동으로 수정해야 한다. 그러나 Label(app=frontend)은 바뀌지 않으므로, NetworkPolicy는 Pod 재시작 후에도 자동 적용된다.'
- **🔴 HIGH** · `스토리라인누락` · _섹션 2 (line 108~191)_
  - 문제: OR/AND 조건을 YAML 들여쓰기로 구분하는 '규칙'은 명확하지만, '왜 YAML이 이렇게 설계되었는가'(배열의 수학적 의미, 쿠버네티스 API 설계 철학)에 대한 스토리 부재. 암기 규칙만 있고 이해가 약함.
  - 보강: 'YAML 배열은 '또는(OR)'을 의미한다. from 필드의 각 항목(-)은 독립적인 조건이므로, 하나라도 만족하면 허용된다. 반면, 같은 항목 내 여러 필드는 '그리고(AND)'을 의미한다.'라고 설명. 비유: '배열은 선택지(택1), 필드는 조건(필수)'.
- **🔴 HIGH** · `스토리라인누락` · _섹션 6.1, line 452~462_
  - 문제: Ingress의 필요성(NodePort/LoadBalancer 한계)은 언급하지만, L3(Service) vs L7(Ingress)의 개념적 차이와 비용 이점이 약함. 마이크로서비스 시나리오(10개 서비스 = 10개 LoadBalancer IP vs 1개 Ingress)를 구체적으로 제시하지 않음
  - 보강: 표 추가: '| NodePort | 클러스터 모든 노드의 포트 개방, 클라이언트가 노드:포트 직접 접근, L4 | 학습/테스트용 | | LoadBalancer | 클라우드 벤더의 외부 로드밸런서 할당(IP 1개), 비용 발생 | 단일 서비스 프로덕션 | | Ingress | 1개 IP:포트에서 여러 서비스 분기(Host/Path 기준), 비용 낮음 | 마이크로서비스 프로덕션 |'. 시나리오: '100개 API 마이크로서비스마다 LoadBalancer를 할당하면 비용이 100배 증가. Ingress 1개로 모두 처리.'
- **🔴 HIGH** · `스토리라인누락` · _섹션 7.1, line 692~710_
  - 문제: CNI 역할(IP 할당·라우팅)은 나오지만, '왜 CNI가 필요한가'의 근본 이유가 약함. 'kubelet과 container runtime(containerd/docker)의 역할 분담'(프로세스 생성과 네트워킹의 책임)이 명시되지 않음. 학생이 'CNI = 어떤 도구들의 모음'이라는 기술적 이해는 하지만, '커널 관점에서 Pod의 네트워크 인터페이스는 누가 만드는가'를 모를 수 있음
  - 보강: 'Container runtime(Docker/containerd)은 프로세스(namespace 격리)만 생성한다. 하지만 네트워크 인터페이스(IP·라우팅 테이블)는 OS 커널 수준이므로 추가 도구가 필요하다. 그것이 CNI 플러그인이다. kubelet은 Pod 생성 후 CNI 바이너리(/opt/cni/bin/)를 호출해 네트워크를 초기화한다.' + 도형: [Pod 생성 요청] → kubelet → [1. container runtime: 프로세스+namespace] + [2. CNI: 네트워크 인터페이스+IP] → [Pod Ready]
- **🟡 MED** · `맥락점프` · _섹션 1 도입(line 1~3), line 1_
  - 문제: 'Services & Networking Part 2'라 하는데, Part 1(day12?)이 무엇인지, 이 day가 무엇을 전제하는지 명시되지 않음. 학생이 Service 개념이 없으면 `postgres.demo.svc.cluster.local` 같은 FQDN을 못 읽음
  - 보강: '이전: Day 12에서 Service(ClusterIP·NodePort·LoadBalancer) 개념을 배웠다고 가정. NetworkPolicy는 Service가 이미 동작하는 상태에서 L3/L4 쪽근 제어를 추가하는 기술이다. Service = 로드밸런싱, NetworkPolicy = 화이트리스트 필터링으로 구분하세요.' 라고 도입부에 추가.
- **🟡 MED** · `실습재현불가` · _섹션 9 실습(line 1025~1044)_
  - 문제: 실습 1~3의 출력이 모두 이미지 파일(images/day13-0*.png)로 표기되어 있는데, 실제 파일이 제공되지 않음. CLAUDE.md §4①에 따르면 '실제 터미널 스크린샷' 필수이나 '(미캡처)' 표기도 없음. 학생이 예상 출력을 볼 수 없어 검증 불가능
  - 보강: 모든 이미지 참조 검증: 파일이 있으면 그대로 두고, 없으면 '(미캡처 — 실제 클러스터에서 dev.yaml로 실행 시 결과는 다양)'으로 표기. 또는 '예상 출력(
실제 클러스터에서 캡처 필요):
```bash
kubectl apply -f deny-all-ingress.yaml
kubectl describe networkpolicy deny-all-ingress -n demo
```'로 명령만 제시.
- **🟡 MED** · `실습재현불가` · _섹션 9 실습 2(line 1029~1035)_
  - 문제: demo 네임스페이스가 이미 생성되어 있다고 가정하지만, 언제 어떻게 생성하는지 명시되지 않음. 학생이 처음 실행하려면 'kubectl create ns demo'를 먼저 해야 하는데 가이드 부재
  - 보강: 실습 2 시작 전에 '전제 조건' 섹션 추가: '```bash
kubectl create namespace demo
kubectl label namespace demo kubernetes.io/metadata.name=demo  # 나중의 namespaceSelector를 위해
```'
- **🟡 MED** · `용어비약` · _섹션 7.2 표, line 706_
  - 문제: 표의 '사용처' 칼럼에 'tart-infra'라는 용어가 나오는데, 정의되지 않음. 이 저장소의 별칭? 특정 회사? 기술 이름? 학생이 맥락상 추측할 수 없음.
  - 보강: 'tart-infra' → '이 저장소의 실습 클러스터 환경(tart)' 또는 '생산 환경(Cilium 기반)'으로 명시. 또는 섹션 9 전에 '다음 실습에서 tart는 이 저장소의 4개 멀티클러스터(platform/dev/staging/prod)를 의미한다'고 주석 추가.
- **🟡 MED** · `정확성오류` · _섹션 9 실습 3, line 1045~1057_
  - 문제: 'Istio mTLS와 네트워크 보안 계층 확인' 제목이지만, 출력 캡션에 '이 클러스터는 Cilium 기반(Istio 미설치)'라고 명시. 그럼 이 실습을 왜 제시? 재현 불가능한 실습은 학습 방해
  - 보강: 섹션 9.3으로 이동하거나 아예 제거. 또는 '참고(이 클러스터에는 미설치): Istio가 설치된 프로덕션 환경에서의 패턴'으로 명확히 마크업하고, CKS 또는 고급 주제로 분류.
- **🟡 MED** · `이해난이도` · _섹션 4.1 그림 3, line 282~290_
  - 문제: DNS 쿼리 흐름 다이어그램은 있지만, 텍스트 설명이 '서비스 이름을 IP로 변환 불가'로 끝남. Pod이 실제로 어떻게 DNS를 사용하는지(resolve.conf의 nameserver, 53 포트)의 메커니즘을 모르는 학생은 이해 못 함
  - 보강: 다이어그램 아래 텍스트 보강: 'Pod는 /etc/resolv.conf에 nameserver 10.96.0.10(CoreDNS Service IP)을 자동으로 설정받는다. postgres.demo.svc.cluster.local을 직접하려면 먼저 이 nameserver로 UDP 53 포트로 DNS 쿼리를 보낸다(Egress). CoreDNS가 응답하면 반환된 Pod IP로 실제 서비스를 연결한다.'
- **⚪ LOW** · `정확성오류` · _섹션 9 도입, line 995_
  - 문제: kubeconfig 경로가 ~/sideproejct/IaC_apple_sillicon/kubeconfig/dev.yaml로 절대경로에 가까운데, 학생이 이 저장소를 clone하면 경로가 달라질 수 있음. 상대경로 또는 변수 사용 권장 안 함
  - 보강: 'export KUBECONFIG=./kubeconfig/dev.yaml' 또는 '$REPO_ROOT/kubeconfig/dev.yaml'로 수정. 또는 '주의: 아래 경로는 저장소 root 기준이므로 필요에 따라 수정하세요'라고 명시.

### daily/day14.md  · 가독성 2/5 · 스토리라인 2/5 · 단독합격 ❌

**잘된 점:** YAML 예제 문법 검증 — 전 15개 코드블록이 실제 kubectl apply 가능 수준의 정확성 유지 / 12개 연습 문제의 구조 일관성 — (컨텍스트 → 풀이 YAML·명령 → 핵심 포인트 → 검증 체크리스트) 패턴을 모두 동일 적용 / 시험 출제 패턴 명시화 — CKA NetworkPolicy 출제 7가지 유형·OR vs AND·Egress DNS 같은 빈출 함정을 별도 섹션에 정리

- **🔴 HIGH** · `용어비약` · _예제 10~15 (줄 7~186)_
  - 문제: ingressClassName·pathType: Prefix/Exact·defaultBackend·endPort 같은 필드가 정의 없이 YAML에만 나타남. 학생이 문법은 따라 쓸 수 있지만 각 필드의 의미·사용 이유·Prefix vs Exact의 동작 차이를 이해 못함.
  - 보강: 각 예제 앞에 필드별 1~2문장 설명 추가. 예: 'ingressClassName: nginx — Ingress 컨트롤러를 명시한다. 여러 컨트롤러가 설치돼 있을 때 이 필드로 어느 컨트롤러가 규칙을 처리할지 결정한다.' / 'pathType: Prefix는 /api로 시작하는 모든 경로(/api, /api/v1, /api/health)를 매칭한다. Exact는 정확히 /healthz만 매칭한다(test1=/healthz는 매칭 안 됨).'
- **🔴 HIGH** · `스토리라인누락` · _파일 전체 (섹션 1~10)_
  - 문제: Ingress 등장 배경(NodePort의 한계·L4→L7 라우팅)·NetworkPolicy 배경(default allow의 보안 문제·Zero Trust)·Day 13과의 연결(Service ↔ Ingress 계층)·CNI와 NetworkPolicy의 관계가 모두 설명 없음. 각 기술이 도구 나열식으로 보임. 학생이 '왜 배워야 하는가'를 모름.
  - 보강: 파일 도입부를 새로 작성(3~4문단): ① 'Day 13에서 Service(ClusterIP/NodePort/LoadBalancer)로 Pod 간 통신을 만들었다면, Day 14는 그 Service로의 진입점(Ingress)을 관리하고, 어떤 트래픽을 허용할지(NetworkPolicy)를 제어하는 L3~L7 네트워크 제어 계층이다.' ② 'Ingress 등장 배경: NodePort는 높은 포트(30000+)를 개방해야 하고 도메인·경로 기반 라우팅이 불가능하다(L4만 지원). HTTP/HTTPS 기반으로 호스트·경로별 다른 서비스로 라우팅하려면? → Ingress(L7 프록시).' ③ 'NetworkPolicy 등장 배경: K8s 기본은 default allow — 같은 클러스터 내 모든 Pod이 모든 Pod에 접근 가능. 멀티테넌트·보안 요구 환경에서는 명시적 허용 목록이 필요. → Zero Trust 네트워크 정책.' ④ 각 섹션 맨 위에 한 줄: 이제 배우는 주제가 Ingress인지 NetworkPolicy인지, Day 13을 전제하는지 명시.
- **🔴 HIGH** · `이해난이도` · _섹션 9 '출제 패턴 분석' (줄 190~214)·문제 3~4 OR vs AND 조건_
  - 문제: NetworkPolicy에서 OR 조건(from 배열에 - 여러 개)과 AND 조건(하나의 from 항목 내 namespaceSelector + podSelector)을 구분하는 것이 CKA 합격의 핵심인데, 이 규칙이 섹션 9의 '3. OR vs AND 조건 구분'에는 개념만 있고 YAML 예시가 없음. 학생이 문제 3의 풀이를 읽기 전까지 이 규칙을 모름.
  - 보강: 섹션 9의 '3. OR vs AND 조건 구분' 항목을 시각화 확장: ```yaml\n# OR 조건 (배열에 여러 항목, - 가 2개 이상):\nfrom:\n- podSelector: {app: web}      ← 규칙 1: web Pod에서\n- podSelector: {app: gateway}  ← 규칙 2: gateway Pod에서 (둘 중 하나)\n```\nvs\n```yaml\n# AND 조건 (하나의 배열 항목 내, - 가 1개):  \nfrom:\n- namespaceSelector: {ns: monitoring}   ← 조건 A\n  podSelector: {app: prometheus}        ← 조건 B (둘 다)\n``` / 예: 'OR은 web Pod 또는 gateway Pod 중 하나라도 만족하면 허용. AND는 monitoring NS의 prometheus Pod만 허용(다른 monitoring Pod는 차단).'
- **🟡 MED** · `맥락점프` · _문제 10 'CNI 플러그인 확인' (줄 745~782)_
  - 문제: 이 파일 전반이 Ingress·NetworkPolicy(L3~L7)인데, 문제 10에 갑자기 '/etc/cni/net.d/' 같은 저수준 인프라가 등장. CNI와 NetworkPolicy의 관계(CNI 플러그인 없으면 NetworkPolicy 정책이 커널에서 작동 안 함)가 설명 없음.
  - 보강: 문제 10 도입부에 1문장 추가: 'NetworkPolicy는 CNI(Container Network Interface) 플러그인이 지원해야만 커널에서 실제 패킷 필터링을 처리한다. Cilium·Calico·Flannel 등은 모두 지원하지만, K8s 기본 kube-proxy는 지원하지 않는다. 이 문제는 현재 클러스터의 CNI가 무엇인지 확인하는 실습이다.'
- **⚪ LOW** · `정확성오류` · _예제 12 'TLS Ingress' (줄 77~104)_
  - 문제: backend.service.port.number: 443으로 설정되어 있는데, Ingress → Service 트래픽은 Service의 실제 listen 포트(8443, 443, 3443 등 다양)로 가야 함. 주석 없이 443으로만 설정하면 Service 포트인지 노드 포트인지 불명확.
  - 보강: 예제 12 YAML의 backend 섹션에 주석 추가: '# Service 자체가 노드의 443(또는 TLS를 처리하는 포트)에 listen 중이어야 한다. 예: Service spec.ports[0].port=443, targetPort=8443'
- **⚪ LOW** · `구조` · _파일 전체 순서 (줄 1~1062)_
  - 문제: 파일이 '예제 10~15(개념 없이) → 섹션 9: 출제 패턴 → 섹션 10: 연습 문제'로 진행되는데, 일반적 교과서 구조(개념 먼저 → 예제 → 문제)와 맞지 않음. 학생이 예제 10을 읽으면서 'Ingress란?' 같은 기본 정의를 모를 수 있음.
  - 보강: 파일 도입부에 새 섹션 추가: § Ingress란?(정의·역사·필요성) → § NetworkPolicy란?(정의·Zero Trust) → 이 후 '예제 10~15(Ingress) → 예제 더하기(NetworkPolicy) → 섹션 9(출제 패턴) → 섹션 10(연습 문제)' 순서로 재구성. 또는 최소한 파일 맨 위에 '## 이 Day의 두 주제\n- **Ingress**: 외부 트래픽을 내부 Service로 라우팅하는 L7 프록시\n- **NetworkPolicy**: Pod 간 트래픽을 명시적으로 허용/차단하는 방화벽 정책'을 추가.

### daily/day15.md  · 가독성 4/5 · 스토리라인 4/5 · 단독합격 ❌

**잘된 점:** PV/PVC/StorageClass의 관계와 라이프사이클을 명확한 다이어그램과 상세한 YAML 설명으로 제시한 점(§2.1~2.4) / 바인딩 조건 4가지를 정확하게 열거하고, 진단 명령어(kubectl get pvc, describe)와 실패 원인을 체계적으로 정리한 점(§3.4) / emptyDir, hostPath, configMap, secret, projected 등 5개 볼륨 타입을 각각 등장배경·예제·주의사항 3단계로 균형있게 설명한 점(§5.2~5.6)

- **🔴 HIGH** · `실습재현불가` · _§3.4 트러블슈팅 이미지(day15-01~02-pvc-pending.png, day15-03-storageclass.png)_
  - 문제: 명령 실행 후 "예상 출력(예시)" 이미지가 모두 missing(images/day15-*.png 경로 제시만 되고 실제 파일 없음). 학생이 자신의 환경에서 실행했을 때 "이렇게 나와야 한다"는 참고 화면이 없어 출력을 해석할 수 없음. §4①(터미널 스크린샷 필수)와 CLAUDE.md 규약 위배.
  - 보강: dev 클러스터에서 실제로 ⓐ PVC를 Pending 상태로 만들고 describe를 캡처(day15-01) ⓑ 다시 성공적으로 Bound시킨 후 캡처(day15-02) ⓒ StorageClass 목록을 보여주는 kubectl get storageclass 캡처(day15-03) ⓓ static-pv 바인딩 완료 후 get pv/pvc 캡처(day15-05) 등을 추가. 특히 §4.3(기본 StorageClass 설정 명령) 실행 후 before/after 스크린샷 추가.
- **🔴 HIGH** · `실습재현불가` · _§tart-infra 실습 전체(§실습 1~3, line ~1055~1124)_
  - 문제: "예상 출력(예시 — fresh dev 클러스터에는 demo ns의 PostgreSQL Pod가 없어 재현 불가. 아래는... 형태)" 라는 단서로 미캡처 상태인 이미지들이 4개(day15-04~07). 그런데 "fresh dev 클러스터에는 없다"는 명시는 학생에게 "이 실습은 할 수 없다"는 의미가 돼서 학습 의욕 저하. 또한 실습 환경 설정(§1057~1063)에서 kubeconfig 경로(`~/sideproejct/...`)를 고정하는데, 학생은 저장소를 clone하거나 설정할 때 이 경로가 다를 수 있음(절대경로가 학생 환경과 맞지 않을 수 있음).
  - 보강: ⓐ tart-infra 없이도 실행 가능한 static provisioning(예제 1) 기반으로 실습 1~3을 재설계. PVC Pending→Bound 상태 변화, StorageClass 조회, subPath 마운트 등은 local-path provisioner 없이도 hostPath PV로 가능. ⓑ 또는 dev 클러스터가 실제로 local-path provisioner를 가지고 있다면 실제로 PostgreSQL StatefulSet을 배포하고 PVC 상태를 스크린샷한 후 최종 정리(kubectl delete -n demo...). ⓒ 경로는 "export KUBECONFIG=..." 예시로 일반화하거나 상대경로 사용(스크립트 기반).
- **🟡 MED** · `용어비약` · _§1.2 스토리지 리소스 관계, line ~31~34_
  - 문제: StorageClass의 "프로비저너(CSI driver)"가 갑자기 나옴. CSI가 무엇인지, 기존 in-tree provisioner와 무엇이 다른지 설명이 없음. 학생은 "CSI driver"를 보고 혼란할 수 있음(특히 처음 보는 용어).
  - 보강: §4.1에서 StorageClass 설명할 때 각주로: "CSI(Container Storage Interface)는 외부 스토리지 플러그인을 표준화한 인터페이스. provisioner 필드에 'kubernetes.io/aws-ebs'(in-tree)나 'rancher.io/local-path'(CSI driver) 등을 쓴다. tart-infra에는 local-path CSI 드라이버가 설치되어 있다."
- **🟡 MED** · `맥락점프` · _§2.3 Reclaim Policy 설명, line ~107~128 vs §2.1 PV YAML의 persistentVolumeReclaimPolicy_
  - 문제: §2.1에서 PV YAML의 reclaimPolicy를 "PVC 삭제 시 PV 처리 방법"이라고 한 줄로만 설명하고, §2.3에서 "PVC가 삭제되면 PV는 어떻게 되는가?"를 상세히 설명. 하지만 두 섹션 사이에 직접 연결이 없어서 학생은 "아, PV YAML의 이것이 §2.3의 그 정책이구나"를 스스로 깨달아야 함. 맥락이 끊김.
  - 보강: §2.1에서 persistentVolumeReclaimPolicy 라인 설명을 "§2.3 참조"로 연결하거나, §2.3 제목을 "2.3 Reclaim Policy (§2.1의 persistentVolumeReclaimPolicy 상세)"로 명시.
- **🟡 MED** · `이해난이도` · _§3.2 PV-PVC 바인딩 내부 동작 원리, line ~195~197_
  - 문제: 한 문단으로 "PV Controller가 Available 상태의 모든 PV를 순회하며 바인딩 조건을 확인한다"는 설명이 추상적. 학생은 "그럼 만약 10개 PV가 있는데 모두 조건을 만족하면 어느 것을 선택하는가?"라는 의문을 가질 수 있음. 또한 "Dynamic Provisioning의 경우 provisioner가 실제 스토리지를 생성하고 PV 객체를 자동으로 만든다"는 표현이 너무 간결해서, 학생은 "그럼 PV 생성은 누가 하는가? PVC 생성 시인가 Pod 생성 시인가?"를 헷갈릴 수 있음.
  - 보강: 바인딩 선택 기준(정렬 순서, 최적화 전략)을 명시하거나 "순서는 정의되지 않으며 사용 가능한 첫 PV가 선택됨"으로 단순화. Dynamic Provisioning 흐름을 시간순 다이어그램으로 추가: PVC 생성(Controller Watch) → Immediate면 즉시 provisioner 호출 → PV 자동 생성 → PVC와 바인딩. WaitForFirstConsumer는 Pod 스케줄링까지 지연.
- **🟡 MED** · `정확성오류` · _§5.1 볼륨 타입 비교표, PVC 행_
  - 문제: 표에 "PVC | PV 수명 | 영구 데이터 저장 | 예(O)" 라고 했는데, 이것은 혼란을 일으킬 수 있음. PVC 자체가 "지속 기간"을 가지는 게 아니라, PVC가 바인딩한 PV의 reclaim policy에 따라 데이터 지속 여부가 결정됨. Retain이면 영속, Delete면 삭제. 이 표에서 "PVC 수명"이라는 행 제목으로는 이 구분이 명확하지 않음.
  - 보강: 표 행 이름을 "PVC(PersistentVolumeClaim)"로 유지하되 설명을 "PV를 통한 영구 데이터 저장(Retain 정책 가정)"으로 수정. 또는 주석: "※ PVC의 data 지속 여부는 PV의 Reclaim Policy에 따라 달라짐 (Retain=보존, Delete=함께 삭제)."
- **🟡 MED** · `스토리라인누락` · _§4.2 volumeBindingMode 등장 배경, line ~282~283_
  - 문제: 등장 배경이 "Immediate 모드에서는 PVC 생성 즉시 PV가 프로비저닝된다. 로컬 스토리지의 경우 특정 노드에 PV가 생성되면 Pod가 반드시 그 노드에 스케줄링되어야 한다"는 설명인데, 여기서 "왜" 그 노드에만 스케줄링되어야 하는지가 명확하지 않음. 학생은 "로컬 스토리지라고 해서 왜 그 노드로만 갈까?"라고 궁금해할 수 있음.
  - 보강: 추가 설명: "hostPath나 local-path provisioner로 생성된 PV는 특정 노드의 로컬 디스크에만 접근 가능하다(NFS와 달리 네트워크 공유가 아님). 따라서 Pod는 그 PV가 있는 노드에만 스케줄링될 수 있다. Immediate 모드에서 PVC 생성 즉시 PV를 nodeA에 만들면, Pod는 원하는 노드(예: nodeB)에 가고 싶어도 스케줄러가 nodeA로 강제 변경해야 하는 문제가 생긴다. 이 충돌을 피하기 위해 WaitForFirstConsumer는 Pod의 노드 선택을 먼저 한 후 그 노드에 PV를 생성한다."
- **⚪ LOW** · `이해난이도` · _§5.2 emptyDir 예제, line ~352~372_
  - 문제: 예제에 "while true; do date >> /shared/log.txt; sleep 5; done" 명령이 있는데, 이것이 한 줄 완전한 shell 명령인지 불명확. 학생이 YAML에 그대로 복붙할 때 "따옴표 이스케이프"가 필요한지 않은지 모를 수 있음. 실제로 kubectl apply 했는지 검증 없음.
  - 보강: YAML 예제 아래에 "이 예제는 실제 dev 클러스터에서 kubectl apply 검증됨"이라고 명시하거나, 명령형 생성 코드도 병기: "kubectl run emptydir-pod --image=busybox:1.36 -o yaml --dry-run=client | sed 's/command.*/command: [\"sh\", \"-c\", \"...\"]/g' | kubectl apply -f -". 또는 실제 적용 후 pod logs, exec 스크린샷 추가(실습 검증).
- **⚪ LOW** · `용어비약` · _§6.2 subPath 사용, line ~594~600_
  - 문제: subPath 설명이 "볼륨의 하위 디렉터리만 마운트"인데, "하위 디렉터리"라는 표현이 정확하지 않을 수 있음. 실제로는 "PVC의 루트에서 지정된 경로 아래를 마운트"하는 것인데, subPath가 디렉터리인지 파일인지 불명확. 이어서 예제에서 subPath가 "app1-data"(디렉터리 같음)와 "app.properties"(파일 같음) 둘 다 사용되는데 설명이 없음.
  - 보강: subPath 설명을 "PVC 내부의 특정 경로(파일 또는 디렉터리)만 마운트한다"로 수정. 예제에 주석: "# subPath가 디렉터리(app1-data)면 그 디렉터리 전체를 마운트\n# subPath가 파일(app.properties)이면 그 파일만 마운트"
- **⚪ LOW** · `스토리라인누락` · _§5.4 configMap 볼륨 특징, line ~462~468_
  - 문제: configMap 업데이트 시 마운트된 파일도 자동 업데이트되지만 subPath 사용 시 자동 업데이트가 동작하지 않는다는 설명이 나옴. 하지만 "왜" 그런지 메커니즘이 없음. 학생은 "그냥 그런가?"하고 넘어갈 수 있음.
  - 보강: 추가 설명: "subPath 없이 마운트된 경우, Kubelet은 ConfigMap 전체 변경을 감지해 마운트 포인트의 모든 파일을 갱신한다. 그런데 subPath를 쓰면 특정 파일만 마운트되므로 Kubelet의 감시 메커니즘이 그 파일만 추적해야 하는데, 현재(v1.31)에서는 이 기능이 구현되지 않았다. 따라서 subPath + ConfigMap은 정적 설정에만 적합하다." (또는 "실제 메커니즘은 kubernetes/kubernetes#50513 참조"로 링크)
- **⚪ LOW** · `맥락점프` · _§2.1 PV YAML의 storageClassName 설명 vs §4.1 StorageClass YAML의 관계_
  - 문제: §2.1에서 PV의 storageClassName은 "StorageClass 이름 (PVC와 매칭 기준)"이라고 했고, §4.1에서 StorageClass 자체를 정의하는 YAML을 보여줌. 하지만 정적 프로비저닝(PV 먼저 만들기)과 동적 프로비저닝(PVC 먼저 만들기)의 흐름 차이가 명확하지 않음. 학생은 "그럼 PV를 먼저 만들어야 하나, PVC를 먼저 만들어야 하나?"를 혼란스러워할 수 있음.
  - 보강: §1.2에 추가 설명 또는 다이어그램: "Static Provisioning: 관리자가 먼저 PV를 만들고(storageClassName 지정) → 사용자가 PVC를 만들고(같은 storageClassName 지정) → Controller가 바인딩. Dynamic Provisioning: 사용자가 PVC를 만들고(storageClassName 지정) → 해당 StorageClass의 provisioner가 자동으로 PV를 생성 → 자동 바인딩."

### daily/day16.md  · 가독성 3/5 · 스토리라인 2/5 · 단독합격 ❌

**잘된 점:** 실습 중심의 명확한 구조: 12개 문제별로 컨텍스트 명시 + 풀이 펼침 + kubectl 검증 명령 제시 / 시험 체크리스트 완비 (§982~1011): 개녁·명령어·팅이 항목화되어 학생 자가점검 용이 / tart-infra 실습 환경 연계 (§1020~1113): 실제 dev/platform 클러스터의 PostgreSQL·Istio 예제로 현실감

- **🔴 HIGH** · `용어비약` · _§7, 예제 12 (downwardAPI 첫 등장)_
  - 문제: downwardAPI가 무엇인지 풀이 없이 YAML 예제로만 제시. 학생이 "Pod의 메타데이터를 파일로 노출하는 메커니즘"을 처음 이해할 수 없음.
  - 보강: 예제 12 직전에 "downwardAPI 볼륨은 Pod의 메타데이터(라벨·네임스페이스·이름)와 리소스 요청/제한을 컨텍스너 파일시스템에 동적으로 노출하는 방식이다. 환경변수와 달리 kubelet이 주기적으로 업데이트한다." 한 문단 추가
- **🔴 HIGH** · `스토리라인누락` · _§1~7 (전체 머리말 및 예제 12~18)_
  - 문제: "Day 16은 왜 이런 Storage YAML을 배우는가?"의 스토리가 없음. PV/PVC의 정적 바인딩과 동적 프로비저닝, Retain 정책 같은 개녁의 등장 배경(직전 기술의 한계, 무엇이 개선되었는지)이 완전히 빠져 있음. 학생이 "이게 왜 필요한가?"에 답할 수 없음.
  - 보강: Day 16 도입 후 "복습: PV-PVC 바인딩 조건 4가지" 절 추가 - accessModes(RWO/ROX/RWX 일치), capacity(PV >= PVC), storageClassName(일치), selector(라벨 매칭). 각각 1줄 설명 + 이번 day에서 어떻게 쓰이는지 미리 암시
- **🔴 HIGH** · `스토리라인누락` · _§122~135 (StorageClass 정의)_
  - 문제: volumeBindingMode: WaitForFirstConsumer가 무엇이고 왜 쓰는가? 문제 2의 "내부 동작 원리"(§333)에서 설명하지만, 처음 보는 학생이 이해하기 어려움. 그 전에 Static vs Dynamic의 차이도 없음.
  - 보강: §122 직전에 "StorageClass와 Dynamic Provisioning: Static PV(관리자가 미리 생성)의 한계 → Dynamic Provisioning(PVC 요청 시 StorageClass가 자동 PV 생성)의 장점·volumeBindingMode의 역할"을 그림과 함께 설명
- **🔴 HIGH** · `맥락점프` · _Day 16 머리말(§1~3)_
  - 문제: Day 15(PV/PVC 기초)를 가정하지만, Day 15가 어떤 내용의지, 바인딩 조건 4가지가 무엇인지 다시 한 줄도 언급 없음. 독자는 Day 15 가이드를 찾으러 가야 함.
  - 보강: Day 16 도입 후 "복습: PV-PVC 바인딩 조건 4가지" 절 추가 - accessModes(RWO/ROX/RWX 일치), capacity(PV >= PVC), storageClassName(일치), selector(라벨 매칭). 각각 1줄 설명 + 이번 day에서 어떻게 쓰이는지 미리 암시
- **🔴 HIGH** · `실습재현불가` · _문제 1~12의 전제(§200~976)_
  - 문제: kubeconfig 파일이 `kubeconfig/<클러스터>.yaml`에 있다고 가정하지만, day16.md 문서에서 설정 방법을 제시하지 않음. CLAUDE.md §3을 학생이 읽었는지 불명. 또한 `kubectl config use-context <ctx>` 후 컨텍스트가 유지된다고 가정하는데, 학생이 터미널을 재시작했다면 컨텍스트가 초기화될 수 있음.
  - 보강: (1) 머리말에 "실습 환경 설정" 섹션 추가: 'export KUBECONFIG=kubeconfig/dev.yaml:kubeconfig/staging.yaml:kubeconfig/platform.yaml && kubectl config get-contexts'; (2) 각 문제 전에 "이 문제는 staging 클러스터에서 실행하므로 kubectl config use-context staging 을 한 번 실행한 후 이후 모든 명령을 순서대로 복사-부착하기 할 수 있습니다" 메모 추가
- **🟡 MED** · `실습재현불가` · _문제 2~12의 `demo` 네임스페이스_
  - 문제: demo 네임스페이스가 이미 존재한다고 가정하거나, 각 문제 풀이에서 네임스페이스를 명시적으로 생성하지 않음. 예: 문제 5 §484의 `kubectl create secret`이 `-n demo` 없음 → 기본 namespace(또는 current context의 default ns)에 생성되어 이후 Pod가 찾지 못함.
  - 보강: (1) 실습 환경 설정 절에 'kubectl create namespace demo'를 추가; (2) 각 문제의 첫 번째 create 명령에 명시적으로 '-n demo' 또는 metadata.namespace를 확인하는 주석 추가. 특히 문제 5 §484 secret create에 '-n demo' 추가
- **🟡 MED** · `정확성오류` · _문제 6, §548~561 (PVC 정보 조회)_
  - 문제: status.capacity.storage는 PVC가 Bound 상태일 때만 값을 가짐. Pending 상태 PVC는 비어있음. 문제 6의 시나리오가 PVC 상태를 명시하지 않아, 학생이 "왜 CAPACITY가 비어있지?"라고 혼동할 수 있음.
  - 보강: §544에 "주의: PVC가 Bound 상태일 때만 status.capacity.storage에 값이 나타나므로, 이 명령은 이미 PV와 바인딩된 PVC 정보를 수집할 때 유용합니다." 추가. 또는 풀이 첫 부분에 'kubectl get pvc -n monitoring -o jsonpath=...' 로 먼저 상태를 확인하는 스텝 삽입
- **🟡 MED** · `정확성오류` · _문제 5, §484~515 (Secret 생성 및 마운트)_
  - 문제: 문제 2,3,4 후 문제 5에 진입하는 경우, dev 컨텍스트가 유지되어야 하지만, kubectl config use-context dev 를 문제 5에서 다시 하지 않음. 또한 Secret이 demo 네임스페이스에 생성되는지 명시 필요.
  - 보강: §471 "컨텍스트: kubectl config use-context dev" 명시 후, §484의 kubectl create secret에 '-n demo' 명시적 추가. 풀이 내 kubectl exec 명령 앞에 'kubectl config current-context' 확인 스텝 추가
- **🟡 MED** · `이해난이도` · _§165~169 (PV-PVC 관계 확인 custom-columns)_
  - 문제: `.metadata.name`, `.spec.capacity.storage`, `.spec.claimRef.name` 같은 jsonpath 선택자가 처음 보는 학생에게는 어렵고, 어디서 배웠는지 불명. 또한 이 명령이 "어떤 정보를 주는가"의 설명이 없음.
  - 보강: §165 직전에 "jsonpath 선택자로 custom-columns 구성하기" 짧은 설명 추가: 'metadata.name(리소스 이름) → spec.capacity.storage(PV 용량) → status.phase(상태)' 같은 선택자가 무엇을 의미하는지 한 줄 정리. 또는 예제 18 전에 "kubectl 조회: custom-columns와 jsonpath 기초" 소제목 추가
- **⚪ LOW** · `정확성오류` · _§136~148 (Retain 정책 PV의 재사용)_
  - 문제: claimRef를 삭제하는 patch 명령이 "왜" 필요한가의 설명이 부족. Released 상태가 무엇이고, 언제 Available로 돌아가는가?
  - 보강: §136 직전에 "Retain 정책의 동작: PVC 삭제 후에도 PV는 유지되지만 상태가 Released → 다시 Available로 돌아오려면 claimRef(이전 PVC의 참조)를 제거해야 함"을 그림과 함께 설명
- **⚪ LOW** · `맥락점프` · _§1020~1113 (tart-infra 실습)_
  - 문제: dev 클러스터의 PostgreSQL, Redis 같은 앱이 "이전에 배포되어 있다"고 가정하지만, 이것이 언제 어디서 설정되어 있는지 불명. 학생이 fresh dev 클러스터로 시작했다면 이 예제들을 실행할 수 없음.
  - 보강: §1024의 "예상 출력 (예시 — fresh dev 클러스터에는 demo ns 의 PostgreSQL PVC 와 PV 가 없다..." 주석을 더 명확히: "아래의 실습 1~5는 dev 클러스터에 이미 애플리케이션이 배포된 환경을 가정합니다. PostgreSQL과 Redis는 별도 배포가 필요하며, 실습 순서는 [day NN: Deploy Storage Apps] 를 먼저 참고하세요." 추가
- **⚪ LOW** · `구조` · _§7~148 (예제 12~18의 배열 순서)_
  - 문제: downwardAPI → initContainer → hostPath → volumeName 지정 → StorageClass → Retain → kubectl 조회 순서는 "기술 복잡도"보다는 "문서 구성" 순. 학습 흐름으로는 PV/PVC 바인딩 메커니즘(정적/동적) → Reclaim 정책 → 부가 기능(downwardAPI/subPath/initContainer)이 더 직관적.
  - 보강: 예제 12~18을 다시 정렬: (1) PV-PVC 정적 바인딩 → (2) StorageClass(동적) → (3) Retain vs Delete 정책 → (4) downwardAPI (부가) → (5) initContainer (활용) → (6) subPath (고급) → (7) kubectl 조회 명령. 또는 현재 순서를 유지하되, 각 예제 전에 "이 예제는 어떤 상황에서 쓰는가"를 한 줄씩 추가
- **⚪ LOW** · `정확성오류` · _§254, 331, 456, 519 등 (검증 기대 출력 이미지 참조)_
  - 문제: "![설명](images/day16-01-static.png)" 같은 이미지 파일이 실제 저장소에 없거나, 스크린샷이 캡처되지 않았을 가능성 높음. CLAUDE.md §4①의 "모든 명령 출력은 실제 터미널 이미지"라는 규칙 위반.
  - 보강: 각 검증 기대 출력 이미지를 실제로 생성: (1) tart dev/staging/platform 클러스터에서 풀이 명령을 정확히 실행 → (2) 실제 터미널 화면을 PNG 캡처 → (3) k8scert/CKA/images/ 에 day16-01.png 등으로 저장 → (4) 이미지 없는 경우 "(미캡처)" 명시. 예: images/day16-01-static.png, day16-02-dynamic.png, day16-03-configmap.png 등 4개 이미지 필요

### daily/day17.md  · 가독성 2/5 · 스토리라인 2/5 · 단독합격 ❌

**잘된 점:** 체계적 5단계 트러블슈팅 프레임워크 / 명령어 완전 정리 / 15개 실전 장애 시나리오

- **🔴 HIGH** · `용어비약` · _§5.2 (line ~375), §4.2 (line ~277)_
  - 문제: Static Pod, NodeLease, kubeadm 등 핵심 용어가 정의 없이 곧바로 사용됨. 학부생이 'Static Pod가 뭐지?'라고 막힘
  - 보강: 각 용어 첫 등장 시 1~2줄 정의 추가. 예: 'Static Pod: kubelet이 /etc/kubernetes/manifests/ 디렉터리를 감시해 직저 실행하는 Pod. API Server를 거치지 않으므로 Control Plane 컴포넌트(apiserver, scheduler, controller-manager, etcd)의 기동에 사용.'
- **🔴 HIGH** · `스토리라인누락` · _§3(Pod 상태별 진단), §4(Node 문제), §5(Control Plane)_
  - 문제: 각 섹션이 '증상→진단→해결'만 다루고, '왜 그런 장애가 발생하는가'의 원인 구조를 설명하지 않음. OOMKilled가 왜 생나, kubelet의 역할, Static Pod 재시작 자동화 메커니즘 미설명
  - 보강: 각 저노 시작에 '등장 배경' 단락 추가. 예: 'Pod가 Pending인 원인은 다양하다: 리소스 부족, Taint 불일치, PVC 미바인딩...'
- **🔴 HIGH** · `이해난이도` · _§5.2~5.3 (line ~375~430)_
  - 문제: §5.2에서 'vi로 yaml 수정 → kubelet이 자동 재시작'으로 급난이도 상승. 파일 수정만으로 Pod가 재시작되는 메커니즘(kubelet watch 루프, 2초 주기), API Server 역할 미설명
  - 보강: Static Pod 내부 동작: 'kubelet이 주기적(2초)으로 /etc/kubernetes/manifests/ 감시 → 파일 변경 감지 → Pod 재생성 → 30초 익 자동 재시작.' API Server 역할: '동간 딩, API Server 다운 드리면 kubectl 응답 릻.'
- **🔴 HIGH** · `실습재현불가` · _§8 실습 1,2,3_
  - 문제: 실습들이 'demo 네임스페이스와 nginx/postgresql Pod'를 가정하는데, fresh 클러스터에는 없음. 학생이 뭘 및나 만들어야 할지 불명
  - 보강: 각 실습마다 '셋업' 섹션 추가. 예: 'kubectl create namespace demo && kubectl -n demo run broken-image --image=nginx:nonexistent && kubectl -n demo run healthy-nginx --image=nginx' 등 선행 명령
- **🟡 MED** · `정확성오류` · _§4.3 (line ~329)_
  - 문제: 'kubeadm certs renew all + systemctl restart kubelet' 명령 제시만, kubelet이 어떻게 새 인증서 적용하는지 메커니즘 미설명
  - 보강: 단계 흐름: 'kubeadm certs renew all → /etc/kubernetes/pki/ 파일 갱신 → kubelet restart → Static Pod 재조정 → apiserver 등이 새 인증서로 재시작 → kubectl get nodes로 복구 확인'
- **🟡 MED** · `구조` · _문서 첫머리_
  - 문제: day17의 지위에서 어떤 선수 지식이 필요한지 불명. 독립서나 순단 모도 부명
  - 보강: 첫 섹션에 선수 지식 추가: 'Pod 생명주기(day 03~04), kubelet·Node·Control Plane(day 02), kubectl 기본(day 01), 네임스페이스·선택자(day 05)를 않아야 한다.'
- **🟡 MED** · `이해난이도` · _§4.1 Node Conditions 표_
  - 문제: Condition 동시 활성 가능실 불명. Ready=False와 MemoryPressure=True의 만날 관계 미설명
  - 보강: 표 설명: '여러 Condition이 동시 활성 가능. 예: Ready=False + MemoryPressure=True = kubelet이 메모리 부족으로 크래시.'

### daily/day18.md  · 가독성 2/5 · 스토리라인 1/5 · 단독합격 ❌

**잘된 점:** 12개 실습문제가 CKA 시험 출제 패턴을 체계적으로 배치 / Quick Reference 카드와 자가점검 체크리스트가 실용적이다 / kubectl 명령어 옵션이 상세하고 문체가 일관성 있다

- **🔴 HIGH** · `용어비약` · _§9 출제 패턴 분석_
  - 문제: CrashLoopBackOff, ImagePullBackOff, kubelet, kube-scheduler, nodeSelector 등 핵심 용어가 정의 없이 단어만 나열되면 단닝륙 진단집 수 없다
  - 보강: §0 '이 Day를 위한 기초 개녁 복습' 세션 추가: kube-scheduler, nodeSelector, kubelet, CrashLoopBackOff, Static Pod 각 1~2문장 정의
- **🔴 HIGH** · `스토리라인누락` · _§9 처음_
  - 문제: 왜 Troubleshooting이 CKA 30%인지, 잘남된 기종 기술의 한계가 무엇인지 등장배경·개선솀검 없다
  - 보강: 서녠에 '등장배경' 센션(400단어) 추가: 분산 시스템 개녁, 기존 K8s 1.0 한계, 온 방기 쉡능(단계별 스타퉬 실지), 트레이드오프
- **🔴 HIGH** · `실습재현불가` · _각 문제 사례 부분_
  - 문제: 장애 생성 코드는 있으나 dev 클러스터에서 실제 실행했을 때 기대 현상(Pending, CrashLoopBackOff) 나온다는 보장이 없다
  - 보강: 각 문제 코드 앞에 '사전 체크' 블록 추가: kubectl get nodes ✔, kubeconfig 설정 ✔, 문제에 필요한 라벨/리소스 뚴그 식달 여부 점검
- **🔴 HIGH** · `용어비약` · _각 문제 반복_
  - 문제: 컨텍스트 또는 kubeconfig 적용 전제 개녁 없다
  - 보강: 찼차 문제 단락에 '실습 전 필수 준비' 기본 추가(최소 300단어): bootstrap 명령들, kubeconfig export, 노드 Ready 단계별 확인
- **🟡 MED** · `용어비약` · _문제 3, 6 Control Plane_
  - 문제: Static Pod, crictl 개녁전 대떇 없다
  - 보강: 각 래스스개 난이도 둸 문제 앞에 개녁 추가
- **🟡 MED** · `정확성오류` · _문제 3 SSH_
  - 문제: IP 따른 VM 별칭 찡른 구분 없다
  - 보강: 방법 1 또는 2 모두 추가
- **🟡 MED** · `용어비약` · _문제 2 로그_
  - 문제: --previous 내부동중 개녁 부족
  - 보강: /var/log/containers, containerd 저장 메커니즘 추가
- **🟡 MED** · `이해난이도` · _문제 12_
  - 문제: 3개 문제 동시 순서 전략 없다
  - 보강: 단계 찡른 순서 스토리 추가
- **⚪ LOW** · `구조` · _전체_
  - 문제: Day 17, 19 연결 부재
  - 보강: 최상단 연결 문단 추가

### daily/day19.md  · 가독성 3/5 · 스토리라인 2/5 · 단독합격 ❌

**잘된 점:** 시험 메타지식 충실: 120분 시간 제약, 배점별 우선순위, 부분 점수 조건 등을 명확히 제시해 실전 대비 가능 / 내부 동작 설명 깊이: SubjectAccessReview API, eviction 메커니즘, PVC 바인딩 조건 등 메커니즘 수준의 설명 포함 / 컨텍스트 명시: 각 문제마다 'kubectl config use-context' 정확히 지시해 클러스터 실수 방지

- **🔴 HIGH** · `용어비약` · _문제 1(etcd 백업), 약 99~127줄_
  - 문제: "etcd Pod의 설정에서 확인하라"고만 하고 초학자가 어떤 필드('-cert-file', '-key-file', '--cacert' 등)를 찾아야 하는지 구체적이지 않음. 'kubectl -n kube-system describe pod etcd-<name>' 출력에서 'command' 섹션이 무엇인지 못 찾는 학생 다수
  - 보강: 실제 describe 출력 스크린샷 예시를 보여주거나, YAML 구조 설명 추가: "etcd Pod의 spec.containers[0].command에서 '--cert-file=/etc/kubernetes/pki/etcd/server.crt' 같은 플래그를 찾으면 경로가 보인다" 또는 "kube-apiserver도 같은 위치에 인증서 설정이 있음(day X 참조)" 같은 연결고리
- **🔴 HIGH** · `스토리라인누락` · _문제 2(RBAC 설정), 약 154~172줄_
  - 문제: Role/RoleBinding이 왜 필요했는가? 직전(기본값 무제한 접근? Kubernetes 초기 보안 모델?)을 전혀 설명하지 않음. apiGroups: [""] vs ["apps"] 구분만 암기적으로 보임
  - 보강: 등장 배경 1~2문단 추가: "처음 Kubernetes는 RBAC 없이 모든 사용자가 모든 작업 가능했다(멀티테넌트 환경에서 위험) → Pod/Service(core API) vs Deployment(apps API) 같이 리소스가 버전별로 달라짐 → apiGroups로 분류 필요" 또는 "비유: Unix의 chmod와 유사 — 파일(Pod) 읽기/쓰기(verb) 권한을 사용자(user)에게 부여"
- **🔴 HIGH** · `실습재현불가` · _이미지 파일 참조: 143줄(day19-01-etcd-status.png), 226줄(day19-02-rbac.png) 등 5개_
  - 문제: 마크다운에 '![설명](images/day19-*.png)' 형태로만 있고, 실제 파일이 /Users/ywlee/sideproejct/IaC_apple_sillicon/k8scert/CKA/images/ 에 존재하는지 미확인. 또한 명령 결과를 이미지로만 제시했으므로 학생이 실제 출력을 텍스트로 복사하거나 diff 할 수 없음
  - 보강: CLAUDE.md §4① 규칙('실제 터미널 스크린샷 이미지')을 이미 적용 중이므로, 두 가지 선택: ⓐ images/ 폴더에 실제 PNG 파일이 있는지 확인 → 없으면 '(미캡처)' 표기 ⓑ 또는 이미지 아래에 예상 텍스트 출력도 코드블록으로 병기('Expected output: `Hash=..., Revision=..., Keys=...`' 형태) 하면 학생도 grep/diff로 검증 가능
- **🟡 MED** · `맥락점프` · _문제 1 풀이, 약 122~139줄의 SSH 접속 부분_
  - 문제: 갑자기 'ssh admin@<platform-master-ip>'가 나오는데, 이전 day에서 SSH 설정/접속을 어디서 배웠는지 불명확. CLAUDE.md에는 '~/.ssh/config에 별칭(예: ssh platform-master)'라 했는데, 이 코드는 IP 변수로 씀. 초학자는 어느 방법이 맞는지 혼동
  - 보강: day19 시작 부분에 '전제 조건' 섹션 추가: "노드 SSH 접속: 모든 노드에 공개키가 배포되어 있으므로 ⓐ 호스트명 별칭: ssh platform-master 또는 ⓑ IP 직접: ssh admin@10.20.30.40(실제 IP). 둘 다 가능. ~/.ssh/config 참조는 [day X]에서" 또는 문제 1 풀이 주석에 '주석: platform-master의 실제 IP는 $(kubectl -n kube-system get pod etcd-platform-master -owide | awk '{print $6}') 형태로도 구할 수 있음'
- **🟡 MED** · `이해난이도` · _문제 4 풀이, 약 314~322줄(strategy 섹션)_
  - 문제: maxSurge=2, maxUnavailable=1이 무엇인지 정의 없이 YAML만 제시. "surge가 뭔지", "why maxUnavailable이 필요한지" 초학자가 모름
  - 보강: YAML 바로 위에 용어 풀이 추가: "RollingUpdate 전략의 두 파라미터: ⓐ maxSurge(최대 초과 생성): 기존 replica(4) + maxSurge(2) = 최대 6개 Pod가 동시에 존재 가능(빠른 업데이트) ⓑ maxUnavailable(최소 가용): 4개 - 1개 = 최소 3개는 항상 Ready(다운타임 제로). 트레이드오프: surge 높을수록 빠르지만 리소스 더 필요"
- **🟡 MED** · `용어비약` · _문제 2 풀이, 약 201줄의 주석 '# core API 그룹'_
  - 문제: apiGroups: [""] 를 core API 그룹이라 했는데, "왜 빈 문자열일까"를 모름. 학생은 '빈 문자열 = 버그인가' 하고 의심
  - 보강: 주석 개선: "# apiGroups: [\"\"] = core API 그룹 (v1, K8s 초기 리소스, Pod/Service/ConfigMap 등)"
- **🟡 MED** · `용어비약` · _문제 6(NetworkPolicy), 약 445~460줄의 podSelector/namespaceSelector_
  - 문제: from 섹션의 구조(podSelector/namespaceSelector 선택지, from 여러 개의 의미)를 설명하지 않음. '같은 네임스페이스의 Pod'라고 한 것도, "다른 네임스페이스도 가능한가"라는 질문이 생김
  - 보강: 코드 앞에 1~2문단 추가: "NetworkPolicy의 from은 여러 소스 조건을 AND/OR로 조합 가능. podSelector만 있으면 같은 네임스페이스 내에서만 필터링. 다른 네임스페이스도 허용하려면 namespaceSelector를 from에 추가. 예: from: [{podSelector: {matchLabels: {tier: backend}}, namespaceSelector: {matchLabels: {name: demo}}}] 형태(OR 조건)"
- **⚪ LOW** · `구조` · _파일 헤더, 1줄_
  - 문제: day19만 제시되고 day1~day18의 학습 순서/맥락이 불명확. 이 모의시험이 언제 응시하는 것인지(중간? 마지막?), 이전 day에서 뭘 배웠는지 알 수 없음
  - 보강: 파일 상단에 '**전제 학습 연결**: day1~day18에서 Deployment/Pod/RBAC/NetworkPolicy/PV/Taint/Service/Job 각각을 배웠으며, 이 day19는 25개 전 도메인 문제를 시간 제약 하에 푸는 모의시험입니다. [README.md에서 전체 커리큘럼 참조]' 추가

### daily/day20.md  · 가독성 3/5 · 스토리라인 2/5 · 단독합격 ❌

**잘된 점:** 실제 클러스터 검증과 스크린샷 이미지를 강조하는 메타구조가 일관되게 문서화됨 / YAML 예제가 대부분 kubectl apply로 검증 가능한 문법으로 작성됨 / 각 문제마다 문제 의도와 내부 동작 원리를 명시

- **🔴 HIGH** · `스토리라인누락` · _문제 15 ConfigMap/Secret_
  - 문제: 각 기술이 왜 필요한지, 직전 기술의 한계, 무엇을 나아졌는지 설명이 완전히 없다.
  - 보강: 각 문제 시작 전에 등장배경 섹션 추가
- **🔴 HIGH** · `용어비약` · _문제 16 Affinity_
  - 문제: requiredDuringSchedulingIgnoredDuringExecution 뒷명느냐 의미 끕끓크나
  - 보강: 각 부분의 의미 끹랬 끹쵴럜 추가
- **🔴 HIGH** · `용어비약` · _문제 19 ServiceAccount_
  - 문제: system:serviceaccount:ns:name 형식의 의미 메커니즖 부재
  - 보강: 내부 동작 원리 시작 전 알뜨끈 추가
- **🔴 HIGH** · `이해난이도` · _문제 21 etcd 복원_
  - 문제: Static Pod 메커니즖 라나 라나
  - 보강: 동작 원리 서 끸단 메커니즖 추가
- **🟡 MED** · `실습재현불가` · _문제 21 SSH_
  - 문제: placeholder IP 뗈꾸런 따라 명령 부재
  - 보강: platform master IP 동적 조회 명령날

---

## 보강 우선순위 (작업 계획)

1. **HIGH 우선** — 스토리라인 누락·용어 비약을 먼저 채운다. 이 둘이 '학생이 못 읽는' 핵심 원인이다.
2. **스토리라인 표준 삽입** — 주요 기술마다 `등장 배경 → 직전 기술 한계 → 개선(메커니즘) → 트레이드오프` 4요소 단락 추가(CLAUDE §4④).
3. **용어 첫 등장 풀이** — 반복 등장 용어(Cilium/eBPF/CRI/Raft/quorum/namespace/declarative/gRPC/WAL)는 첫 등장 인라인 풀이 또는 용어집으로 일괄 처리.
4. **실습 전제조건 블록** — 실습 섹션 머리에 '클러스터 가동·kubeconfig·앞 산출물·인증서 경로 의미' 전제 명시.
5. **정확성 오류 교정** — 버전 호환성 정책(kubelet ≤ apiserver, 최대 2 마이너 뒤) 등 사실 오류 수정.