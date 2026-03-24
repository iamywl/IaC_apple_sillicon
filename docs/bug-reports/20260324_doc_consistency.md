# Bug Report — 문서 일관성 점검 및 수정

- **작성일시(Timestamp)**: 2026-03-24 KST
- **환경(Environment)**: M4 Max MacBook Pro, macOS Darwin 24.6.0
- **영향 범위(Scope)**: 프로젝트 전체 문서 (README.md, docs/, LEARN/, terraform/)

---

## BUG-017: prod-master 메모리 3072MB — 코드·문서·Terraform 전체 불일치

| 항목(Field) | 내용(Detail) |
|------|------|
| 심각도(Severity) | **High** |
| 카테고리(Category) | Configuration / Documentation Consistency |
| 영향 파일 수 | **10개 파일** |

### 증상(Symptom)

`config/clusters.json`에서 prod-master 메모리를 4096MB로 수정했으나, Terraform 변수 파일과 학습 문서 9곳에 이전 값(3072MB / 3GB)이 그대로 남아 있어, 코드와 문서가 불일치.

### 원인(Root Cause)

`config/clusters.json`이 Single Source of Truth로 설계되었으나, Terraform `variables.tf`와 학습 문서들은 JSON 파일의 내용을 직접 복사하여 인용하는 구조. 원본이 변경되어도 복사본이 자동 갱신되지 않음.

### 영향 받은 파일 및 조치(Affected Files & Fix)

| 파일 | 변경 전 | 변경 후 |
|------|---------|---------|
| `terraform/variables.tf:71` | `memory = 3072` | `memory = 4096` |
| `LEARN/02-infrastructure.md:231` | `"memory": 3072` | `"memory": 4096` |
| `LEARN/02-infrastructure.md:266` | `prod-master ... 3 GB` | `4 GB` |
| `LEARN/02-infrastructure.md:278` | `3~4 GB` 설명문 | `4 GB` 통일 설명 |
| `LEARN/06-iac-automation.md:186` | `"memory": 3072` | `"memory": 4096` |
| `LEARN/01-project-overview.md:612` | `3 GB` | `4 GB` |
| `LEARN/15-tech-stack.md:198` | `master(2C/3G)` / `19 GB` | `master(2C/4G)` / `20 GB` |
| `LEARN/guide/01-architecture.md:77` | `"memory": 3072` | `"memory": 4096` |
| `LEARN/guide/01-architecture.md:137` | `3GB` + 설명문 | `4GB` + 수정된 설명 |
| `LEARN/guide/09-terraform-alternative.md:231` | `3072` | `4096` |

---

## BUG-018: Total RAM 값 불일치 — 66GB/71.5GB (실제 68GB)

| 항목(Field) | 내용(Detail) |
|------|------|
| 심각도(Severity) | **Medium** |
| 카테고리(Category) | Documentation / Accuracy |
| 영향 파일 수 | **8개 파일** |

### 증상(Symptom)

문서마다 Total RAM 값이 다르게 기재됨:
- README.md: `~66 GB` (수정 전)
- docs/presentation.md: `71.5 GB`
- docs/analysis, portfolio: `~71.5GB`
- LEARN 문서들: `약 66 GB`

prod-master 4GB 기준 실제 합산: `4+12+8+4+8+4+8+4+8+8 = 68 GB`

### 원인(Root Cause)

총 RAM 계산이 문서 작성 시점마다 달리 계산되었거나, 이전 설정값(prod-master 3GB) 기준으로 계산됨. 문서 간 교차 검증 없이 독립적으로 작성.

### 영향 받은 파일 및 조치(Affected Files & Fix)

| 파일 | 변경 전 | 변경 후 |
|------|---------|---------|
| `README.md:116` | `~66 GB` | `~68 GB` |
| `README.md:227` | `6C / 19G` | `6C / 20G` |
| `docs/presentation.md:97` | `71.5 GB` | `68 GB` |
| `docs/presentation.md:99` | `12 Phase` | `17 Phase` |
| `docs/presentation.md:146` | `6C/19G` | `6C/20G` |
| `docs/presentation.md:150` | `71.5 GB` | `68 GB` |
| `docs/analysis/01-project-overview.md:26` | `~71.5GB` | `~68GB` |
| `docs/portfolio-job-mapping.md:63` | `71.5 GB` | `68 GB` |
| `docs/portfolio-job-mapping.md:218` | `71.5 GB` | `68 GB` |
| `LEARN/01-project-overview.md:211` | `~66 GB` | `~68 GB` |
| `LEARN/02-infrastructure.md:270` | `약 66 GB` | `약 68 GB` |
| `LEARN/13-summary.md:66` | `66 GB` | `68 GB` |
| `LEARN/guide/README.md:50` | `약 66GB` | `약 68GB` |
| `LEARN/guide/08-troubleshooting.md:1143` | `약 66GB` | `약 68GB` |

---

## BUG-019: 설치 Phase 수 12 → 17 미반영

| 항목(Field) | 내용(Detail) |
|------|------|
| 심각도(Severity) | **Medium** |
| 카테고리(Category) | Documentation / Feature Tracking |
| 영향 파일 수 | **6개 파일** |

### 증상(Symptom)

Phase 13~17 (Sealed Secrets, RBAC/Gatekeeper, Backup, ResourceQuota, Harbor)이 추가되었으나, 문서에서는 여전히 "12단계", "12-Phase"로 기재.

### 원인(Root Cause)

Phase 13~17 기능 추가 후 관련 문서의 Phase 수 업데이트 누락.

### 영향 받은 파일 및 조치(Affected Files & Fix)

| 파일 | 변경 |
|------|------|
| `docs/presentation.md` (2곳) | `12단계` → `17단계` |
| `docs/portfolio-job-mapping.md` (5곳) | `12단계` / `12-Phase` → `17단계` / `17-Phase` |
| `docs/analysis/01-project-overview.md` (1곳) | `12단계` → `17단계` |
| `docs/analysis/04-code-navigation-guide.md` (2곳) | `12단계` → `17단계` |
| `docs/project-guide.md` (1곳) | `12단계` → `17단계`, Phase 13~17 내용 추가 |

---

## BUG-020: docs/project-guide.md — Phase 13~17 파이프라인 누락

| 항목(Field) | 내용(Detail) |
|------|------|
| 심각도(Severity) | **Medium** |
| 카테고리(Category) | Documentation / Completeness |
| 파일 | `docs/project-guide.md:92-111` |

### 증상(Symptom)

설치 파이프라인 다이어그램이 Phase 12까지만 나열되어 있음. Phase 13~17이 누락.

### 원인(Root Cause)

Phase 13~17 기능 추가 후 project-guide.md 파이프라인 섹션 업데이트 누락.

### 조치(Fix)

Phase 13~17 (Sealed Secrets, RBAC/Gatekeeper, etcd Backup/Velero, ResourceQuota/LimitRange, Harbor) 내용을 파이프라인 다이어그램에 추가.

---

## BUG-021: README.md — `base64 -d` 명령 macOS 비호환

| 항목(Field) | 내용(Detail) |
|------|------|
| 심각도(Severity) | **Low** |
| 카테고리(Category) | Documentation / Platform Compatibility |
| 파일 | `README.md:657` |

### 증상(Symptom)

ArgoCD 비밀번호 확인 명령에 `base64 -d`가 사용됨. macOS에서 이 명령은 동작하지 않음 (`base64: invalid option -- d`).

### 원인(Root Cause)

`base64 -d`는 GNU coreutils(Linux) 전용. macOS BSD `base64`는 `-D` 또는 `--decode`를 사용.

### 조치(Fix)

`base64 --decode`로 변경. GNU/BSD 양쪽 호환.

> **참고**: LEARN/CERT 디렉토리의 학습 문서에서도 `base64 -d`가 다수 사용되나, 이들은 Linux VM(Ubuntu) 내부에서 실행하는 명령이므로 수정 불필요.

---

## BUG-022: terraform/variables.tf — clusters.json과 동기화 누락

| 항목(Field) | 내용(Detail) |
|------|------|
| 심각도(Severity) | **High** |
| 카테고리(Category) | Configuration / IaC Sync |
| 파일 | `terraform/variables.tf:71` |

### 증상(Symptom)

`config/clusters.json`에서 prod-master 메모리를 4096으로 변경했으나, `terraform/variables.tf`에는 3072 그대로 남아 있어 `terraform apply` 실행 시 Bash 스크립트와 다른 사양의 VM이 생성됨.

### 원인(Root Cause)

Bash 자동화와 Terraform IaC가 동일한 설정을 별도 파일로 관리하는 이중 관리 구조. `docs/terraform.md:118`에도 "양쪽 모두 동기화 필요" 경고가 있으나 실제로는 누락됨.

### 조치(Fix)

`terraform/variables.tf`의 prod-master memory를 `3072` → `4096`으로 수정.
