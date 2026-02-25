# Tart

`Tart`는 macOS에서 가벼운 VM을 생성하고 관리하기 위한 도구입니다. 내부적으로 QEMU와 Apple의 `Hypervisor.framework`를 활용하여 ARM 기반 mac에서 효율적으로 가상 머신을 실행합니다.

## 특징
- macOS 네이티브: Hypervisor.framework 사용으로 성능 및 전력 효율이 우수함
- OCI 이미지 사용: 컨테이너 이미지 포맷(OCI)을 VM 이미지로 사용 가능
- 간단한 CLI: `tart clone`, `tart set`, `tart run`, `tart ip`, `tart stop`, `tart delete` 등

## 본 프로젝트에서의 사용법
- 이미지: `ghcr.io/cirruslabs/ubuntu:latest`
- 주요 명령어:
  - `tart clone <이미지> <vm-name>`: 이미지로부터 VM 복제
  - `tart set <vm-name> --cpu <n> --memory <MB>`: 리소스 설정
  - `tart run <vm-name> --no-graphics`: VM 부팅
  - `tart ip <vm-name>`: VM의 할당된 IP 확인

## 참고 링크
- Tart GitHub: https://github.com/tart/tart
- Tart 설치: `brew install tart`

