export const meta = {
  name: 'rest-cert-review',
  description: 'CKS/CKAD/KCNA/KCSA 68개 파일을 학부 3~4학년 관점으로 병렬 검토',
  phases: [{ title: 'Review' }],
}
const BASE = '/Users/ywlee/sideproejct/IaC_apple_sillicon/k8scert'
const certs = { CKS:14, CKAD:14, KCNA:10, KCSA:10 }
const files = []
for (const [c,n] of Object.entries(certs)) {
  for (let i=1;i<=n;i++) files.push(`${c}/daily/day${String(i).padStart(2,'0')}.md`)
  for (const m of ['01-concepts','02-examples','03-exam-questions','04-tart-infra-practice','05-supplement']) files.push(`${c}/${m}.md`)
}

const SCHEMA = {
  type:'object', additionalProperties:false,
  required:['file','passable','readabilityScore','storylineScore','strengths','gaps'],
  properties:{
    file:{type:'string'}, passable:{type:'boolean'},
    readabilityScore:{type:'integer',minimum:1,maximum:5},
    storylineScore:{type:'integer',minimum:1,maximum:5},
    strengths:{type:'array',items:{type:'string'}},
    gaps:{type:'array',items:{type:'object',additionalProperties:false,
      required:['severity','category','where','problem','fix'],
      properties:{
        severity:{type:'string',enum:['high','medium','low']},
        category:{type:'string',enum:['용어비약','스토리라인누락','맥락점프','이해난이도','실습재현불가','정확성오류','구조']},
        where:{type:'string'}, problem:{type:'string'}, fix:{type:'string'}}}},
  },
}
const prompt=(f)=>`너는 컴퓨터공학 3~4학년 학생 입장에서 K8s 자격증 교재 파일을 검토하는 평가자다. 대상: ${BASE}/${f} — Read 로 전체를 읽어라(길면 나눠서). "이 파일만으로 사전지식 없는 학생이 이해·실습재현·자격증 문제풀이가 가능한가"를 냉정히 평가.
점검: 용어비약(첫 등장 풀이 없음), 스토리라인(등장배경/직전기술 한계/개선/트레이드오프), 이해난이도, 맥락점프, 실습재현 가능성, 정확성오류. 각 부족분에 severity/category/where/problem/fix(구체 보강안) 기입. 칭찬은 strengths.
**중요: 출력에 이모지·서로게이트·특수유니코드 금지(JSON 오류 방지). 한글+ASCII 만.** StructuredOutput 스키마로만 답하라.`
phase('Review')
const r = await parallel(files.map(f=>()=>agent(prompt(f),{label:`rev:${f}`,phase:'Review',schema:SCHEMA,agentType:'Explore'})))
const ok=r.filter(Boolean)
return { reviewed: ok.length, total: files.length, results: ok }
