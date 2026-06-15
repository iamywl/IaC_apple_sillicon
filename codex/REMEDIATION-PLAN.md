# Codex 피드백 반영 작업 계획 (세션 인계용 단일 기준)

> 목적: 포크 `hhg382/IaC_apple_sillicon`의 Codex 검토 피드백을 k8scert 교재에 **전부** 반영한다.
> 이 문서는 **세션이 바뀌어도 그대로 이어서 작업**할 수 있도록 현재 상태·남은 일·절차를 담는다.
> 진행 상태(기계 판독용)는 같은 폴더의 `REMEDIATION-STATE.json` 에 있다.
> 최종 갱신: 2026-06-15 · 작업 브랜치: `codex-remediation` (main에서 분기, **미커밋·미푸시**)

---

## 0. 다음 세션 시작 절차 (먼저 읽기)

1. `git branch --show-current` → `codex-remediation` 인지 확인. 아니면 `git checkout codex-remediation`.
2. 이 파일과 `REMEDIATION-STATE.json` 을 읽어 어디까지 했는지 파악한다.
3. 작업 규칙은 [k8scert/CLAUDE.md](../k8scert/CLAUDE.md) §4①(출력은 실제 캡처)·§4②(흑백 mermaid)·§3(platform/prod 파괴금지)·§5(문체) 를 따른다.
4. **커밋·푸시는 사용자 승인 시에만**(§7). 평소엔 working tree에 누적.
5. 큰 파일은 Write 한 번에 쓰지 말고 **섹션별 Edit**(타임아웃 회피, §11 교훈).

## 1. 피드백 출처 (포크 브랜치)

| 로컬 브랜치 | 포크 브랜치 | 내용 |
|:--|:--|:--|
| `codex-review` | `codex/k8scert-review-20260615-131127` | 1차 검토(상세, 파일당 111~129줄) |
| `codex-review2` | `codex-feedback-20260615-160824` | 2차 검토(통합 요약 + P0/P1/P2 큐, 파일당 57~66줄) |
| (참고) | `codex/k8scert-reconciled-20260615-143719` | Codex가 직접 만든 본문 수정(superset). 우리는 직접 반영 방식을 택해 미사용 |

피드백 문서 위치(검토 브랜치 기준): `codex/FEEDBACK-{SUMMARY,INTEGRITY}.md`, `k8scert/<자격증>/FEEDBACK-codex.md`.
2차 요약의 종합: **단독합격 추정 42/93, 부족분 HIGH 81 / MED 87 / LOW 23, 최상위 병목 = §4① 실제 캡처 미충족.**

## 2. 카테고리와 상태

상태: ✅완료 / 🟡진행중 / ⬜대기

### A. 정적 무결성 — ✅완료 (1차 패스)
- ✅ 깨진 Markdown 링크 5: CKS/daily/day08(`day07.md`), CKA/01-concepts(etcd 링크 정리), CKA/daily/day05·CKAD/daily/day06·KCNA/daily/day05(`../../../certification/`)
- ✅ CKS/daily/day14 bare 출력펜스(L344~352) → Markdown 표(스키마)
- ✅ k8scert/README.md ```text 펜스 2개 → 산문/검증기준

### B. 사실 오류 — ✅완료 (1차 패스, 웹 검증함)
- ✅ CNCF 성숙도: OpenTelemetry Graduated **2026-05-11**, Kyverno **2026-03-16** (KCNA 03/05/day07/day09 일괄 + 기준일 2026-06-15 명시, day09 Q46 보기 D 교체)
- ✅ CKS 시험버전 **v1.34** (daily/day06) · admission webhook 순서 의존 금지로 정정(05-supplement) · etcdctl `--write-out=table`(CKA 04) · KCSA day10 시험조건(공식 60문항/90분/67%, 모의=50문항 축약 라벨) · KCNA 04 kube-proxy→Cilium 기준

### 안전·논리 (HIGH) — ✅완료 (2차 패스)
- ✅ platform/prod 파괴실습 → dev/staging: CKS/daily/day12(관찰 vs 파괴 2분기), CKA/daily/day03(drain→staging), CKA/daily/day08(Deployment→dev), CKA/04-tart-infra-practice(Lab 2.4 nodeSelector·2.5 Taint·Static Pod 랩·kubeadm 업그레이드 drain·치트시트·실전문제3 전부 dev/staging, 단일 worker 현실 주석)
- ✅ KCNA nginx/nginx-web 통일(day03=데모스택 nginx-web, day05=`run=nginx` 셀렉터 정정+ns 멱등화, day08=관찰 nginx-web·미니랩 별도 nginx+정리)

### C. 구조·내용·논리 흐름 — ⬜대기 (정적 가능, 클러스터 불필요)
- ⬜ **C1. daily 마무리 구조 통일**: `자가점검(<details>)`·`시험 팁`·`더 읽을거리`·`직접 해보기` 누락/산재 보강.
  대상: CKAD day02·04·14, KCSA day02·04·06, CKS day08·10·12·14, CKA day20, KCNA day02·05·06·08·10
- ⬜ **C2. 스토리라인 4요소 + 맥락 브리지**(§4④): KCNA 01·02, CKAD example 파일에 "등장배경·직전기술 한계·개선·트레이드오프" 카드. CKAD day12(day11→observability 브리지), CKS 01-concepts(개념→실습 연결).
- ⬜ **C3. ASCII→mermaid 흑백 변환**(§4②, 한글 더블폭으로 ASCII 박스가 깨지므로): KCNA(API흐름·스케줄러·GitOps·관측성), KCSA 05-supplement, CKS 04(eBPF 흐름), CKAD day05·08. **트리·표는 제외**(그림 아님).
- ⬜ **C4. SSH 별칭·노드명·context 표준화**(P1): `ssh admin@<ip>`·`ssh node01`·`node01/master01/worker01`·`dev-worker`·`tart ssh` → repo 별칭(`ssh dev-master`, `ssh staging-worker1` 등). 시험장 표기가 필요하면 `# 시험: node01 / 로컬: staging-worker1` 병기.
  구체 위치(2차 피드백): CKS 02-examples L1021, 03-exam L303·799·875·1218·1304, 05-supplement L4501-4538·4820-4833·4925-5014·5587, day02 L351·555, day06 L22·399·516·530·887·1057, day14 L788·1122·1813; KCSA 04 L5469, 05-supplement L1913·3471·3485, day03 L792. (전수는 `grep -rnE 'ssh admin@<|ssh node0|master01|worker01' k8scert` 로 재확인)
- ⬜ **C5. 캡션·이미지 정합성(정확성, HIGH)**: **CKS/daily/day07 L1070-1078 — "암호화 성공" vs "암호화 미적용" 이미지가 뒤바뀜.** 캡션/순서 정정(plain↔encrypted 반대로 읽히지 않게). 클러스터 불필요(이미지 자체 교체가 아니라 캡션/배치 정정).
- ⬜ **C6. `~/sideproejct/...` 절대경로 → repo 상대(`$(pwd)/kubeconfig/..` 또는 `kubeconfig/..`)**: 330건/89파일(MED). 일괄 sweep 가능하나 검증 필요. `grep -rn '~/sideproejct/IaC_apple_sillicon' k8scert`.

### D. 스크린샷 — ⬜대기 (클러스터 필요, §4①: 조작·생성 금지, 실제 캡처만)
- 피드백 HIGH의 대부분. `(미캡처)`·`예시(참조)`·`# 예상 출력`/`# 출력`/`# yes/no` 인라인 주석을 **실제 터미널 캡처 PNG**로 교체.
- 대량 집중 파일: `CKA/05-supplement.md`(212후보), `KCSA/05-supplement.md`(74, 이미지 0개), `CKA/04`(60), CKS/CKAD/KCNA daily 후반.
- **캡처 불가 시**: 지어내지 말고 `(미캡처)` 또는 "참조 예시, 실행 검증 필요"로 정직 표기(§4①·§8).

## 3. 권장 실행 순서 (2차 피드백 P0→P2 + 우리 진행 반영)

1. ✅ P0 무결성 FAIL 제거 (A) — 완료
2. ✅ P1 platform/prod 안전성 (안전·논리) — 완료
3. ⬜ **C5 캡션 정합성**(CKS day07) — 빠르고 정확성 HIGH. **다음 세션 1순위.**
4. ⬜ **C4 SSH/노드명/context 표준화** — 정적, 재현성 직접 개선. grep 기반 일괄.
5. ⬜ **C1 daily 마무리 구조 통일** — 정적, 학습 흐름.
6. ⬜ **C3 ASCII→mermaid** — 흐름도만(트리·표 제외).
7. ⬜ **C2 스토리라인 4요소** — 작성량 큼, 핵심 단원부터.
8. ⬜ **C6 절대경로 sweep** — 일괄 치환 후 검증.
9. ⬜ **D 스크린샷** — 별도 클러스터 세션. 아래 §4 절차.

## 4. 스크린샷(D) 캡처 절차 — 클러스터 세션에서만

> 사용자 승인 후 진행. boot/IP드리프트 복구는 시간이 걸리므로 별도 세션 권장.

1. 클러스터 기동: `./scripts/boot.sh` → `./scripts/fix-cluster-ip-drift.sh dev`(필요 클러스터마다). 확인: `kubectl --kubeconfig kubeconfig/<c>.yaml get nodes` 전부 Ready, cilium/coredns Running.
2. 파괴 실습은 **dev/staging에서만**(§3). platform/prod는 읽기 전용 관찰.
3. 캡처: `scripts/capture-shot.sh "<명령>" k8scert/<자격증>/images/<파일>.png` 를 **백그라운드**로(§7). 대상 클러스터·`-n <ns>` 명시.
4. 대기는 `sleep` 연쇄 대신 `kubectl wait`/`rollout status`/`until` 사용.
5. 문서에 `![설명](images/<파일>.png)` 삽입, 캡션 "실제 터미널 캡처". 인라인 출력 주석·```text 블록 제거.
6. 캡처할 후보 목록은 각 `FEEDBACK-codex.md` 의 "스크린샷부족" 행(라인 번호 포함)을 backlog로 사용.

## 5. 진행 규칙 / 검증

- 매 패스 후: 펜스 균형(`grep -c '^\`\`\`'`이 짝수), 깨진 링크, ```text 금지, 파괴 platform/prod ops 0, `app=nginx`(bare) 0 을 grep 검증.
- 라인 번호는 편집하면 밀린다. 위치는 **고유 문자열로 재grep** 후 편집.
- 작업 단위 끝낼 때마다 `REMEDIATION-STATE.json` 갱신.

## 6. 현재까지 변경 파일 (codex-remediation working tree, 미커밋)

A·B·안전·논리 패스로 **21파일** 변경됨. 정확 목록은 `git diff --stat` 으로 확인.
주요: k8scert/README.md, CKA/{01-concepts,04-tart-infra-practice,daily/day03,daily/day05,daily/day08}, CKAD/daily/day06, CKS/{05-supplement,daily/day06,daily/day08,daily/day12,daily/day14}, KCNA/{03-exam-questions,04-tart-infra-practice,05-supplement,daily/day05,daily/day07,daily/day09}, KCSA/daily/day10.
