# Bug Report — 코드 리뷰 기반 버그 수정

- **작성일시(Timestamp)**: 2026-03-24 KST
- **환경(Environment)**: M4 Max MacBook Pro, macOS Darwin 24.6.0
- **인프라(Infrastructure)**: Tart VM 10개, K8s 4 클러스터 — kubeadm v1.31
- **영향 범위(Scope)**: 전체 스크립트 (scripts/, config/)

---

## BUG-009: demo.sh — 정의되지 않은 함수 `print_access_info` 호출

| 항목(Field) | 내용(Detail) |
|------|------|
| 심각도(Severity) | **Critical** |
| 카테고리(Category) | Shell Script / Runtime Error |
| 파일(File) | `scripts/demo.sh:145` |

### 증상(Symptom)

`./scripts/demo.sh --skip-dashboard` 실행 시 `print_access_info: command not found` 에러로 스크립트가 비정상 종료.

### 원인(Root Cause)

`print_access_info` 함수가 `demo.sh`와 소스하는 모든 라이브러리(`lib/vm.sh`, `lib/common.sh` 등) 어디에도 정의되어 있지 않음. 함수가 호출만 되고 구현이 누락된 상태.

### 조치(Fix)

`print_access_info` 호출을 제거하고, `demo.sh` 하단(170~194행)에 이미 존재하는 서비스 접속 정보 출력 코드를 인라인으로 작성.

```diff
- print_access_info
+ PLATFORM_IP=$(vm_get_ip "platform-worker1" 2>/dev/null || echo "<platform-worker1-ip>")
+ log_info "=== Platform Services ==="
+ log_info "  Grafana:     http://${PLATFORM_IP}:30300  (admin/admin)"
+ log_info "  ArgoCD:      http://${PLATFORM_IP}:30800"
+ log_info "  Jenkins:     http://${PLATFORM_IP}:30900"
+ log_info "  AlertMgr:    http://${PLATFORM_IP}:30903"
+ ...
```

---

## BUG-010: k8s.sh — NotReady 노드 감지 정규식 오류

| 항목(Field) | 내용(Detail) |
|------|------|
| 심각도(Severity) | **High** |
| 카테고리(Category) | Shell Script / Logic Error |
| 파일(File) | `scripts/lib/k8s.sh:161` |

### 증상(Symptom)

`wait_nodes_ready()` 함수에서 NotReady 노드가 정상 감지되지 않아, 노드가 아직 준비되지 않았는데도 Ready로 판단할 수 있음.

### 원인(Root Cause)

기존 정규식 `"NotReady| [A-Za-z]*Not"`:
- `NotReady`는 정상 매치되지만, `| [A-Za-z]*Not` 부분은 공백 뒤에 알파벳+Not을 찾는 패턴으로, `kubectl get nodes` 출력과 맞지 않는 불필요한 패턴.
- 더 큰 문제는 `Ready`와 `NotReady` 모두 `Ready` 문자열을 포함하므로, 역방향으로 "Ready인 것을 제외"하는 방식이 더 안전.

### 조치(Fix)

`" Ready "` (공백으로 감싼 Ready)를 포함하지 않는 행을 카운트하는 역방향 grep(`-cv`)으로 변경.

```diff
- not_ready=$(kubectl_cmd "$cluster_name" get nodes --no-headers 2>/dev/null | grep -cE "NotReady| [A-Za-z]*Not" || true)
+ not_ready=$(kubectl_cmd "$cluster_name" get nodes --no-headers 2>/dev/null | grep -cv " Ready " || true)
```

---

## BUG-011: install/08-install-cicd.sh — macOS에서 `base64 -d` 비호환

| 항목(Field) | 내용(Detail) |
|------|------|
| 심각도(Severity) | **High** |
| 카테고리(Category) | Shell Script / Platform Compatibility |
| 파일(File) | `scripts/install/08-install-cicd.sh:43,47` |

### 증상(Symptom)

macOS에서 `base64 -d`가 인식되지 않아 ArgoCD/Jenkins 비밀번호 추출 실패. macOS의 `base64` 명령은 `-d` 대신 `-D` 또는 `--decode`를 사용함.

### 원인(Root Cause)

이 프로젝트는 macOS(Apple Silicon)에서 실행되는데, `base64 -d`는 GNU coreutils(Linux) 전용 옵션. macOS 기본 `base64`는 `-D` 플래그를 사용.

### 조치(Fix)

`base64 --decode`로 변경. `--decode`는 GNU와 macOS BSD 양쪽 모두 지원.

```diff
- | base64 -d || echo "check-argocd-secret")
+ | base64 --decode || echo "check-argocd-secret")
```

---

## BUG-012: config/clusters.json — prod-master 메모리 3072MB (3GB) 부족

| 항목(Field) | 내용(Detail) |
|------|------|
| 심각도(Severity) | **Medium** |
| 카테고리(Category) | Configuration / Resource Allocation |
| 파일(File) | `config/clusters.json:39` |

### 증상(Symptom)

prod-master 노드에 3GB 메모리만 할당되어, Kubernetes 컨트롤 플레인(etcd, apiserver, controller-manager, scheduler)이 메모리 부족으로 OOMKill 또는 불안정 동작 가능. 다른 모든 master 노드는 4GB인데 prod-master만 3GB.

### 원인(Root Cause)

설정값 오류. kubeadm 공식 문서에서 master 노드 최소 2GB를 요구하지만, etcd와 apiserver 동시 운영 시 3GB는 부하 시 부족할 수 있음. 다른 3개 클러스터의 master가 모두 4GB인 점과 불일치.

### 조치(Fix)

prod-master 메모리를 4096MB(4GB)로 상향. README 아키텍처 다이어그램 및 스펙 표의 `(2C/3G)` → `(2C/4G)` 동시 수정.

```diff
- { "name": "prod-master", "role": "master", "cpu": 2, "memory": 3072, "disk": 20 }
+ { "name": "prod-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20 }
```

---

## BUG-013: 09-install-alerting.sh — `helm upgrade`에 `--install` 플래그 누락

| 항목(Field) | 내용(Detail) |
|------|------|
| 심각도(Severity) | **Medium** |
| 카테고리(Category) | Shell Script / Helm Deployment |
| 파일(File) | `scripts/install/09-install-alerting.sh:10` |

### 증상(Symptom)

Phase 7(모니터링 설치)이 실패하거나 스킵된 상태에서 Phase 9를 실행하면 `Error: UPGRADE FAILED: "kube-prometheus-stack" has no deployed releases`로 실패.

### 원인(Root Cause)

`helm upgrade`는 이미 설치된 릴리스만 업그레이드 가능. 릴리스가 존재하지 않으면 에러 발생. `--install` 플래그가 있으면 릴리스가 없을 때 자동으로 설치 진행.

### 조치(Fix)

```diff
- helm upgrade kube-prometheus-stack prometheus-community/kube-prometheus-stack \
+ helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
```

---

## BUG-014: build-golden-image.sh — trap 시그널 불완전

| 항목(Field) | 내용(Detail) |
|------|------|
| 심각도(Severity) | **Low** |
| 카테고리(Category) | Shell Script / Resource Cleanup |
| 파일(File) | `scripts/build-golden-image.sh:46` |

### 증상(Symptom)

골든 이미지 빌드 중 Ctrl+C(SIGINT)로 중단하면 `k8s-golden-build` VM이 정리되지 않고 남아있음. `tart list`에 좀비 VM이 계속 표시됨.

### 원인(Root Cause)

`trap cleanup ERR`은 명령 실패(ERR)에서만 cleanup 실행. 사용자의 인터럽트(INT) 또는 종료 신호(TERM)는 처리하지 않음.

### 조치(Fix)

```diff
- trap cleanup ERR
+ trap cleanup ERR INT TERM
```

---

## BUG-015: destroy.sh — `read -p`에 `-r` 플래그 누락

| 항목(Field) | 내용(Detail) |
|------|------|
| 심각도(Severity) | **Low** |
| 카테고리(Category) | Shell Script / Best Practice |
| 파일(File) | `scripts/destroy.sh:10` |

### 증상(Symptom)

입력값에 백슬래시(`\`)가 포함된 경우 이스케이프 시퀀스로 처리되어 예상치 못한 동작 발생 가능.

### 원인(Root Cause)

`read -p`에 `-r` (raw) 플래그가 없으면 백슬래시가 이스케이프 문자로 해석됨. ShellCheck SC2162 경고 대상.

### 조치(Fix)

```diff
- read -p "Are you sure? (yes/no): " confirm
+ read -rp "Are you sure? (yes/no): " confirm
```

---

## BUG-016: README.md — 아키텍처 다이어그램 및 스펙 표 불일치

| 항목(Field) | 내용(Detail) |
|------|------|
| 심각도(Severity) | **Low** |
| 카테고리(Category) | Documentation / Accuracy |
| 파일(File) | `README.md:111,116,212` |

### 증상(Symptom)

README 아키텍처 다이어그램에 prod-master가 `(2C/3G)`로 표기, Total RAM이 `~66 GB`로 기재. 실제 설정(4GB)과 불일치.

### 원인(Root Cause)

`config/clusters.json`의 prod-master 메모리 변경이 README에 반영되지 않음. 또한 기존 3GB 기준으로도 총합은 67GB인데 66GB로 오기재.

### 조치(Fix)

- 아키텍처 다이어그램: `(2C/3G)` → `(2C/4G)`
- Total RAM: `~66 GB` → `~68 GB`
- prod 클러스터 스펙 표: `2 vCPU / 3 GB` → `2 vCPU / 4 GB`
