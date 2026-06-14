# 01. 프로젝트 컨텍스트

## 1. 저장소 개요

`IaC_apple_sillicon` 은 macOS Apple Silicon 에서 [tart](https://tart.run) 가상화로 **4개 Kubernetes 클러스터**를 띄워 운영·학습하는 IaC 저장소다. 그 위에 `k8scert/` 라는 **K8s 자격증 교육 과정 교재**가 얹혀 있고, Codex 의 작업 대상은 이 `k8scert/` 다.

```
IaC_apple_sillicon/
├── k8scert/                       ← 작업 대상: 자격증 학습 교재
│   ├── CLAUDE.md                  ← 단일 기준 문서(SSOT). 반드시 먼저 읽는다
│   ├── README.md                  ← 자격증 개요 + 추천 순서 + 통합 스케줄
│   ├── .review-loop-state.json    ← 검토→반영 루프 진행 상태(숨김 파일)
│   └── {KCNA,KCSA,CKA,CKAD,CKS}/
│       ├── README.md              ← 시험별 목차
│       ├── 01-concepts.md         ← 핵심 개념
│       ├── 02-examples.md         ← YAML/명령 예제
│       ├── 03-exam-questions.md   ← 시험 문제 + 풀이
│       ├── 04-tart-infra-practice.md ← 이 저장소 tart 클러스터 기반 실습
│       ├── 05-supplement.md       ← 보충 자료
│       ├── FEEDBACK-최종재검토.md  ← 자동 재검토가 남긴 부족분 목록(반영 대상)
│       ├── images/                ← 01~05 문서용 스크린샷 PNG
│       └── daily/
│           ├── day01.md ~ dayNN.md ← 일별 학습 가이드
│           └── images/            ← daily 문서용 스크린샷 PNG
├── config/clusters.json           ← 클러스터 정의(SSOT): platform/dev/staging/prod
├── scripts/                       ← capture-shot.sh · boot.sh · status.sh · wf-*.js · gen-final-feedback.py
├── manifests/                     ← 실습용 매니페스트(demo 스택·network-policies·rbac·gatekeeper ...)
├── kubeconfig/                    ← 클러스터별 kubeconfig(가동 시 생성, .gitignore)
└── certification/                 ← 기술별 심화(cilium·etcd·prometheus·istio·containerd ...)
```

**이미지 경로 규칙(중요):** 마크다운의 `images/...` 상대경로는 그 문서 위치 기준이다.
- `k8scert/CKA/daily/day03.md` 의 `images/x.png` → 실제 파일은 `k8scert/CKA/daily/images/x.png`
- `k8scert/CKA/04-tart-infra-practice.md` 의 `images/x.png` → 실제 파일은 `k8scert/CKA/images/x.png`

## 2. 자격증 5종

| 자격증 | 유형 | 문항/시간 | 합격 | daily 수 | 학습 초점 |
|:--|:--|:--|:--|:--:|:--|
| KCNA | 이론(객관식) | 60 / 90분 | 75% | 10 | 개념·아키텍처·CNCF 생태계 |
| KCSA | 이론(객관식) | 60 / 90분 | 67% | 10 | 보안 개념·위협 모델·4C |
| CKA | 실기 | 15~20 / 120분 | 66% | 20 | kubeadm·etcd·스케줄링·트러블슈팅 |
| CKAD | 실기 | 15~20 / 120분 | 66% | 14 | 워크로드·구성·관측·멀티컨테이너 |
| CKS | 실기 | 15~20 / 120분 | 67% | 14 | RBAC·NetworkPolicy·런타임보안·공급망 |

권장 취득 순서: **KCNA → CKA → CKAD → KCSA → CKS** (CKS 는 CKA 선수).

## 3. tart 멀티클러스터 (실습장 — 교재가 가리키는 대상, Codex 는 접근 불가)

> 아래는 **교재가 실습 대상으로 삼는 클러스터**의 설명이다. Codex 환경에는 이 클러스터가 없으므로(05 문서), Codex 는 이 절을 "교재가 무엇을 전제하는지" 이해하는 용도로만 읽는다. 클러스터에 접속하거나 명령을 실행하지 않는다.

`config/clusters.json` 이 클러스터 정의의 SSOT 다. (실습 시) 새 VM 을 함부로 만들지 않는다.

| 클러스터 | 노드 | 용도 | 파괴 실습 |
|:--|:--|:--|:--|
| `platform` | master + worker1·2 (3) | Prometheus·Grafana·ArgoCD·Jenkins 상주 | **금지**(읽기 위주) |
| `dev` | master + worker1 (2) | 개발/실습 | **허용** — RBAC·NetworkPolicy·스케줄링 |
| `staging` | master + worker1 (2) | 스테이징/실습 | **허용** — CKS 보안·etcd 백업/복구 |
| `prod` | master + worker1·2 (3) | 데모용 프로덕션 | 읽기 위주 |

- `dev` 에는 학습용 **demo 스택**(httpbin·nginx-web·keycloak·redis·postgres·rabbitmq + 서비스)이 `demo` 네임스페이스에 배포돼 있을 수 있다(`manifests/demo/`). KCSA/04·CKS·CKAD 실습이 이를 사용한다. 없으면 `kubectl apply -n demo -f manifests/demo/<app>.yaml` 로 배포한다.
- `dev` apiserver 에는 학습용으로 etcd 암호화(`--encryption-provider-config`)·gVisor(runsc)·gatekeeper·falco·istiod 등이 설치돼 있을 수 있다(설치 여부는 실제 확인 후 기술).

## 4. 검토→반영 루프 (현재 진행 중인 작업의 뼈대)

사용자 지시: **"검토하고, 검토 내용을 반영하고, 이 작업을 최소 3회 이상 반복한다."**

1. **검토**: 각 파일을 "사전지식 없는 학부 3~4학년이 이 문서만 읽고 ⓐ이해 ⓑ실습재현 ⓒ합격할 수 있는가" 관점으로 평가 → 부족분을 `FEEDBACK-최종재검토.md` 로 남긴다.
2. **반영**: 텍스트 부족분(스토리라인·구조·용어·정확성)은 문서를 직접 편집해 채우고, 출력 스크린샷 부족분은 실제 클러스터에서 캡처해 삽입한다.
3. **검증**: 무결성(펜스 균형·깨진 링크·금지된 텍스트 출력블록 0)을 확인한다.
4. 위 1~3 을 최소 3회 반복한다.

진행 상태는 `k8scert/.review-loop-state.json` 에 기록한다(`completed_iterations`, `phase` 등).
