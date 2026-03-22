# 재연 가이드 00. 사전 준비

이 문서는 tart-infra 프로젝트를 재현하기 위해 필요한 하드웨어, 소프트웨어, 프로젝트 클론까지의 과정을 다룬다.

---

## 하드웨어 요구사항

| 항목 | 최소 사양 | 권장 사양 |
|------|----------|----------|
| CPU | Apple Silicon M1 | M2 Pro / M3 Pro 이상 |
| RAM | 64GB | 64GB 이상 |
| 디스크 여유 공간 | 200GB | 300GB |
| macOS 버전 | 13 (Ventura) | 14 (Sonoma) 이상 |

### RAM 산출 근거

10개 VM의 메모리 할당 합계는 다음과 같다:

```
platform-master:    4,096 MB
platform-worker1:  12,288 MB
platform-worker2:   8,192 MB
dev-master:         4,096 MB
dev-worker1:        8,192 MB
staging-master:     4,096 MB
staging-worker1:    8,192 MB
prod-master:        3,072 MB
prod-worker1:       8,192 MB
prod-worker2:       8,192 MB
──────────────────────────
합계:              68,608 MB (~67GB)
```

macOS 자체가 8~12GB를 사용하므로, 64GB RAM에서는 일부 VM이 메모리 압박을 받을 수 있다. 가능하면 모든 VM을 동시에 실행하지 않거나, 클러스터 수를 줄여서 테스트하는 것을 고려한다.

> **참고**: 실제로는 Tart VM이 할당된 메모리를 모두 물리적으로 점유하지 않는다. 게스트 OS가 실제로 사용하는 만큼만 호스트 메모리를 소비하므로, 초기 부팅 직후에는 총 사용량이 합계보다 낮다. 모니터링 스택과 애플리케이션이 모두 기동된 후 안정 상태에서 약 50~56GB 정도를 소비한다.

### 디스크 산출 근거

- VM당 디스크: 20GB x 10개 = 200GB
- 베이스 이미지 캐시: 약 5GB
- Golden image(선택): 약 8GB
- Helm 차트 캐시, 컨테이너 이미지 캐시: 약 10GB

총 약 220~230GB가 필요하다. 여유를 두고 300GB를 권장한다.

---

## 소프트웨어 설치

### 1. Homebrew

macOS용 패키지 관리자이다. 이미 설치되어 있다면 건너뛴다.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

설치 확인:
```bash
brew --version
```

예상 출력:
```
Homebrew 4.x.x
```

### 2. Tart

Apple Silicon 전용 가상화 도구이다. Apple의 Virtualization.framework를 사용하여 ARM64 Linux VM을 실행한다.

```bash
brew install cirruslabs/cli/tart
```

설치 확인:
```bash
tart --version
```

예상 출력:
```
tart version 2.x.x
```

> **주의**: Intel Mac에서는 Tart가 동작하지 않는다. Apple Silicon(M1/M2/M3/M4)이 필수이다.

### 3. kubectl

Kubernetes 클러스터를 제어하는 CLI 도구이다.

```bash
brew install kubectl
```

설치 확인:
```bash
kubectl version --client
```

예상 출력:
```
Client Version: v1.31.x
```

### 4. Helm

Kubernetes 패키지 매니저이다. Prometheus, Grafana, ArgoCD, Jenkins, Cilium, Istio 등의 설치에 사용한다.

```bash
brew install helm
```

설치 확인:
```bash
helm version
```

예상 출력:
```
version.BuildInfo{Version:"v3.x.x", ...}
```

### 5. jq

JSON 파싱 도구이다. `config/clusters.json`에서 클러스터 설정을 읽는 데 사용한다.

```bash
brew install jq
```

설치 확인:
```bash
jq --version
```

예상 출력:
```
jq-1.7.x
```

### 6. sshpass

비대화형(non-interactive) SSH 패스워드 인증 도구이다. VM에 자동으로 SSH 접속할 때 사용한다.

```bash
brew install hudochenkov/sshpass/sshpass
```

설치 확인:
```bash
sshpass -V
```

예상 출력:
```
sshpass 1.x
```

> **참고**: 공식 Homebrew에는 sshpass가 없다. 보안상의 이유로 제외되었기 때문에 서드파티 tap을 사용한다.

### 7. Node.js 20+

SRE 대시보드(React + Express)를 실행하는 데 필요하다. 대시보드를 사용하지 않는다면 설치하지 않아도 된다.

```bash
brew install node
```

설치 확인:
```bash
node --version
npm --version
```

예상 출력:
```
v20.x.x
10.x.x
```

### 전체 설치 한 번에 실행

```bash
brew install cirruslabs/cli/tart kubectl helm jq hudochenkov/sshpass/sshpass node
```

### 설치 상태 일괄 확인

```bash
echo "=== 도구 버전 확인 ===" && \
tart --version && \
kubectl version --client --short 2>/dev/null || kubectl version --client && \
helm version --short && \
jq --version && \
sshpass -V 2>&1 | head -1 && \
node --version
```

위 명령의 출력에서 하나라도 "command not found"가 나오면, 해당 도구를 다시 설치한다.

---

## 프로젝트 클론

```bash
git clone https://github.com/ywlee/tart-infra.git
cd tart-infra
```

> **참고**: 저장소 URL은 실제 환경에 맞게 변경한다. private 저장소인 경우 SSH 키 또는 GitHub 토큰 설정이 필요하다.

클론 후 디렉토리 확인:

```bash
ls -la
```

예상 출력:
```
.git/
.gitignore
CERT/
LEARN/
config/
dashboard/
docs/
kubeconfig/
manifests/
scripts/
terraform/
README.md
```

---

## 디렉토리 구조 설명

```
tart-infra/
├── config/
│   └── clusters.json          # 전체 인프라의 설정 파일 (클러스터, 노드, CIDR, 리소스)
├── scripts/
│   ├── demo.sh                # 단일 진입점: 전체 구축 + 대시보드 실행
│   ├── install.sh             # 17단계 설치 오케스트레이터
│   ├── build-golden-image.sh  # Golden image 빌드 (설치 시간 단축용)
│   ├── boot.sh                # 기존 VM 기동 + 클러스터 헬스 체크
│   ├── shutdown.sh            # VM Graceful Shutdown (drain 후 정지)
│   ├── destroy.sh             # 전체 인프라 삭제 (VM + kubeconfig)
│   ├── status.sh              # 인프라 상태 확인
│   ├── install/               # 17개 설치 단계 스크립트
│   │   ├── 01-create-vms.sh
│   │   ├── 02-prepare-nodes.sh
│   │   ├── 03-install-runtime.sh
│   │   ├── 04-install-kubeadm.sh
│   │   ├── 05-init-clusters.sh
│   │   ├── 06-install-cilium.sh
│   │   ├── 07-install-monitoring.sh
│   │   ├── 08-install-cicd.sh
│   │   ├── 09-install-alerting.sh
│   │   ├── 10-install-network-policies.sh
│   │   ├── 11-install-hpa.sh
│   │   └── 12-install-istio.sh
│   ├── boot/                  # 부팅 하위 단계
│   │   ├── 01-start-vms.sh
│   │   ├── 02-wait-clusters.sh
│   │   └── 03-verify-services.sh
│   └── lib/                   # 공통 함수 라이브러리
│       ├── common.sh          # 로깅, JSON 파싱, 의존성 체크
│       ├── vm.sh              # Tart VM 생성/시작/중지/삭제
│       ├── ssh.sh             # SSH 접속, 원격 명령 실행
│       └── k8s.sh             # kubeadm 초기화, Cilium 설치, 노드 준비
├── manifests/                 # Kubernetes 매니페스트 및 Helm values
│   ├── cilium-values.yaml
│   ├── hubble-values.yaml
│   ├── monitoring-values.yaml
│   ├── loki-values.yaml
│   ├── argocd-values.yaml
│   ├── jenkins-values.yaml
│   ├── metrics-server-values.yaml
│   ├── alerting/              # AlertManager 규칙, webhook
│   ├── demo/                  # 데모 앱 (nginx, httpbin, redis, postgres, rabbitmq, keycloak)
│   ├── hpa/                   # HPA, PDB 정의
│   ├── istio/                 # Istio VirtualService, DestinationRule, Gateway
│   └── network-policies/      # CiliumNetworkPolicy (default-deny + allow 규칙)
├── kubeconfig/                # 각 클러스터의 kubeconfig 파일 (설치 후 자동 생성)
│   ├── platform.yaml
│   ├── dev.yaml
│   ├── staging.yaml
│   └── prod.yaml
├── dashboard/                 # SRE 대시보드 (React + Express + TypeScript)
│   ├── server/                # 백엔드: kubectl/tart/SSH로 메트릭 수집
│   └── src/                   # 프론트엔드: 클러스터 상태 시각화
├── terraform/                 # Terraform 코드 (참고용)
├── docs/                      # 프로젝트 분석 문서, 버그 리포트
├── CERT/                      # K8s 자격증 교육 자료
└── LEARN/                     # 프로젝트 학습 가이드 (이 문서가 속한 디렉토리)
```

### 핵심 파일 관계

1. `config/clusters.json`이 모든 스크립트의 설정 소스이다
2. `scripts/lib/common.sh`이 clusters.json을 파싱하는 함수를 제공한다
3. `scripts/lib/vm.sh`, `ssh.sh`, `k8s.sh`가 common.sh 위에서 VM/SSH/K8s 작업을 추상화한다
4. `scripts/install/` 아래 12개 스크립트가 이 라이브러리를 사용하여 각 단계를 실행한다
5. `scripts/install.sh`가 12개 단계를 순서대로 호출하는 오케스트레이터이다
6. `scripts/demo.sh`가 install.sh + status.sh + dashboard를 묶어 단일 진입점을 제공한다

---

## 문제 해결

### Tart 설치 후 "permission denied" 오류

macOS 시스템 설정 > 개인정보 및 보안 > 개발자 도구에서 터미널 앱의 권한을 허용한다.

### brew install sshpass 실패

tap이 올바르게 추가되었는지 확인한다:

```bash
brew tap hudochenkov/sshpass
brew install hudochenkov/sshpass/sshpass
```

### Tart pull이 느린 경우

첫 번째 `tart pull ghcr.io/cirruslabs/ubuntu:latest`는 약 1~2GB를 다운로드한다. 네트워크 상태에 따라 5~15분 소요된다. 이후에는 로컬 캐시를 사용하므로 빠르다.

### macOS 방화벽 경고

Tart VM을 처음 실행할 때 macOS가 네트워크 접근 허용 여부를 묻는다. "허용"을 선택한다. 이를 거부하면 VM에 SSH 접속이 불가하다.

---

다음 장: [01. 아키텍처 이해](01-architecture.md)
