# Tart Infra

이 저장소는 macOS 호스트에서 `tart` 도구를 사용해 다중 클러스터(개발/스테이징/프로덕션) VM을 자동으로 생성하고 프로비저닝하는 스크립트를 포함합니다.

간단 설명:
- `setup_cluster.sh` : `multi_cluster_config.json`에 정의된 노드들을 클론, 리소스 설정, 부팅, IP 확인, SSH 프로비저닝까지 자동 수행합니다.
- VM 이미지는 `ghcr.io/cirruslabs/ubuntu:latest` 기반이며, 각 VM에 독립적인 커널과 사용자 계정이 생성됩니다.

문서:
- Tart 소개 및 사용법: [doc/tart.md](doc/tart.md)
- Terraform 개요 및 연동 아이디어: [doc/terraform.md](doc/terraform.md)

시작 방법:
```bash
# 의존성 설치(예: macOS + Homebrew)
brew install tart jq sshpass

# 설정 확인
cat multi_cluster_config.json

# 스크립트 실행
./setup_cluster.sh
```

문의: `multi_cluster_config.json`의 `global_user` 필드를 통해 프로비저닝될 사용자를 지정하세요.
# IaC_apple_sillicon
