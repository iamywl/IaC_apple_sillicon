export const meta = {
  name: 'cka-review-3missing',
  description: 'CKA day03/04/10 재검토(앞선 인코딩 오류분)',
  phases: [{ title: 'Review' }],
}
const BASE = '/Users/ywlee/sideproejct/IaC_apple_sillicon/k8scert/CKA'
const files = ['daily/day03.md','daily/day04.md','daily/day10.md']
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
const prompt=(f)=>`너는 컴퓨터공학 3~4학년 학생 입장에서 K8s CKA 교재 파일을 검토하는 평가자다. 대상: ${BASE}/${f} — Read 로 전체를 읽어라. "이 파일만으로 사전지식 없는 학생이 이해·실습재현·자격증 문제풀이가 가능한가"를 냉정히 평가. 점검: 용어비약(첫 등장 풀이 없음), 스토리라인(등장배경/직전기술 한계/개선/트레이드오프), 이해난이도, 맥락점프, 실습재현 가능성, 정확성오류. 각 부족분에 severity/category/where/problem/fix 기입. **중요: 출력 텍스트에 이모지·서로게이트·특수유니코드 문자를 절대 쓰지 말 것(JSON 인코딩 오류 방지). where/problem/fix 는 ASCII+한글만.** StructuredOutput 스키마로만 답하라.`
phase('Review')
const r = await parallel(files.map(f=>()=>agent(prompt(f),{label:`review:${f}`,phase:'Review',schema:SCHEMA,agentType:'Explore'})))
return { results: r.filter(Boolean) }
