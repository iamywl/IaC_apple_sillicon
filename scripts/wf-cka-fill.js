export const meta = {
  name: 'cka-gap-fill',
  description: 'CKA 24개 파일의 검토 부족분을 파일별 병렬로 보강(스토리라인·용어·실습전제)',
  phases: [{ title: 'Fill', detail: '파일당 1 에이전트가 자기 파일 gap 반영' }],
}

// day01 은 메인이 이미 보강 → 제외
const files = [
  ...Array.from({length:19}, (_,i)=>`daily/day${String(i+2).padStart(2,'0')}.md`), // day02..day20
  '01-concepts.md','02-examples.md','03-exam-questions.md','04-tart-infra-practice.md','05-supplement.md',
]

const SCHEMA = {
  type:'object', additionalProperties:false,
  required:['file','editsApplied','highFixed','summary'],
  properties:{
    file:{type:'string'},
    editsApplied:{type:'integer'},
    highFixed:{type:'integer', description:'반영한 HIGH 부족분 수'},
    skipped:{type:'array', items:{type:'string'}, description:'반영 못한 항목과 이유'},
    summary:{type:'string', description:'무엇을 보강했는지 2~4줄'},
  },
}

const prompt = (f) => {
  const key = f.replace(/\//g,'__')
  return `너는 K8s 자격증(CKA) 교재를 학부 3~4학년이 읽고 이해·합격할 수 있게 보강하는 기술 에디터다.

대상 파일: /Users/ywlee/sideproejct/IaC_apple_sillicon/k8scert/CKA/${f}
부족분 목록(JSON): /tmp/ckagaps/${key}.json

절차:
1. 부족분 JSON 을 Read 로 읽어 이 파일의 gaps 배열(severity/category/where/problem/fix)을 파악한다.
2. 대상 파일을 Read 로 읽는다(길면 나눠서).
3. 각 gap 의 fix 제안을 참고해 **HIGH 부터** 실제로 Edit 로 보강한다. fix 가 제안하는 문장을 그대로 베끼지 말고 해당 파일 문맥·용어에 맞춰 자연스럽게 녹여라.

보강 규칙(반드시 준수 — k8scert/CLAUDE.md §4·§5):
- **문체 평서체** "~이다/한다/된다". 경어체("~합니다") 금지. "강력한·마법처럼·핵심열쇠" 같은 마케팅·문학 표현 금지(공학적 표현만).
- **스토리라인누락**: 해당 기술에 "등장 배경(없던 시절의 고통) → 직전 기술의 한계(예: kube-proxy iptables, Docker, ZooKeeper, PSP) → 무엇이 어떻게 나아졌나(메커니즘 수준) → 트레이드오프" 단락을 추가한다.
- **용어비약**: Cilium·eBPF·CRI·Raft·quorum·gRPC·WAL·Linux namespace·declarative/reconciliation·IPVS 등은 그 파일에서 처음 나오는 곳에 한 줄 풀이를 인라인으로 넣는다.
- **실습재현불가**: 실습 섹션 머리에 전제(클러스터 가동, kubeconfig 경로 \`~/sideproejct/IaC_apple_sillicon/kubeconfig/\`, 앞 산출물, 인증서 경로 의미)를 명시한다.
- **정확성오류**: 사실 오류는 정확히 고친다(예: kubelet 은 apiserver 보다 높으면 안 되고 최대 2 마이너 뒤까지 허용).

절대 건드리지 말 것:
- \`![...](images/...)\` 스크린샷 줄, \`\`\`mermaid 다이어그램, \`\`\`bash/\`\`\`yaml 코드블록의 명령/매니페스트 자체.
- 기존 내용 삭제 금지 — **추가·명료화만** 한다. 표/구조 유지.
- 새 이미지 참조를 만들지 마라(캡처는 메인이 따로 한다).

작업은 surgical 하게 Edit 로. 다 끝나면 StructuredOutput 으로 file, editsApplied(총 Edit 수), highFixed(반영한 HIGH 수), skipped(못한 것+이유), summary 를 보고하라.`
}

phase('Fill')
const results = await parallel(files.map(f => () =>
  agent(prompt(f), { label: `fill:${f}`, phase: 'Fill', schema: SCHEMA })
))
const ok = results.filter(Boolean)
return {
  filled: ok.length,
  total: files.length,
  totalHighFixed: ok.reduce((s,r)=>s+(r.highFixed||0),0),
  totalEdits: ok.reduce((s,r)=>s+(r.editsApplied||0),0),
  perFile: ok.map(r=>({file:r.file, edits:r.editsApplied, high:r.highFixed, summary:r.summary})),
}
