# Terraform

이 문서는 Terraform에 대한 간단한 개요와 이 프로젝트에서 Terraform을 어떻게 사용할 수 있을지에 대한 아이디어를 정리합니다.

## Terraform이란?
Terraform은 HashiCorp에서 만든 인프라스트럭처를 코드로 관리(IaC)하는 도구입니다. 클라우드 리소스(AWS, GCP, Azure), 온프레미스 리소스, 가상화 리소스 등을 선언형으로 정의하고 배포할 수 있습니다.

## 이 프로젝트와의 연동 아이디어
현재 저장소는 `tart` 기반으로 로컬 VM을 관리합니다. Terraform을 도입하면 다음과 같은 장점이 있습니다:

- 인프라 선언화: VM 수, 이름, 리소스 설정을 `*.tf` 파일로 관리
- 변경 추적: `terraform plan`/`apply`로 변경 사항 검토
- 확장성: 향후 클러스터를 AWS/GCP로 확장할 때 동일한 IaC 워크플로우 사용

### 구현 옵션
1. **Terraform local-exec 사용**: Terraform으로 변수와 리소스 구성을 관리하고, `local-exec` 프로비저너로 `tart` 명령어 실행
2. **Custom provider 작성**: Tart용 Terraform provider가 없는 경우, 간단한 provider를 작성해 `tart`와 연동 가능
3. **외부 상태 파일로 변환**: `multi_cluster_config.json`을 Terraform 변수로 변환하는 스크립트 작성

### 간단 예시 (아이디어)
```hcl
variable "clusters" {
  type = list(any)
}

resource "null_resource" "create_vms" {
  count = length(var.clusters)

  provisioner "local-exec" {
    command = "./setup_cluster.sh"
  }
}
```

## 참고 링크
- Terraform 공식: https://www.terraform.io/
- Terraform 문서: https://www.terraform.io/docs

