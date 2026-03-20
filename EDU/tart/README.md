# Tart - Apple Silicon VM 관리 도구 학습 가이드

총 5일 과정으로 구성된 Tart 학습 가이드이다. Apple Silicon 전용 가상머신 관리 도구인 Tart의 개념부터 실전 활용까지 체계적으로 학습한다.

---

## 학습 일정

### [Day 1: 개념 및 Virtualization.framework 심층 분석](day01-concepts-and-virtualization-framework.md)
- Tart 기본 개념 (Virtualization.framework vs Hypervisor.framework)
- 핵심 개념 (OCI Image, Golden Image, Headless Mode, Softnet, VirtioFS)
- OCI 이미지 형식, Rosetta 지원, 디스크 관리, 네트워킹, 공유 디렉토리
- 프로젝트 실습 환경 구성
- Virtualization.framework 핵심 클래스 (VZVirtualMachineConfiguration, VZVirtualMachine)
- 부트로더 (VZLinuxBootLoader vs VZEFIBootLoader)
- 네트워크/디스크/파일 공유 구성 클래스
- macOS 버전별 API 추가 기능 (Ventura, Sonoma, Sequoia)
- near-native 성능 특성과 overhead 분석

### [Day 2: Tart 내부 아키텍처 및 네트워킹 심화](day02-architecture-and-networking.md)
- Swift CLI 구조 및 코드 구조
- VM 상태 머신 (Created → Running → Stopped)
- OCI 이미지 레이어 관리 (manifest, config, layers)
- 로컬 저장소 구조 (~/.tart/)
- Lock 메커니즘 및 IP 할당 메커니즘 심화
- Packer 플러그인 아키텍처
- vmnet.framework 내부 구조
- NAT / Bridged / Softnet 모드 상세
- 포트 포워딩, 다중 NIC 구성, DNS 해석
- 네트워크 성능 튜닝

### [Day 3: Golden Image 전략, CI/CD 환경, 보안](day03-golden-image-cicd-security.md)
- Golden Image 설계 원칙 (최소 충분, 불변성, 재현성, 계층화, 버전 관리)
- 이미지 빌드 자동화 (Packer + Tart)
- 이미지 계층화 전략 및 크기 최적화
- 이미지 버전 관리 및 CI/CD 파이프라인 자동화
- build-golden-image.sh 스크립트 분석
- Cirrus CI / GitHub Actions 통합
- Orchard 대규모 VM 오케스트레이션
- Ephemeral VM 패턴 및 동시성 관리
- VM 격리 (Hypervisor 기반 보안), 네트워크 격리 (Softnet)
- 이미지 서명 (Cosign), SSH 키 관리, 디스크 암호화

### [Day 4: 트러블슈팅, 성능 최적화, 실습](day04-troubleshooting-optimization-labs.md)
- VM 시작 불가, IP 할당 실패, 디스크 공간 부족 해결
- 네트워크 연결 실패, SSH 접속 실패 진단
- 성능 저하 원인 분석 및 로그 확인
- CPU 할당 전략 및 오버커밋 비율 가이드
- 메모리 할당 (Balloon 드라이버), 디스크 I/O 최적화
- VM density 최적화
- 실습 1~11: Tart 설치, VM 생성/실행, tart set, SSH 접속, OCI 레지스트리 연동, 네트워크 모드, 프로젝트 설정 확인, clusters.json 기반 VM 수동 생성, Golden Image 빌드, 포트 포워딩, VM 스냅샷과 복구

### [Day 5: 예제, 자가 점검, 참고문헌](day05-examples-and-review.md)
- 예제 1: VM 생성 스크립트
- 예제 2: 다중 VM 생성 (프로젝트 클러스터 구성)
- 예제 3: VM 이미지 빌드 및 레지스트리 배포
- 예제 4: Packer HCL 자동화 빌드
- 예제 5: GitHub Actions CI/CD 워크플로우
- 예제 6: VM 모니터링 스크립트
- 자가 점검 (기본 개념, Virtualization.framework, 아키텍처, 네트워킹, Golden Image, 저장소, CI/CD, 보안, 성능, 트러블슈팅, 실무 활용)
- 참고문헌
