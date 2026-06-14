export const meta = {
  name: 'cka-undergrad-review',
  description: 'CKA 교재 25개 파일을 학부 3~4학년 관점으로 병렬 검토해 부족분 수집',
  phases: [{ title: 'Review', detail: '파일당 1 에이전트가 가독성·스토리라인 평가' }],
}

const BASE = '/Users/ywlee/sideproejct/IaC_apple_sillicon/k8scert/CKA'
const files = [
  ...Array.from({length:20}, (_,i)=>`daily/day${String(i+1).padStart(2,'0')}.md`),
  '01-concepts.md','02-examples.md','03-exam-questions.md','04-tart-infra-practice.md','05-supplement.md',
]

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file','passable','readabilityScore','storylineScore','strengths','gaps'],
  properties: {
    file: { type: 'string' },
    passable: { type: 'boolean', description: '이 파일만으로 학부생이 해당 주제를 이해하고 자격증 문제를 풀 수 있는가' },
    readabilityScore: { type: 'integer', minimum: 1, maximum: 5, description: '사전지식 없는 학부 3~4학년 가독성(1 막힘~5 매끄러움)' },
    storylineScore: { type: 'integer', minimum: 1, maximum: 5, description: '등장배경→직전기술 한계→개선→트레이드오프 서사 충실도(1 없음~5 완전)' },
    strengths: { type: 'array', items: { type: 'string' }, description: '잘된 점 2~3개' },
    gaps: {
      type: 'array',
      description: '부족분(없으면 빈 배열)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity','category','where','problem','fix'],
        properties: {
          severity: { type: 'string', enum: ['high','medium','low'] },
          category: { type: 'string', enum: ['용어비약','스토리라인누락','맥락점프','이해난이도','실습재현불가','정확성오류','구조'] },
          where: { type: 'string', description: '섹션 제목이나 줄 근처(예: "§3.2 etcd" 또는 "line ~420")' },
          problem: { type: 'string', description: '학부생이 막히는 지점 구체적으로' },
          fix: { type: 'string', description: '어떻게 보강할지 구체적 제안' },
        },
      },
    },
  },
}

const prompt = (f) => `너는 컴퓨터공학 3~4학년 학생의 입장에서 K8s 자격증(CKA) 교재 파일 하나를 검토하는 평가자다.

대상 파일: ${BASE}/${f}
반드시 Read 도구로 이 파일 전체를 읽어라(길면 나눠서 전부).

평가 기준(중요): 이 학생은 K8s 사전지식이 거의 없다. "이 교재만 읽고" ⓐ개념 이해 ⓑ실습 재현 ⓒ자격증 문제 풀이가 가능해야 한다.
다음을 냉정하게 점검하라:
1. 용어가 처음 나올 때 풀이 없이 쓰여 막히는가(용어비약).
2. 각 기술에 스토리라인이 있는가 — 왜 등장했나(등장배경), 직전 기술(예: kube-proxy iptables, docker, PSP)의 한계, 무엇이 어떻게 나아졌나, 트레이드오프. 없으면 storylineScore 낮게.
3. 설명이 직관→정의→내부동작 순으로 쉬운가, 아니면 갑자기 어려운가(이해난이도).
4. 앞 절/앞 day 와 연결이 끊겨 맥락이 점프하는가.
5. 실습을 학생이 그대로 따라 재현할 수 있는가(명령·전제·순서가 충분한가).
6. 명백한 정확성 오류.

각 부족분은 severity(high=취득 불가 수준/medium/low), category, where(섹션·줄 근처), problem(학생이 막히는 지점), fix(구체 보강안)로 적어라. 칭찬은 strengths 에 간단히.
출력은 StructuredOutput 스키마로만. 추측 말고 실제 읽은 내용에 근거하라.`

phase('Review')
const results = await parallel(files.map(f => () =>
  agent(prompt(f), { label: `review:${f}`, phase: 'Review', schema: SCHEMA, agentType: 'Explore' })
))
const ok = results.filter(Boolean)
return {
  reviewed: ok.length,
  total: files.length,
  results: ok,
}
