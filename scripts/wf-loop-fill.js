export const meta = {
  name: 'loop-reflect-fill',
  description: '재검토 결과의 텍스트/구조/내용 HIGH 부족분을 93파일 병렬 보강',
  phases: [{ title: 'Fill' }],
}
const BASE='/Users/ywlee/sideproejct/IaC_apple_sillicon/k8scert'
const certs={CKA:20,CKAD:14,CKS:14,KCNA:10,KCSA:10}
const files=[]
for(const[c,n]of Object.entries(certs)){
  for(let i=1;i<=n;i++)files.push(`${c}/daily/day${String(i).padStart(2,'0')}.md`)
  for(const m of['01-concepts','02-examples','03-exam-questions','04-tart-infra-practice','05-supplement'])files.push(`${c}/${m}.md`)
}
const SCHEMA={type:'object',additionalProperties:false,required:['file','editsApplied','highFixed','summary'],
  properties:{file:{type:'string'},editsApplied:{type:'integer'},highFixed:{type:'integer'},skipped:{type:'array',items:{type:'string'}},summary:{type:'string'}}}
const prompt=(f)=>{
  const key=f.replace(/\//g,'__')
  return `너는 K8s 자격증 교재를 학부 3~4학년 기준으로 보강하는 기술 에디터다. 재검토에서 나온 이 파일의 부족분을 반영한다.

대상: ${BASE}/${f}
부족분 JSON: /tmp/loopgaps/${key}.json (없으면 보강 불필요 — editsApplied:0 보고)

절차: gap JSON Read → 대상 파일 Read → 각 gap 의 fix 를 참고해 **HIGH 부터** Edit 로 보강.

규칙(k8scert/CLAUDE.md §4·§5):
- 평서체 "~이다/한다/된다". 경어체·마케팅표현 금지.
- 스토리라인누락: 해당 컴포넌트/기법에 "등장 배경 → 직전 기술 한계 → 무엇이 어떻게 나아졌나(메커니즘) → 트레이드오프" 단락 추가.
- 용어비약: 첫 등장 위치에 한 줄 풀이(괄호 주석 가능).
- 구조: CLAUDE 일별 양식에 따라 누락된 '## 오늘의 학습 목표'(상단)·'자가점검(<details> 정답)'·'시험 팁'·'더 읽을거리' 절을 추가. 섹션 번호 중복/누락 정리. 상위 헤더 누락 시 추가.
- 정확성오류: "N문제 선언인데 일부만 존재" 류는 **제목/선언을 실제 개수에 맞게 수정**(없는 문제를 급조하지 말 것). 사실오류는 정확히 정정.
- 실습재현불가: \`ssh admin@<...-ip>\` → \`ssh <vm-별칭>\`(예 dev-master/platform-master, ~/.ssh/config 등록 별칭)로 교체, 처음 1회 주석. 자체서명 인증서 등 선행 파일 필요 시 생성 명령 추가. kubeconfig 경로는 ~/sideproejct/IaC_apple_sillicon/kubeconfig/.
- 맥락점프: 앞 day/절과의 연결 1줄 추가.

절대 금지: \`![](images/..)\` 스크린샷 줄·\`\`\`mermaid·\`\`\`bash/yaml 코드블록의 명령/매니페스트 변경. 기존 내용 삭제(추가·명료화만). **새 이미지 참조 만들지 말 것**(스크린샷부족 gap 은 메인이 별도 캡처하므로 무시). \`\`\`text 블록 새로 만들지 말 것.

끝나면 StructuredOutput 으로 file, editsApplied, highFixed, skipped, summary 보고.`
}
const pick=(f)=>(/01-concepts\.md$|03-exam-questions\.md$/.test(f)?'opus':'sonnet')
phase('Fill')
const r=await parallel(files.map(f=>()=>agent(prompt(f),{label:`fill:${f}`,phase:'Fill',schema:SCHEMA,model:pick(f)})))
const ok=r.filter(Boolean)
return {filled:ok.length,total:files.length,totalHigh:ok.reduce((s,x)=>s+(x.highFixed||0),0),totalEdits:ok.reduce((s,x)=>s+(x.editsApplied||0),0),failed:files.filter((f,i)=>!r[i])}
