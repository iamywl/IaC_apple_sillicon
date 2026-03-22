# containerd - 컨테이너 런타임 학습 가이드

총 4일 과정으로 구성된 containerd 학습 가이드이다. 업계 표준 컨테이너 런타임인 containerd의 내부 동작 원리부터 Kubernetes 환경에서의 실습까지 체계적으로 학습한다.

---

## 학습 일정

### [Day 1: containerd 기본 개념 및 아키텍처 심층](day01-concepts-and-architecture-deep-dive.md)
- containerd 개요 및 핵심 개념 (CRI, OCI Runtime, Content Store, Metadata Store, Snapshotter, Namespace, Task, Shim)
- Client API (gRPC) 및 주요 서비스 목록
- Core Services 상세 (Containers, Content, Images, Leases, Namespaces, Snapshots, Tasks)
- Plugin System (Built-in / External)
- Metadata Store (bbolt/boltdb) 내부 구조
- CRI Plugin Architecture (RuntimeService, ImageService, Pod Sandbox, Streaming API)
- Snapshotter Types (overlayfs, devmapper, stargz) 상세
- Shim v2 Architecture (ttrpc 통신, Pod당 하나의 shim, containerd 재시작 시 동작)

### [Day 2: 컨테이너 생성 흐름 및 이미지 관리](day02-container-creation-and-image-management.md)
- Container Creation Flow 전체 5단계 (Image Pull → Unpack → Container Create → Task Create → Task Start)
- Image Management (Content Store, OCI Image Manifest, Layer Deduplication)
- Registry Authentication 방식
- Image Encryption
- Namespace Isolation (k8s.io, moby, default)
- Runtime Classes (runc, kata-containers, gVisor, youki, crun)
- Kubernetes RuntimeClass 연동
- NRI (Node Resource Interface) 이벤트 및 사용 사례
- Transfer Service (containerd 2.0)

### [Day 3: 아키텍처 종합, 동작 메커니즘, 런타임 비교, 실습](day03-architecture-runtime-comparison-labs.md)
- 전체 아키텍처 다이어그램
- 핵심 컴포넌트 상세 (Content Store, Task Service, Event Service)
- 이미지 Pull 과정 (Resolve → Fetch → Unpack → Register)
- 컨테이너 생성 과정 (Snapshot → Container → Task → Start)
- CRI Plugin과 kubelet 통신 흐름
- 런타임 비교: containerd vs CRI-O vs Docker
- Docker와의 관계 및 dockershim 제거 배경
- 실습 1~13: containerd 상태 확인, 플러그인 탐색, Namespace 관리, ctr 명령어, Socket API Inspection, Snapshotter 탐색, Task 생명주기, Content Store, Metrics, nerdctl, crictl, 이벤트 모니터링, 설정 파일 분석

### [Day 4: 디버깅 가이드, 예제, 자가 점검, 참고문헌](day04-debugging-examples-and-review.md)
- containerd 로그 분석
- 자주 발생하는 문제 해결 (SystemdCgroup 불일치, 이미지 Pull 실패, 컨테이너 시작 실패, 소켓 통신 문제, 디스크 공간 부족)
- 예제 1: config.toml 기본 설정
- 예제 2: 다중 Runtime Class 설정 (runc + kata + gVisor + youki + crun)
- 예제 3: RuntimeClass Kubernetes 리소스 정의
- 예제 4: Registry Mirror 설정
- 예제 5: Private Registry 인증 설정
- 예제 6: containerd systemd Unit File (KillMode, Delegate, OOMScoreAdjust)
- 예제 7: crictl.yaml 설정
- 예제 8: containerd vs Docker vs CRI 명령어 비교
- 자가 점검 (기본 개념, Shim/런타임, Snapshotter, Container Creation Flow, CLI 도구, 심화)
- 참고문헌
