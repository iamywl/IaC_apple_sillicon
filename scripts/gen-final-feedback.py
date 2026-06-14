#!/usr/bin/env python3
# gen-final-feedback.py <task-output.json> — 최종 5종 재검토 결과 → 자격증별 피드백 파일 생성
import json,sys,statistics,os
from collections import Counter,defaultdict
d=json.load(open(sys.argv[1]))
rs=d.get('result',{}).get('results') or d.get('results') or []
bycert=defaultdict(list)
for r in rs:
    rel=r['file'].split('/k8scert/')[1]  # CKA/daily/day01.md
    bycert[rel.split('/')[0]].append((rel,r))
so={'high':0,'medium':1,'low':2}; sb={'high':'HIGH','medium':'MED','low':'LOW'}
su={'good':'양호','partial':'부분','mostly-reference':'참조과다','none':'없음'}
grand=[]
for cert,items in sorted(bycert.items()):
    items.sort(key=lambda x:x[0]); R=[r for _,r in items]
    L=[];A=L.append
    A(f"# {cert} 최종 재검토 피드백 (개선 후)")
    A("")
    A(f"> 생성: 2026-06-13 (스크린샷+스토리라인+보안도구 실측 반영 후) · 파일당 1 에이전트 병렬 재검토")
    A("")
    A(f"- 단독합격 **{sum(1 for r in R if r['passable'])}/{len(R)}** · 평균 가독성 **{round(statistics.mean(r['readabilityScore'] for r in R),1)}** · 스토리라인 **{round(statistics.mean(r['storylineScore'] for r in R),1)}**")
    A(f"- 스크린샷 활용: " + ", ".join(f"{su.get(k,k)} {v}" for k,v in Counter(r['screenshotUsage'] for r in R).most_common()))
    allg=[x for r in R for x in r['remainingGaps']]
    hi=[x for x in allg if x['severity']=='high']
    A(f"- 남은 부족분 **{len(allg)}** (HIGH {len(hi)}) · HIGH 카테고리: " + (", ".join(f"{k} {v}" for k,v in Counter(x['category'] for x in hi).most_common()) or "없음"))
    grand.append((cert,sum(1 for r in R if r['passable']),len(R),len(hi)))
    A("")
    A("| 파일 | 합격 | 가독성 | 스토리 | 스샷 | H/M/L |")
    A("|:--|:--:|:--:|:--:|:--:|:--:|")
    for rel,r in items:
        g=r['remainingGaps']; h=sum(1 for x in g if x['severity']=='high');m=sum(1 for x in g if x['severity']=='medium');l=sum(1 for x in g if x['severity']=='low')
        A(f"| {rel.split('/',1)[1]} | {'O' if r['passable'] else 'X'} | {r['readabilityScore']} | {r['storylineScore']} | {su.get(r['screenshotUsage'],'')} | {h}/{m}/{l} |")
    A(""); A("---"); A("")
    for rel,r in items:
        if not r['remainingGaps']: continue
        A(f"### {rel.split('/',1)[1]}")
        for x in sorted(r['remainingGaps'],key=lambda y:so[y['severity']]):
            A(f"- **{sb[x['severity']]}** `{x['category']}` _{x['where']}_ — {x['problem']} → {x['fix']}")
        A("")
    open(f"k8scert/{cert}/FEEDBACK-최종재검토.md","w").write("\n".join(L))
    print(f"{cert}: 피드백 생성, 합격 {sum(1 for r in R if r['passable'])}/{len(R)}, HIGH {len(hi)}")
print("\n=== 5종 요약 ===")
for c,p,t,h in grand: print(f"{c}: 단독합격 {p}/{t}, 잔여 HIGH {h}")
