export const meta = {
  name: 'rest-gap-fill-sonnet',
  description: '4종 잔여 56파일 부족분 보강(Sonnet 에이전트)',
  phases: [{ title: 'Fill' }],
}
const BASE = '/Users/ywlee/sideproejct/IaC_apple_sillicon/k8scert'
const files = ["CKS/daily/day07.md","CKS/daily/day13.md","CKS/01-concepts.md","CKS/02-examples.md","CKS/03-exam-questions.md","CKS/04-tart-infra-practice.md","CKS/05-supplement.md","CKAD/daily/day01.md","CKAD/daily/day02.md","CKAD/daily/day03.md","CKAD/daily/day04.md","CKAD/daily/day05.md","CKAD/daily/day06.md","CKAD/daily/day07.md","CKAD/daily/day08.md","CKAD/daily/day09.md","CKAD/daily/day10.md","CKAD/daily/day11.md","CKAD/daily/day12.md","CKAD/daily/day13.md","CKAD/daily/day14.md","CKAD/01-concepts.md","CKAD/02-examples.md","CKAD/03-exam-questions.md","CKAD/04-tart-infra-practice.md","CKAD/05-supplement.md","KCNA/daily/day01.md","KCNA/daily/day02.md","KCNA/daily/day03.md","KCNA/daily/day04.md","KCNA/daily/day05.md","KCNA/daily/day06.md","KCNA/daily/day07.md","KCNA/daily/day08.md","KCNA/daily/day09.md","KCNA/daily/day10.md","KCNA/01-concepts.md","KCNA/02-examples.md","KCNA/03-exam-questions.md","KCNA/04-tart-infra-practice.md","KCNA/05-supplement.md","KCSA/daily/day01.md","KCSA/daily/day02.md","KCSA/daily/day03.md","KCSA/daily/day04.md","KCSA/daily/day05.md","KCSA/daily/day06.md","KCSA/daily/day07.md","KCSA/daily/day08.md","KCSA/daily/day09.md","KCSA/daily/day10.md","KCSA/01-concepts.md","KCSA/02-examples.md","KCSA/03-exam-questions.md","KCSA/04-tart-infra-practice.md","KCSA/05-supplement.md"]
const SCHEMA = {
  type:'object', additionalProperties:false,
  required:['file','editsApplied','highFixed','summary'],
  properties:{
    file:{type:'string'}, editsApplied:{type:'integer'}, highFixed:{type:'integer'},
    skipped:{type:'array',items:{type:'string'}}, summary:{type:'string'},
  },
}
const prompt=(f)=>{
  const key=f.replace(/\//g,'__')
  return `너는 K8s 자격증 교재를 학부 3~4학년이 읽고 이해.합격할 수 있게 보강하는 기술 에디터다.

대상 파일: ${BASE}/${f}
부족분 목록(JSON): /tmp/restgaps/${key}.json

절차: 부족분 JSON 을 Read 로 읽고 gaps(severity/category/where/problem/fix) 파악 -> 대상 파일 Read -> 각 gap 의 fix 를 참고해 HIGH 부터 실제로 Edit 로 보강. fix 문장을 그대로 베끼지 말고 파일 문맥.용어에 맞춰 자연스럽게 녹여라.

보강 규칙(k8scert/CLAUDE.md 4.5 준수):
- 문체 평서체 "~이다/한다/된다". 경어체.마케팅표현 금지.
- 스토리라인누락: "등장 배경 -> 직전 기술 한계(예: 호스트 iptables, PSP, ABAC, Docker, 영구 SA토큰) -> 무엇이 어떻게 나아졌나(메커니즘) -> 트레이드오프" 단락 추가.
- 용어비약: ACL.L3/L4.CNI.eBPF.X.509.TLS handshake.mTLS.IMDS.CIS.seccomp.AppArmor.CRI.Raft.OPA/Gatekeeper.PSA 등은 그 파일 첫 등장 위치에 한 줄 풀이를 인라인으로.
- 실습재현불가: 실습 섹션 머리에 전제(클러스터 가동, kubeconfig 경로 ~/sideproejct/IaC_apple_sillicon/kubeconfig/, 선행 리소스 생성 명령, SSH 노드 별칭 예 ssh staging-master)를 명시. CKS 파괴 실습은 dev/staging 에서만.
- 정확성오류는 정확히 고친다.

절대 건드리지 말 것: 이미지 스크린샷 줄(![..](images/..)), mermaid 다이어그램, bash/yaml 코드블록의 명령/매니페스트 자체. 기존 내용 삭제 금지(추가.명료화만). 새 이미지 참조 만들지 말 것.

끝나면 StructuredOutput 으로 file, editsApplied, highFixed, skipped, summary 보고.`
}
// 모델 혼용: 기초.복잡한 01-concepts/03-exam-questions 는 opus, 나머지는 sonnet
const pickModel=(f)=> (/01-concepts\.md$|03-exam-questions\.md$/.test(f) ? 'opus' : 'sonnet')
phase('Fill')
const r = await parallel(files.map(f=>()=>agent(prompt(f),{label:`fill:${f}`,phase:'Fill',schema:SCHEMA,model:pickModel(f)})))
const ok=r.filter(Boolean)
return { filled: ok.length, total: files.length,
  totalHighFixed: ok.reduce((s,x)=>s+(x.highFixed||0),0),
  totalEdits: ok.reduce((s,x)=>s+(x.editsApplied||0),0),
  failedFiles: files.filter((f,i)=>!r[i]) }
