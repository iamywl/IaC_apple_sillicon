export const meta = {
  name: 'final-5cert-review',
  description: '개선 완료된 5종 교재(스크린샷+스토리라인 반영)를 학부 3~4학년 관점으로 병렬 재검토',
  phases: [{ title: 'Review', detail: '파일당 1 에이전트(sonnet)가 현재 상태 평가' }],
}
const BASE = '/Users/ywlee/sideproejct/IaC_apple_sillicon/k8scert'
const certs = { CKA:20, CKAD:14, CKS:14, KCNA:10, KCSA:10 }
const files = []
for (const [c,n] of Object.entries(certs)) {
  for (let i=1;i<=n;i++) files.push(`${c}/daily/day${String(i).padStart(2,'0')}.md`)
  for (const m of ['01-concepts','02-examples','03-exam-questions','04-tart-infra-practice','05-supplement']) files.push(`${c}/${m}.md`)
}
const SCHEMA = {
  type:'object', additionalProperties:false,
  required:['file','passable','readabilityScore','storylineScore','screenshotUsage','strengths','remainingGaps'],
  properties:{
    file:{type:'string'},
    passable:{type:'boolean', description:'사전지식 없는 학부 3~4학년이 이 파일만으로 이해·실습재현·합격 가능한가'},
    readabilityScore:{type:'integer',minimum:1,maximum:5},
    storylineScore:{type:'integer',minimum:1,maximum:5,description:'등장배경→직전기술→개선→트레이드오프 서사'},
    screenshotUsage:{type:'string',enum:['good','partial','mostly-reference','none'],description:'명령 출력이 실제 스크린샷 이미지로 제시되는가(![](images/..)). 참조노트(예시(참조))가 과도하면 mostly-reference'},
    strengths:{type:'array',items:{type:'string'}},
    remainingGaps:{type:'array',items:{type:'object',additionalProperties:false,
      required:['severity','category','where','problem','fix'],
      properties:{
        severity:{type:'string',enum:['high','medium','low']},
        category:{type:'string',enum:['용어비약','스토리라인누락','맥락점프','이해난이도','실습재현불가','정확성오류','스크린샷부족','구조']},
        where:{type:'string'}, problem:{type:'string'}, fix:{type:'string'}}}},
  },
}
const prompt=(f)=>`너는 컴퓨터공학 3~4학년 학생 입장에서 K8s 자격증 교재 파일을 **최종 검토**하는 평가자다. 이 교재는 최근 대폭 개선됐다(실제 터미널 스크린샷 삽입, 스토리라인·용어풀이 보강, 보안도구 실측 캡처). 지금 **남아있는** 부족분을 찾는 게 목적이다.

대상: ${BASE}/${f} — Read 로 전체를 읽어라(길면 나눠서).

평가:
1. passable — 이 파일만으로 사전지식 없는 학생이 ⓐ이해 ⓑ실습재현 ⓒ문제풀이 가능한가.
2. readabilityScore/storylineScore (1~5).
3. screenshotUsage — 명령 출력이 \`![](images/..)\` 실제 스크린샷으로 제시되면 good. "예시(참조)" blockquote 가 많으면 mostly-reference/partial. (참고: 개념설명·설정파일·미설치도구는 참조가 정당하다.)
4. remainingGaps — 아직 남은 문제만(severity/category/where/problem/fix). 이미 잘 된 건 strengths.
**출력에 이모지·서로게이트 금지(JSON 오류 방지), 한글+ASCII만. StructuredOutput 스키마로만 답하라.**`
phase('Review')
const r = await parallel(files.map(f=>()=>agent(prompt(f),{label:`rev:${f}`,phase:'Review',schema:SCHEMA,model:'sonnet',agentType:'Explore'})))
const ok=r.filter(Boolean)
return { reviewed: ok.length, total: files.length, results: ok }
