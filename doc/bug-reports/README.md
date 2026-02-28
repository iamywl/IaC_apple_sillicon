# Bug Reports — 버그 리포트(Bug Report) 인덱스(Index)

프로젝트 개발 과정에서 발견된 모든 버그를 타임스탬프(Timestamp) 기준으로 관리한다.

---

## 타임라인(Timeline)

| 일시(Date/Time) | 파일(File) | 건수(Count) | 주요 내용(Summary) |
|------|------|------|------|
| 2026-02-26 00:06 | [VM 배포 실패](20260226_000600_vm_deployment.md) | 4건 | `--config` 옵션(Option) 미존재, cloud-init 미지원, 에러(Error) 은폐, 레이스 컨디션(Race Condition) |
| 2026-02-27 01:00~14:40 | [설치 및 운영](20260227_010000_installation.md) | 7건 | SSH heredoc, conntrack, VM 간 통신(softnet), Cilium 부트스트랩(Bootstrap), wc 파싱(Parsing), Jenkins PVC(PersistentVolumeClaim), prod CPU |
| 2026-02-27 04:00~05:30 | [대시보드](20260227_040000_dashboard.md) | 8건 | ESM(ECMAScript Module) `__dirname`, tart list 파싱, IP null 좀비(Zombie), SCRIPT_DIR 충돌, Tailwind JIT(Just-In-Time), Duration NaN, Vite 포트(Port), NetworkPolicy 차단 |

---

## 통합 통계(Overall Statistics)

| 심각도(Severity) | 건수(Count) |
|----------|------|
| Critical | 3 |
| High | 7 |
| Medium | 6 |
| Minor / Low | 3 |
| **합계(Total)** | **19** |

## 카테고리별 분포(Category Distribution)

| 카테고리(Category) | 건수(Count) |
|----------|------|
| 네트워크(Network) / CNI(Container Network Interface) | 3 |
| VM(Virtual Machine) / 런타임(Runtime) | 3 |
| SSH(Secure Shell) / 스크립트(Script) | 4 |
| K8s(Kubernetes) / CI/CD | 3 |
| 대시보드(Dashboard) / 프론트엔드(Frontend) | 4 |
| 설정(Configuration) | 2 |

---

## 핵심 교훈 요약(Key Lessons Summary)

1. **네트워크 설정은 가장 먼저 검증(Verify Network First)**: VM 간 통신 불가 → K8s 클러스터 구성 자체 불가 (BUG-003)
2. **부트스트랩 순환의존성 주의(Bootstrap Circular Dependency)**: kube-proxy 없이 Cilium 설치 시 ClusterIP 우회 필요 (BUG-004)
3. **CLI 출력 파싱은 방어적으로(Defensive CLI Parsing)**: 공백, 줄바꿈, OS별 차이 고려 (BUG-005, tart list)
4. **ESM vs CJS 호환성(ESM/CJS Compatibility)**: `"type": "module"` 시 Node.js 전역 변수 사용 불가
5. **셸 변수 스코핑(Shell Variable Scoping)**: `source`로 로드하는 라이브러리는 `_` 접두사 사용
6. **Helm 차트 Breaking Changes**: 최신 차트는 키 이름 변경이 빈번 — 릴리스 노트(Release Notes) 확인
7. **제로 트러스트와 테스트 도구(Zero Trust vs Testing Tools)**: 테스트 Pod도 NetworkPolicy 예외 필요
