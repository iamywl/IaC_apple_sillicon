# 03. 검토 체크리스트 & 무결성 점검

검토는 두 층위로 한다: **(A) 자동 무결성 점검**(기계적, 0 이어야 함) + **(B) 학부 3~4학년 통독 검토**(품질).

## A. 자동 무결성 점검 (반영 전·후 매번 실행)

저장소 루트에서 아래 파이썬을 실행한다. **세 항목 모두 0/✓ 여야 통과**다.

```bash
cd ~/sideproejct/IaC_apple_sillicon
python3 - <<'PY'
import glob,re,os
from collections import Counter
pat=re.compile(r'(예상 출력|기대 출력|출력 예시)')
bad=odd=0; textfence=[]; barefence=Counter()
for f in glob.glob('k8scert/**/*.md',recursive=True):
    b=os.path.basename(f)
    if 'FEEDBACK' in b or b in ('README.md','CLAUDE.md'): continue
    s=open(f).read(); d=os.path.dirname(f); lines=s.split('\n')
    # 1) 펜스 균형(줄 시작 ``` 개수가 짝수)
    if sum(1 for l in lines if l.lstrip().startswith('```'))%2: print("⚠️ 펜스 홀수:",f); odd+=1
    # 2) 깨진 이미지 링크
    for m in re.finditer(r'!\[[^\]]*\]\((images/[^)]+)\)',s):
        if not os.path.isfile(os.path.join(d,m.group(1))): print("⚠️ 깨진 링크:",f,m.group(1)); bad+=1
    # 3) 실제 ```text 펜스(줄 시작) — 금지
    if any(l.strip().startswith('```text') for l in lines): textfence.append(f)
    # 4) "예상/기대 출력" 라벨 뒤의 빈 ``` 출력블록 — 금지
    inf=False
    for i,l in enumerate(lines):
        ss=l.strip()
        if ss.startswith('```'):
            if not inf and ss=='```' and pat.search('\n'.join(lines[max(0,i-3):i])): barefence[f]+=1
            inf=not inf
print("펜스 홀수:", odd or "0 ✓")
print("깨진 링크:", bad or "0 ✓")
print("```text 펜스:", textfence or "0 ✓")
print("빈펜스 출력블록:", sum(barefence.values()) or "0 ✓", dict(barefence))
PY
```

추가로 **인라인 주석 출력**(§1 위반)을 찾는다. 아래 패턴이 명령 출력을 주석으로 적은 것이면 스크린샷으로 교체 대상이다(단, 진짜 설명 주석은 제외 — 사람이 판단):

```bash
grep -rnE '^\s*#\s*(출력|기대|예상|결과|CONDITION|yes$|no$|ca\.crt)' k8scert --include='*.md' | grep -v FEEDBACK
```

## B. 학부 3~4학년 통독 검토 (파일당)

각 파일을 아래 기준으로 평가하고, 미흡 항목을 `FEEDBACK-최종재검토.md` 에 `severity(high/medium/low) · category · where · problem · fix` 형식으로 적는다.

**평가 축:**
- `passable`(boolean): 사전지식 없는 학부 3~4학년이 이 파일만으로 ⓐ이해 ⓑ실습재현 ⓒ합격 가능한가?
- `readabilityScore`(1~5): 용어 첫 등장 풀이·직관 우선·흐름 연속성.
- `storylineScore`(1~5): 등장배경→직전기술→개선→트레이드오프 4요소.
- `screenshotUsage`(good/partial/mostly-reference/none): 명령 출력이 실제 스크린샷인가.

**부족분 카테고리(category):**
| category | 무엇 | 반영 주체 |
|:--|:--|:--|
| `스크린샷부족` | 출력이 텍스트/인라인주석/참조 — 실제 캡처 필요 | **실측 캡처**(05 문서) |
| `실습재현불가` | 선행 리소스 생성 명령 누락, `ssh admin@<ip>` 자리표시자, 경로 오류 | 텍스트 + 일부 캡처 |
| `스토리라인누락` | 4요소(특히 직전 기술 한계) 빠짐 | 텍스트 |
| `구조` | 자가점검/직접해보기/시험팁 절 누락, 섹션 번호 불일치, 문제 수 선언 불일치 | 텍스트 |
| `용어비약` | 약어·개념 첫 등장 풀이 없음 | 텍스트 |
| `맥락점프` | 앞 day/절과 연결 끊김, 순방향 링크 없음 | 텍스트 |
| `이해난이도` | 어려운 개념에 직관·비유 부족 | 텍스트 |
| `정확성오류` | 사실 오류, 잘못된 명령/필드 | 텍스트(정정) |

**자주 나오는 실제 부족분(2회차 검토에서 확인된 것):**
- ` ```bash ` 안 인라인 주석 출력(`# 기대: ...`, `# 출력 예: ...`) → 실제 캡처로 교체.
- 시험 문제 풀이에 "검증 - 기대 출력:" 스크린샷이 없음 → 캡처 추가.
- `ssh admin@<...-ip>` 자리표시자 → 이 저장소는 `ssh <vm-별칭>`(예 `ssh dev-master`)로 접속(키 배포됨). 첫 1회 주석으로 안내.
- 매니페스트가 참조하는 ConfigMap/Secret 생성 명령 누락 → 선행 단계 추가.
- 스토리라인 4요소 중 "직전 기술과의 차이" 누락 → 1~2문장 보강.
- 약어(RBAC, HA, SAN, CRI, eBPF 등) 첫 등장 풀이 누락 → 한 줄 풀이.
- 일별 양식의 `자가점검(<details>)`·`직접 해보기(시간 제약)` 절 누락 → 추가.

## C. (참고) 반영·재검토 루프 — Codex 범위 밖

> 이 절은 전체 흐름 이해용이다. **Codex 는 여기에 관여하지 않는다**(반영·캡처·클러스터 검토는 메인 에이전트/사람의 몫). Codex 의 산출물(피드백 표)이 이 루프의 입력이 된다.

반영이 끝나면 메인 에이전트가 다시 자동 검토(`scripts/wf-final-review.js`)를 돌려 `passable` 증가·HIGH 감소를 확인하고, `scripts/gen-final-feedback.py` 로 `FEEDBACK-최종재검토.md` 를 갱신한다. 이 검토→반영을 **최소 3회** 반복한다(`.review-loop-state.json` 의 `completed_iterations`). Codex 는 매 회차의 "검토→피드백 표" 단계를 돕는다.
