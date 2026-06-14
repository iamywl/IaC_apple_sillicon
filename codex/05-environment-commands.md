# 05. Codex 실행 환경 (문서 전용 — 클러스터 없음)

## 환경 전제 (반드시 인지)

**Codex 는 교재 작성자의 환경과 다른 환경에서 동작한다. 클러스터 접근 권한이 없다.**

- ❌ tart 멀티클러스터, `kubeconfig/`, `kubectl`, SSH 노드 접속 **불가**.
- ❌ 스크린샷 캡처(`scripts/capture-shot.sh`) **불가** — GUI/클러스터가 없다.
- ❌ `kubectl apply/get/exec` 등 클러스터 명령 **불가**.
- ✅ 할 수 있는 것: **저장소의 텍스트 파일을 읽기**, `python3`/`grep` 으로 **파일 내용 분석**(정적), **마크다운 작성**(피드백 파일).

즉 Codex 는 **순수 문서 리뷰어**다. 교재에 적힌 명령·출력·이미지 참조를 클러스터에서 실행해 검증할 수 없으므로, **"문서에 무엇이 있고 무엇이 빠졌는가"를 02·03 기준으로 판정**한다(출력이 실제로 맞는지까지는 검증 대상이 아니며, "출력이 스크린샷으로 제시됐는가 / 텍스트·주석으로 적혔는가"라는 **형식 충족 여부**를 본다).

## Codex 가 쓰는 명령은 사실상 두 가지뿐

### 1) 파일 읽기 / 구조 파악

```bash
cd <repo-root>            # 예: 클론한 저장소 루트
ls k8scert/*/             # 자격증별 파일 목록
# 각 .md 를 열어 읽는다 (편집하지 않는다)
```

### 2) 정적 무결성 점검 (파일만 읽음, 클러스터 불필요)

03 문서 §A 의 파이썬 스니펫을 그대로 실행한다. 이것은 `.md` 파일만 파싱하므로 Codex 환경에서도 동작한다. 결과를 `codex/FEEDBACK-INTEGRITY.md` 에 싣는다.

추가로 **인라인 주석 출력**(§1 위반 후보)을 정적으로 찾는다:

```bash
grep -rnE '^\s*#\s*(출력|기대|예상|결과|CONDITION|yes$|no$|ca\.crt)' k8scert --include='*.md' | grep -v FEEDBACK
```

> 위 grep 매치 중 "명령 실행 결과를 주석으로 적은 것"만 §1 위반이다. 진짜 설명 주석(`# Role 생성`)은 위반이 아니다 — Codex 가 문맥으로 구분해 피드백에 기록한다.

## 이미지 참조 점검 (파일 존재 여부)

마크다운의 `![..](images/x.png)` 가 가리키는 PNG 가 실제로 저장소에 있는지는 파일 존재로 확인할 수 있다(03 §A 스크립트에 포함). **이미지 내용이 올바른지(실제 캡처인지)는 Codex 가 판단할 수 없으므로**, "이미지 참조가 있다/깨졌다", "출력이 이미지 대신 텍스트로 적혔다" 수준까지만 피드백한다.

## 산출물 위치 (Codex 가 쓰는 파일)

Codex 는 아래 파일만 **생성/갱신**한다(교재 본문은 건드리지 않는다):

```
k8scert/KCNA/FEEDBACK-codex.md
k8scert/KCSA/FEEDBACK-codex.md
k8scert/CKA/FEEDBACK-codex.md
k8scert/CKAD/FEEDBACK-codex.md
k8scert/CKS/FEEDBACK-codex.md
codex/FEEDBACK-SUMMARY.md
codex/FEEDBACK-INTEGRITY.md
```

## 커밋/푸시

Codex 는 커밋·푸시하지 않는다(사용자 또는 메인 에이전트가 수행). 작업이 끝나면 생성한 피드백 파일 목록과 요약만 보고한다.
