# CLAUDE.md — K8s 자격증 로컬 준비 과정 (작업 지침 + 전체 계획)

> 이 저장소의 `k8scert/`에서 작업하는 모든 기여자(사람·에이전트)가 따르는 **단일 기준 문서**. 새 세션 시작 시 먼저 읽는다.
> 한 줄 정체성: **"이 저장소의 실제 tart 멀티클러스터를 실습장 삼아 K8s 자격증 5종(KCNA·KCSA·CKA·CKAD·CKS)을 로컬에서 준비하는 교육 과정"**.
> 강의자료는 클라우드가 아니라 **로컬에 실제로 떠 있는 클러스터에서 직접 실행·검증**하는 것을 전제로 한다.
> 상위 인프라 문서: [../README.md](../README.md) · 기술별 심화: [../certification/](../certification/)

last_updated: 2026-06-12

## 목차
- **[A. 작업 지침]** 1.목적 · 2.디렉터리 · 3.클러스터 환경 · 4.절대규칙 · 5.문서양식 · 6.실습/코드표준 · 7.흐름/Git · 8.금지
- **[B. 전체 계획]** 9.커리큘럼(5종) · 10.실습 클러스터 매핑 · 11.현황 · 12.작업순서

---
# A. 작업 지침
---

## 1. 과정의 목적 (가장 중요)

- 자격증 문제(특히 실기 CKA·CKAD·CKS)를 **이 저장소의 실제 클러스터에서 직접 손으로 풀어보며** 개념이 몸에 남게 한다. "문서가 아니라 클러스터에서 배운다."
- 모든 주제는 **4겹**으로: **📖 등장 배경(왜 생겼나·기존 방식 한계) → 🧩 개념·내부 동작(커널/OS 레벨까지) → 🔬 실측 검증(실제 `kubectl` 실행 + 출력) → 🛠 직접 해보기(시험형 미니랩)**.
- 자격증은 5종이며 **이론(KCNA·KCSA)** 과 **실기(CKA·CKAD·CKS)** 로 나뉜다. 실기는 *속도와 손 숙련*이 핵심이므로 모든 실습은 시간 제약을 의식한 명령형(imperative) 풀이를 우선한다. (상세 §9)

## 2. 디렉터리 구조

```
IaC_apple_sillicon/
├── k8scert/                       ← 자격증 학습 문서(본 과정의 핵심)
│   ├── CLAUDE.md                  ← 본 문서(지침+계획 단일 기준)
│   ├── README.md                  ← 자격증 개요 + 추천 순서 + 12주 통합 스케줄
│   └── {KCNA,KCSA,CKA,CKAD,CKS}/
│       ├── README.md              ← 시험별 목차
│       ├── 01-concepts.md         ← 핵심 개념 정리
│       ├── 02-examples.md         ← YAML/명령 예제 모음
│       ├── 03-exam-questions.md   ← 시험 문제 + 풀이
│       ├── 04-tart-infra-practice.md ← 이 저장소 tart 클러스터 기반 실습
│       ├── 05-supplement.md       ← 보충 자료
│       └── daily/day01.md ~ dayNN.md ← 일별 학습 가이드
├── certification/                 ← 기술별 심화(cilium·etcd·prometheus·istio·containerd ...)
├── config/clusters.json           ← 클러스터 정의(SSOT): platform/dev/staging/prod
├── scripts/                       ← install.sh · boot.sh · status.sh · destroy.sh + install/ boot/ lib/
├── manifests/                     ← 실습용 매니페스트(rbac·network-policies·gatekeeper·hpa ...)
├── kubeconfig/                    ← 클러스터별 kubeconfig(가동 시 생성, .gitignore)
└── terraform/ · dashboard/ · LEARN/
```
자격증 문서는 `k8scert/`에만 둔다. 실습에 쓰는 매니페스트는 `manifests/`, 클러스터 조작 스크립트는 `scripts/`를 재사용한다. 기술 자체의 깊은 설명이 필요하면 `certification/<기술>/`을 링크(중복 작성 금지).

## 3. 실행 환경 — 기존 tart 멀티클러스터만

이 저장소는 `scripts/install.sh`로 이미 구축된 **4개 클러스터**를 실습장으로 쓴다(`config/clusters.json` = Single Source of Truth). **자격증 실습을 위해 새 VM을 함부로 만들지 않는다.**

| 클러스터 | 노드 | 용도 | 자격증 실습 정책 |
|:--|:--|:--|:--|
| `platform` | master + worker1·2 (3) | Prometheus·Grafana·ArgoCD·Jenkins 상주 | **건드리지 말 것**(관측/CI 상주). 읽기 위주 |
| `dev` | master + worker1 (2) | 개발/실습 | **파괴 실습 허용** — RBAC·NetworkPolicy·스케줄링 |
| `staging` | master + worker1 (2) | 스테이징/실습 | **파괴 실습 허용** — CKS 보안 실습·etcd 백업/복구 |
| `prod` | master + worker1·2 (3) | 데모용 프로덕션 | 읽기 위주, 데모 외 변경 자제 |

- **가동/상태/종료**: `./scripts/boot.sh`(VM 기동) · `./scripts/status.sh`(노드·서비스 상태) · `./scripts/shutdown-all.sh`. 처음부터 재설치는 `./scripts/install.sh`.
- **⚠️ 재부팅 후 IP 드리프트 복구 — `./scripts/fix-cluster-ip-drift.sh [클러스터]` 를 반드시 실행한다.** tart 는 재부팅마다 VM IP 를 재할당하는데 kubeadm 클러스터는 init 시점 IP 에 묶여 있다. `boot.sh`(02-wait-clusters)는 apiserver advertise 인증서만 복구하고 **다음 4가지를 놓쳐** 노드는 Ready 로 보여도 파드 네트워킹/DNS 가 깨진다. dev 에서 실측 검증한 완전 복구 절차를 이 스크립트가 수행한다:
  1. **apiserver 인증서 SAN** — 실제 service-CIDR 의 kubernetes SVC IP(dev=10.97.0.1 등)가 빠짐(`boot.sh` 가 `--service-cidr` 미전달, 기본 10.96.0.1 로 생성) → coredns 가 API 인증서 검증 실패해 Ready 안 됨.
  2. **control-plane 정적 파드(apiserver/controller-manager/scheduler)** — 옛 conf 를 메모리에 든 채라 컨트롤러가 옛 IP 로 리더선출 실패 → DaemonSet/Deployment reconcile 정지. 정적 파드 재기동 필요.
  3. **worker `kubelet.conf`** — 옛 master IP 를 가리켜 worker NotReady. server IP 재지정 + kubelet 재시작.
  4. **cilium(kube-proxy 대체)의 `KUBERNETES_SERVICE_HOST` env** — 옛 master IP 하드코딩 → CNI 다운. 새 IP 로 patch + 롤아웃.
  복구 확인: `kubectl --kubeconfig kubeconfig/<c>.yaml get nodes` 가 전부 Ready, `kubectl ... -n kube-system get pods` 의 cilium/coredns 가 Running/Ready, 그리고 파드에서 `nslookup kubernetes.default.svc.cluster.local` 이 SVC IP(예 10.97.0.1)로 해석되면 정상.
- **kubectl 접근**: kubeconfig는 `kubeconfig/<클러스터>.yaml`(가동 시 자동 생성, gitignore). 항상 클러스터를 명시한다.
  ```bash
  kubectl --kubeconfig kubeconfig/dev.yaml get nodes
  # 또는
  export KUBECONFIG=kubeconfig/platform.yaml:kubeconfig/dev.yaml:kubeconfig/staging.yaml:kubeconfig/prod.yaml
  kubectl config get-contexts
  ```
- **노드 SSH**: 전용 키가 전 노드에 배포돼 있어 `ssh dev-master`처럼 **VM 이름 별칭으로 비밀번호 없이** 접속된다(키 `~/.ssh/tart_k8scert`, `~/.ssh/config` 관리 블록). 키 (재)배포·config 갱신은 `./scripts/setup-ssh-keys.sh [클러스터...]`. IP는 `ProxyCommand`가 `tart ip`로 실시간 조회하므로 재부팅해도 그대로 동작한다. 설치 자동화(`scripts/install/*`)는 여전히 `admin/admin`(sshpass)을 쓴다. CKA의 kubeadm·etcd·systemd, CKS의 AppArmor·seccomp·Falco 실습은 이 SSH로 노드에 직접 들어가서 한다.
- **클러스터가 깨지면 복구보다 재생성이 단순하다**: `./scripts/reset-cluster.sh [클러스터]` 가 VM째 완전 삭제 후 현재 IP로 fresh 생성(K8s+Cilium만, 모니터링/CI 제외 → 빠름)하므로 IP 드리프트가 원천 차단된다. 데이터를 보존하며 고치려면 `./scripts/fix-cluster-ip-drift.sh [클러스터]`. 평소 재부팅은 `./scripts/boot.sh`(자동 복구 포함).
- **새 클러스터가 꼭 필요한 경우만**(예: CKA의 kubeadm `init` 처음부터/버전 업그레이드 실습): 기존 platform/prod를 보존한 채 dev/staging에서 하거나, 별도 실습용 클러스터를 만들고 실습 후 정리(`scripts/destroy.sh`)한다. 무분별한 VM 증식 금지.

## 4. 절대 규칙

**① 실습 출력 — 무조건 "실제 터미널 스크린샷 이미지" (텍스트 블록 ✗)**
- 명령 실행 결과는 **실제 터미널 화면을 캡처한 PNG 이미지**로 넣는다. ` ```text ` 블록에 출력 텍스트를 붙여넣는 것은 **금지**다. 학생이 보는 것은 "실제로 이렇게 나온다"는 화면 증거여야 한다.
- 캡처 방법: 실제 tart 클러스터에서 명령을 **진짜 실행**한 터미널 화면을 `screencapture` 로 캡처 → 빈 여백만 크롭(내용 불변) → `k8scert/<자격증>/images/` 에 저장 → 마크다운 `![설명](images/파일.png)` 으로 삽입. 헬퍼: `scripts/capture-shot.sh`.
- **생성·렌더링 금지**: 터미널처럼 그린 가짜 이미지(Pillow 등)·HTML 캡처·합성 금지. 오직 실제 화면 캡처만. 캡션은 정확히 "실제 터미널 캡처".
- 이미지 바로 아래에 명령 자체는 ` ```bash ` 로 보여줘도 되지만, **출력은 이미지로**(텍스트 출력 블록으로 대체 금지).
- 클러스터가 꺼져 캡처가 불가능하면 만들지 말고 "(미캡처)"로 명시한다. 출력을 텍스트로 지어내거나 추정하지 않는다.
- 비고: 자동완성·치트시트처럼 입력만 보여주는 것은 ` ```bash ` 코드블록 가능. **명령의 실행 결과·상태·로그·describe·이벤트는 전부 스크린샷.**

**② 다이어그램 — 학술 논문(figure) 형식, mermaid 흑백이 표준**
- 개념·아키텍처·흐름·관계 그림은 **반드시 mermaid** 로 그린다. **ASCII 박스 다이어그램 금지**(한글은 더블폭이라 테두리가 어긋나 깨진다). 예외: 디렉터리 트리·표는 ASCII 그대로 둔다(그림이 아니다).
- 모든 mermaid 블록 첫 줄에 **흑백 `%%{init ...}%%` 테마 지시자** 필수:
  `%%{init:{'theme':'base','themeVariables':{'primaryColor':'#ffffff','primaryBorderColor':'#000000','primaryTextColor':'#000000','lineColor':'#000000','fontFamily':'Georgia, serif'}}}%%`
- 무채색만(흰 배경·검은 선·검은 글자). **색으로 의미 구분 금지** — 형태(`[]`/`()`/`[()]`/`{}`)·라벨·선 종류(실선 `-->`/점선 `-.->`)로만 구분. `classDef`/`style ... fill:#색` 사용 금지.
- 그림 바로 아래에 **번호·캡션** `_그림 N. 제목._` 을 붙여 논문처럼 인용 가능하게 한다.
- 노드 라벨 줄바꿈은 `\n`. 이모지·장식 금지.

**③ kubectl·YAML 함정 (실기 핵심)**
- **시험은 속도전**: 명령형(imperative) 풀이 우선 — `kubectl run/create/expose` + `--dry-run=client -o yaml > x.yaml` 패턴을 기본으로 가르친다. `alias k=kubectl`, `export do='--dry-run=client -o yaml'` 같은 셋업을 첫머리에 안내.
- **YAML 들여쓰기는 공백만**(탭 금지). 매니페스트 예제는 모두 들여쓰기·`apiVersion`·`kind` 정합성을 실제 `kubectl apply`로 검증한 것만 싣는다.
- **컨텍스트·네임스페이스 사고 방지**: 실기 문제는 문제마다 `kubectl config use-context <ctx>`로 클러스터를 바꾼다. 문서 명령에는 대상 클러스터(`--kubeconfig` 또는 컨텍스트)와 `-n <namespace>`를 항상 명시.
- **CKS 파괴 실습은 dev/staging에서만** — platform/prod에서 정책·RBAC·네트워크를 부수지 않는다(§3 표).

**④ 독자 = 학부 3~4학년. "이 책만 읽고 자격증을 딴다"가 기준**
- **검토 기준(완성 후 필수 self-review)**: 컴퓨터공학 3~4학년이 *사전지식 없이* 이 문서만 읽고 ⓐ 개념을 이해하고 ⓑ 실습을 따라 하고 ⓒ 자격증을 취득할 수 있는가? 못 한다면 미완성이다. 각 daily/concepts 작성 후 이 관점으로 다시 읽고 막히는 지점(용어 비약·맥락 누락·점프)을 메운다.
- **스토리라인 필수** — 모든 기술 주제는 "그냥 이렇게 한다"가 아니라 **왜 이게 나왔는지의 이야기**로 풀어야 한다. 최소 4요소를 명시한다:
  1. **등장 배경** — 이 기술이 없던 시절 무엇이 문제였나(구체적 고통 사례).
  2. **이전 기술과의 차이** — 직전 해결책(예: kube-proxy iptables, docker, PSP)은 무엇이었고 어떤 한계가 있었나.
  3. **무엇이 나아졌나** — 새 기술(예: Cilium eBPF, containerd, PSA)이 그 한계를 *어떻게* 넘었나(메커니즘 수준).
  4. **트레이드오프** — 공짜는 없다. 새로 생긴 비용·제약·주의점.
- **쉬운 이해 우선** — 어려운 개념은 ⓐ 한 문장 직관(비유 가능, 단 §5②의 마케팅 표현은 금지) → ⓑ 정확한 정의 → ⓒ 내부 동작 순으로. 용어는 첫 등장 시 한 줄 풀이. 큰 그림(흑백 다이어그램) 먼저, 디테일 나중.
- **흐름의 연속성** — daily N 은 daily N-1 의 무엇을 전제하는지, 이 주제가 자격증 도메인 어디에 속하는지 첫머리에 한 줄. 고립된 토막 지식 금지.

## 5. 문서 작성 규약

작성 스타일은 다음 규칙을 **모든 문서에 동일 적용**한다(사용자 확정 피드백).

1. **문체는 "~이다/한다/된다" 평서체.** 경어체("~합니다/해요") 사용 금지.
2. **공학적 표현만.** "강력한", "마법처럼", "핵심 열쇠" 등 문학적·마케팅 표현 금지.
3. **깊이 확보.** 표면 설명 금지 — 내부 동작 메커니즘, 커널/OS 레벨 원리, 장애 시나리오, 트러블슈팅을 포함한다.
4. **실습 검증 필수.** 모든 개념/예제에 검증 명령어 + **실제 터미널 스크린샷 이미지**(§4① — ` ```text ` 텍스트 출력 금지)를 붙인다.
5. **등장 배경 + 스토리라인 명시.** 각 기법이 왜 등장했는지, 직전 기술의 한계, 무엇이 나아졌는지, 트레이드오프를 이야기로 풀어 쓴다(§4④).
6. **학부 3~4학년 가독성.** 사전지식 없는 독자가 막히지 않도록 용어 첫 등장 풀이·직관 먼저·흐름 연속성을 지킨다(§4④). 작성 후 그 관점으로 재검토한다.

형식: 한국어(원어 병기 가능), 상단 `> 학습 목표 | 도메인·비중 | 예상 소요`, 표 헤더 정렬(`:---`), 코드블록 언어태그, 상대경로 링크.

- **일별(daily) 양식** (기존 파일 구조 유지):
  ```
  # <자격증> Day N: <제목>
  > 학습 목표 | 도메인: <영역> (비중 %) | 예상 소요 시간
  ## 오늘의 학습 목표 (체크리스트)
  ## 1. <소주제>
     ### 등장 배경·스토리   (왜 생겼나 · 직전 기술 한계 · 무엇이 나아졌나 · 트레이드오프, §4④)
     ### 개념·내부 동작    (구조·메커니즘 + 흑백 다이어그램, 용어 첫 등장 풀이)
     ### 실측 검증        (실제 kubectl 명령 ```bash + 실제 터미널 스크린샷 이미지 + 해석, §4①)
     ### 🛠 직접 해보기     (시험형 미니랩, 시간 제약 의식)
     ### 트러블슈팅        (흔한 실패 + 원인 + 복구 명령)
  ## ✅ 자가점검 (<details> 정답)  ## 시험 팁  ## 더 읽을거리
  ```
- 각 절 **굵은 핵심 메시지 1줄**. 이론(KCNA·KCSA)은 객관식 대비 개념·표 중심, 실기(CKA·CKAD·CKS)는 손 풀이·시간 측정 중심으로 가중치를 둔다.

## 6. 실습·코드 표준

- **YAML/매니페스트**: 들여쓰기 공백 2칸, 탭 금지. 싣기 전 반드시 `kubectl apply --dry-run=server`(가능하면 실제 apply)로 검증. 실습 산출물은 가능한 `manifests/`의 기존 예제를 재사용·참조.
- **Shell**: `#!/usr/bin/env bash` + `set -euo pipefail`, `"$var"`. 클러스터 조작은 `scripts/lib/*`의 기존 함수를 우선 재사용.
- **명령 표기**: 실기 문서는 명령형 우선(`k run/create/expose ... $do`), 선언형은 결과 YAML과 함께. 모든 명령에 대상 클러스터/네임스페이스 명시.
- **Markdown**: GFM, 상대경로 링크.

## 7. 작업 흐름 · Git · 정직성

- 흐름: 로컬 문서 작성 → `./scripts/boot.sh` + `./scripts/fix-cluster-ip-drift.sh`로 클러스터 정상화 → 실제 `kubectl`/SSH 실행 → 출력 캡처 → ` ```text ` 블록에 붙이고 해석 작성.
- **스크린샷 캡처는 백그라운드로 실행한다(규약).** `scripts/capture-shot.sh "<명령>" <out.png>` 로 실제 터미널 화면을 PNG 캡처하며, 이 캡처 작업은 `run_in_background: true`(또는 `&`)로 돌려 메인을 블로킹하지 않는다. 완료 후 이미지를 `images/`에 두고 `![](images/..)`로 문서에 삽입한다. 출력은 절대 ` ```text `로 넣지 않는다(§4①). 짧은 단발 조회는 예외.
  - 대기는 `sleep` 연쇄 대신 `until <조건>; do sleep N; done` 또는 `kubectl wait`/`rollout status`로 한다.
  - 캡처 명령에 대상 클러스터(`--kubeconfig kubeconfig/<c>.yaml`)와 `-n <ns>`를 항상 명시한다.
- **"동작한다"는 실측으로 증명한다.** 출력 블록은 실제 실행 결과만. 불확실하면 단정하지 말고 "(미실측)" 표기.
- 큰 분량은 병렬 에이전트로 텍스트 분담하되, **클러스터 실측은 메인 컨텍스트에서 직접**(에이전트 타임아웃·환경 차이 방지). 한 번에 파일 전체를 쓰려다 타임아웃 난 전례가 있으므로 **섹션별 Edit로 분할 처리**한다(§11 교훈).
- **커밋·푸시는 사용자 요청 시에만.** 보통 "내용 추가 → 검토 → 승인 시 푸시". 커밋 말미:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- 커밋 금지: `kubeconfig/`(비밀), 빌드/임시 산출물.

## 8. 절대 하지 말 것

❌ 출력을 지어내고 실측인 양 표기 · ❌ 명령 출력을 ` ```text ` 텍스트로 삽입(실제 스크린샷만, §4①) · ❌ platform/prod 클러스터를 파괴 실습 대상으로 사용 · ❌ 무분별한 새 tart VM 생성 · ❌ 경어체·문학적 표현 · ❌ 검증 명령/출력 없는 개념 서술 · ❌ 등장 배경·스토리(직전 기술 비교·개선점) 누락 · ❌ 사전지식 가정한 용어 비약(학부생이 못 읽음, §4④) · ❌ 다이어그램에 색(의미 구분용) · ❌ 미검증 "완료" 보고 · ❌ 승인 없이 푸시 · ❌ `k8scert/` 밖에 자격증 문서 산재 · ❌ `kubeconfig/` 커밋

---
# B. 전체 계획
---

## 9. 커리큘럼 — 자격증 5종

### 9.1 추천 취득 순서
```
Phase 1 (입문 이론)   Phase 2 (실기)        Phase 3 (보안)
KCNA  ─────────────▶  CKA ── CKAD  ──────▶  KCSA ── CKS
K8s 기초            클러스터관리 앱개발     보안이론  보안실기
```
- 권장 순서 **KCNA → CKA → CKAD → KCSA → CKS**. CKA·CKAD는 70%+ 겹치므로 연속 취득이 효율적. **CKS는 CKA가 선수조건**.
- 통합 스케줄(하루 3~4시간, 12주)은 [README.md](README.md) 참조.

### 9.2 시험별 성격과 학습 가중치
| 자격증 | 유형 | 문항/시간 | 합격 | daily 수 | 학습 초점 |
|:--|:--|:--|:--|:--:|:--|
| KCNA | 이론(객관식) | 60 / 90분 | 75% | 10 | 개념·아키텍처·CNCF 생태계 (표·암기) |
| KCSA | 이론(객관식) | 60 / 90분 | 67% | 10 | 보안 개념·위협 모델·4C (표·암기) |
| CKA | 실기 | 15~20 / 120분 | 66% | 20 | kubeadm·etcd·스케줄링·트러블슈팅 (손·속도) |
| CKAD | 실기 | 15~20 / 120분 | 66% | 14 | 워크로드·구성·관측·멀티컨테이너 (손·속도) |
| CKS | 실기 | 15~20 / 120분 | 67% | 14 | RBAC·NetworkPolicy·런타임보안·공급망 (손·dev/staging 파괴실습) |

### 9.3 문서 4겹 원칙 (모든 daily·concepts에 적용)
`📖 등장 배경·스토리(왜 생겼나·직전 기술 한계·개선·트레이드오프, §4④) → 🧩 개념·내부 동작(커널/OS 레벨) → 🔬 실측 검증(실제 클러스터 kubectl + 실제 터미널 스크린샷, §4①) → 🛠 시험형 미니랩`.
이론 과목은 🔬를 "개념 확인용 단일 명령"으로 가볍게, 실기 과목은 🔬·🛠를 시간 측정과 함께 무겁게. **완성 후 학부 3~4학년 관점 재검토**로 가독성·스토리 연속성을 점검한다.

## 10. 실습 클러스터 매핑 (자격증 ↔ 이 저장소 클러스터)

| 자격증 주제 | 사용 클러스터 | 비고 |
|:--|:--|:--|
| KCNA/KCSA 개념 확인 | platform(읽기) | 상주 서비스로 실 사례 관찰(Prometheus·ArgoCD 등) |
| CKA: 스케줄링·드레인·노드관리 | dev | 파괴 허용 |
| CKA: kubeadm init/join·업그레이드·etcd 백업/복구 | staging 또는 별도 실습 클러스터 | SSH로 노드 직접 작업, 실습 후 정리 |
| CKAD: 워크로드·구성·probe·job | dev | `manifests/` 예제 재사용 |
| CKS: RBAC·NetworkPolicy·gatekeeper·런타임 | dev/staging | **platform/prod 금지**, 기존 `manifests/{rbac,network-policies,gatekeeper}` 활용 |
| 관측/네트워킹 심화 참고 | platform(Cilium·Hubble·Prometheus) | [../certification/](../certification/) 링크 |

## 11. 현황 (2026-06-12 기준 — 메모리 기록, 재검증 필요)

> 아래는 73일 전 진행 메모 기반이다. **각 파일을 실제로 열어 분량·검증블록·문체를 확인한 뒤** 미완료를 판별한다(개선 전 원본 대비 분량 2배 이상이면 완료로 추정).

**문서 인벤토리(확인됨)**: 5종 모두 `01~05` + `daily/` 존재. daily 수 = CKA 20 · CKAD 14 · CKS 14 · KCNA 10 · KCSA 10 (총 68).

**개선 5기준 = §5 그대로**(검증블록·깊이·평서체·공학적표현·등장배경).

| 파일 | 상태(메모 기준) |
|:--|:--|
| `01-concepts.md` | 5종 DONE |
| `02-examples.md` | 5종 DONE |
| `03-exam-questions.md` | 5종 미완(이전 에이전트 타임아웃) — 재작성 필요 |
| `04-tart-infra-practice.md` | CKA·KCSA DONE / CKAD·CKS·KCNA 부분 |
| `05-supplement.md` | CKA·KCSA DONE / CKAD·CKS·KCNA 부분 |
| `daily/*` | 5종 모두 미착수(68개) |

## 12. 작업 순서 (승인 시)

1. **현황 재검증**: 03/04/05를 실제로 열어 §5 5기준 적용 여부 확인(분량·`​```text`​ 블록·평서체·등장 배경).
2. **03-exam-questions.md 5종 재작성**: 한 번에 전체 쓰지 말고 **문제 묶음(예: 1~10, 11~20)별 Edit 분할**로 타임아웃 회피. 모든 풀이에 실제 클러스터 검증 출력 첨부.
3. **04/05 부분 완료분 마무리**(CKAD·CKS·KCNA): 뒷부분 확장 마커 채우기.
4. **daily 68개**: 시험 1종씩 에이전트 위임(에이전트당 2~3개 묶음), 단 **클러스터 실측은 메인이 직접** 수행해 출력 주입. §5 4겹 양식 적용.
5. **README 목차 갱신** + QA(링크·펜스·다이어그램 흑백·스크린샷 유무) → 승인 시 푸시.
6. **학부 3~4학년 최종 검토(§4④)**: 각 자격증을 한 권의 책으로 보고, 사전지식 없는 독자가 처음부터 읽어 ⓐ 이해 ⓑ 실습 재현 ⓒ 합격 가능한지 통독 점검. 막히는 지점(용어 비약·맥락 점프·스토리 단절)을 목록화해 보강. 자격증 1종씩 통과 기준으로.

> 타임아웃 교훈: 큰 파일은 Write 한 번에 전체를 쓰지 말고 Read → 섹션별 Edit. 에이전트 프롬프트에는 "분량 상한·기존 구조 유지·실측 출력은 비워두고 메인이 채움"을 명시.

---
*이 문서는 k8scert 과정의 단일 기준이다. 계획·규칙이 바뀌면 여기서 갱신하고 `last_updated`만 바꾼다. 상위 인프라 규칙은 [../README.md](../README.md)를 따른다.*
