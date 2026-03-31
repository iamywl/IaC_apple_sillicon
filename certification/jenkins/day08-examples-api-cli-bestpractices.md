# Day 8: 예제, API, CLI, 베스트 프랙티스, 자가 점검

Jenkins 예제 모음, REST API와 CLI 활용, 베스트 프랙티스, 자가 점검 문제, 그리고 참고문헌을 다룬다.

---

## 예제

### 예제 1: 기본 Jenkinsfile (Kubernetes Agent)
```groovy
// Jenkinsfile
pipeline {
    agent {
        kubernetes {
            yaml '''
                apiVersion: v1
                kind: Pod
                spec:
                  containers:
                    - name: docker
                      image: docker:dind
                      securityContext:
                        privileged: true
            '''
        }
    }

    stages {
        stage('Clone') {
            steps {
                git branch: 'main',
                    url: 'https://github.com/user/app.git'
            }
        }

        stage('Build') {
            steps {
                container('docker') {
                    sh 'docker build -t my-app:${BUILD_NUMBER} .'
                }
            }
        }

        stage('Test') {
            steps {
                sh 'npm test'
            }
        }

        stage('Push') {
            steps {
                container('docker') {
                    sh 'docker push registry/my-app:${BUILD_NUMBER}'
                }
            }
        }
    }

    post {
        success {
            echo 'Pipeline 성공!'
        }
        failure {
            echo 'Pipeline 실패!'
        }
    }
}
```

### 예제 2: 멀티스테이지 파이프라인 (parallel, withCredentials)
```groovy
pipeline {
    agent any

    environment {
        REGISTRY = 'registry.example.com'
        APP_NAME = 'my-app'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build & Test') {
            parallel {
                stage('Unit Test') {
                    steps {
                        sh 'npm run test:unit'
                    }
                }
                stage('Lint') {
                    steps {
                        sh 'npm run lint'
                    }
                }
                stage('Security Scan') {
                    steps {
                        sh 'npm audit --audit-level=high'
                    }
                }
            }
        }

        stage('Build Image') {
            steps {
                sh "docker build -t ${REGISTRY}/${APP_NAME}:${BUILD_NUMBER} ."
            }
        }

        stage('Push Image') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'registry-creds',
                    usernameVariable: 'USER',
                    passwordVariable: 'PASS'
                )]) {
                    sh "echo $PASS | docker login ${REGISTRY} -u $USER --password-stdin"
                    sh "docker push ${REGISTRY}/${APP_NAME}:${BUILD_NUMBER}"
                }
            }
        }

        stage('Update Manifest') {
            steps {
                // ArgoCD가 감지할 수 있도록 매니페스트 업데이트
                sh """
                    sed -i 's|image:.*|image: ${REGISTRY}/${APP_NAME}:${BUILD_NUMBER}|' \
                        manifests/deployment.yaml
                    git add manifests/deployment.yaml
                    git commit -m "chore: update image to ${BUILD_NUMBER}"
                    git push origin main
                """
            }
        }
    }
}
```

### 예제 3: Matrix Build (다중 환경 빌드)
```groovy
pipeline {
    agent none

    stages {
        stage('Test') {
            matrix {
                axes {
                    axis {
                        name 'NODE_VERSION'
                        values '16', '18', '20'
                    }
                    axis {
                        name 'OS'
                        values 'linux', 'windows'
                    }
                }
                excludes {
                    exclude {
                        axis { name 'NODE_VERSION'; values '16' }
                        axis { name 'OS'; values 'windows' }
                    }
                }
                stages {
                    stage('Test on Combination') {
                        agent {
                            docker {
                                image "node:${NODE_VERSION}"
                                label "${OS}"
                            }
                        }
                        steps {
                            sh 'node --version'
                            sh 'npm ci'
                            sh 'npm test'
                        }
                    }
                }
            }
        }
    }
}
```

### 예제 4: Manual Approval (input step)
```groovy
pipeline {
    agent any

    environment {
        APP_NAME = 'my-app'
        REGISTRY = 'registry.example.com'
    }

    stages {
        stage('Build') {
            steps {
                sh "docker build -t ${REGISTRY}/${APP_NAME}:${BUILD_NUMBER} ."
            }
        }

        stage('Deploy to Staging') {
            steps {
                sh 'kubectl apply -f manifests/staging/'
                sh 'kubectl rollout status deployment/${APP_NAME} -n staging --timeout=120s'
            }
        }

        stage('Approval') {
            steps {
                // 지정된 사용자의 수동 승인을 기다린다
                // 이 Stage에서 Agent를 점유하지 않도록 agent none을 사용하는 것을 권장한다
                input message: 'Production 배포를 승인하시겠습니까?',
                      ok: '배포 승인',
                      submitter: 'admin,deploy-team',
                      parameters: [
                          string(name: 'APPROVE_REASON', defaultValue: '', description: '승인 사유')
                      ]
            }
        }

        stage('Deploy to Production') {
            steps {
                sh 'kubectl apply -f manifests/production/'
                sh 'kubectl rollout status deployment/${APP_NAME} -n production --timeout=300s'
            }
        }
    }

    post {
        failure {
            // 실패 시 자동 롤백
            sh 'kubectl rollout undo deployment/${APP_NAME} -n production'
            slackSend channel: '#alerts', color: 'danger',
                      message: "Production 배포 실패 - 자동 롤백 수행: ${env.JOB_NAME} #${env.BUILD_NUMBER}"
        }
        success {
            slackSend channel: '#deploys', color: 'good',
                      message: "Production 배포 성공: ${env.JOB_NAME} #${env.BUILD_NUMBER}"
        }
    }
}
```

### 예제 5: Parallel Stages와 stash/unstash
```groovy
pipeline {
    agent any

    stages {
        stage('Build') {
            steps {
                sh 'npm ci'
                sh 'npm run build'
                // 빌드 아티팩트를 임시 저장하여 다른 Agent에서도 사용할 수 있다
                stash includes: 'dist/**', name: 'build-artifacts'
            }
        }

        stage('Parallel Testing') {
            parallel {
                stage('Unit Tests') {
                    agent { label 'linux' }
                    steps {
                        unstash 'build-artifacts'
                        sh 'npm run test:unit'
                    }
                    post {
                        always {
                            junit 'reports/unit/*.xml'
                        }
                    }
                }
                stage('Integration Tests') {
                    agent { label 'linux' }
                    steps {
                        unstash 'build-artifacts'
                        sh 'npm run test:integration'
                    }
                    post {
                        always {
                            junit 'reports/integration/*.xml'
                        }
                    }
                }
                stage('E2E Tests') {
                    agent {
                        docker {
                            image 'cypress/included:latest'
                        }
                    }
                    steps {
                        unstash 'build-artifacts'
                        sh 'npx cypress run'
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'cypress/screenshots/**', allowEmptyArchive: true
                        }
                    }
                }
            }
        }
    }
}
```

### 예제 6: Shared Library를 활용한 표준 파이프라인
```groovy
// vars/standardCIPipeline.groovy (Shared Library)
def call(Map config) {
    pipeline {
        agent {
            kubernetes {
                yaml libraryResource('com/example/pod-templates/default.yaml')
            }
        }

        environment {
            REGISTRY = config.registry ?: 'registry.example.com'
            APP_NAME = config.appName ?: error("appName is required")
        }

        options {
            timeout(time: config.timeout ?: 30, unit: 'MINUTES')
            timestamps()
            buildDiscarder(logRotator(numToKeepStr: '20'))
        }

        stages {
            stage('Checkout') {
                steps {
                    checkout scm
                }
            }

            stage('Build') {
                steps {
                    container(config.buildContainer ?: 'builder') {
                        sh config.buildCommand ?: 'make build'
                    }
                }
            }

            stage('Test') {
                when {
                    expression { config.skipTests != true }
                }
                steps {
                    container(config.buildContainer ?: 'builder') {
                        sh config.testCommand ?: 'make test'
                    }
                }
                post {
                    always {
                        junit(testResults: config.testResults ?: '**/test-results/*.xml',
                              allowEmptyResults: true)
                    }
                }
            }

            stage('Build Image') {
                when {
                    anyOf {
                        branch 'main'
                        branch 'develop'
                    }
                }
                steps {
                    container('kaniko') {
                        sh """
                            /kaniko/executor \
                              --context=dir:///workspace \
                              --destination=${REGISTRY}/${APP_NAME}:${BUILD_NUMBER} \
                              --cache=true
                        """
                    }
                }
            }

            stage('Deploy') {
                when {
                    branch 'main'
                    beforeAgent true
                }
                steps {
                    echo "Deploying ${APP_NAME}:${BUILD_NUMBER}"
                    // GitOps manifest update
                }
            }
        }

        post {
            success {
                slackSend(channel: config.slackChannel ?: '#builds', color: 'good',
                          message: "CI 성공: ${APP_NAME} #${BUILD_NUMBER}")
            }
            failure {
                slackSend(channel: config.slackChannel ?: '#builds', color: 'danger',
                          message: "CI 실패: ${APP_NAME} #${BUILD_NUMBER}")
            }
        }
    }
}
```

```groovy
// Jenkinsfile (사용하는 쪽)
@Library('shared-pipeline@main') _

standardCIPipeline(
    appName: 'my-service',
    registry: 'registry.example.com',
    buildContainer: 'maven',
    buildCommand: 'mvn clean package -DskipTests',
    testCommand: 'mvn test',
    testResults: '**/surefire-reports/*.xml',
    slackChannel: '#team-a-builds',
    timeout: 20
)
```

### 예제 7: Scripted Pipeline - 동적 Stage 생성
```groovy
// Scripted Pipeline으로 동적 Stage 생성
def environments = [
    [name: 'dev',     cluster: 'dev',     autoApprove: true],
    [name: 'staging', cluster: 'staging', autoApprove: true],
    [name: 'prod',    cluster: 'prod',    autoApprove: false]
]

node {
    stage('Build') {
        checkout scm
        sh 'make build'
        stash includes: 'dist/**', name: 'build'
    }

    for (env in environments) {
        stage("Deploy to ${env.name}") {
            if (!env.autoApprove) {
                input message: "${env.name} 배포를 승인하시겠습니까?",
                      ok: '승인',
                      submitter: 'admin'
            }

            unstash 'build'
            withCredentials([file(credentialsId: "${env.cluster}-kubeconfig", variable: 'KUBECONFIG')]) {
                sh """
                    kubectl --kubeconfig=\$KUBECONFIG apply -f manifests/${env.name}/
                    kubectl --kubeconfig=\$KUBECONFIG rollout status deploy/my-app -n ${env.name} --timeout=300s
                """
            }
        }

        stage("Verify ${env.name}") {
            sh "curl -sf http://${env.name}.example.com/health || exit 1"
        }
    }
}
```

---

## Jenkins REST API

### 주요 API 엔드포인트

Jenkins는 모든 리소스에 대해 REST API를 제공한다. URL 끝에 `/api/json` 또는 `/api/xml`을 붙이면 된다.

| API | 메서드 | 설명 |
|-----|--------|------|
| `/api/json` | GET | Jenkins 전체 정보이다 |
| `/job/{name}/api/json` | GET | Job 정보이다 |
| `/job/{name}/build` | POST | 빌드 트리거이다 |
| `/job/{name}/buildWithParameters` | POST | 파라미터 빌드 트리거이다 |
| `/job/{name}/{number}/api/json` | GET | 특정 빌드 정보이다 |
| `/job/{name}/{number}/consoleText` | GET | 콘솔 출력이다 |
| `/job/{name}/lastBuild/api/json` | GET | 최근 빌드 정보이다 |
| `/queue/api/json` | GET | 빌드 큐 정보이다 |
| `/computer/api/json` | GET | Agent(Node) 정보이다 |
| `/crumbIssuer/api/json` | GET | CSRF Crumb 발급이다 |

```bash
# API Token으로 인증 (Crumb 불필요)
JENKINS_URL="http://localhost:30900"
USER="admin"
TOKEN="your-api-token"

# Job 목록 조회
curl -s -u ${USER}:${TOKEN} "${JENKINS_URL}/api/json?tree=jobs[name,color]" | jq

# 빌드 트리거
curl -X POST -u ${USER}:${TOKEN} \
  "${JENKINS_URL}/job/my-pipeline/build"

# 파라미터 빌드 트리거
curl -X POST -u ${USER}:${TOKEN} \
  "${JENKINS_URL}/job/my-pipeline/buildWithParameters" \
  --data-urlencode "BRANCH=develop" \
  --data-urlencode "ENVIRONMENT=staging"

# 빌드 상태 확인
curl -s -u ${USER}:${TOKEN} \
  "${JENKINS_URL}/job/my-pipeline/lastBuild/api/json?tree=result,duration,timestamp" | jq

# 빌드 큐 확인
curl -s -u ${USER}:${TOKEN} \
  "${JENKINS_URL}/queue/api/json?tree=items[task[name],why]" | jq

# 콘솔 출력 조회
curl -s -u ${USER}:${TOKEN} \
  "${JENKINS_URL}/job/my-pipeline/lastBuild/consoleText"
```

---

## Jenkins CLI

Jenkins CLI는 커맨드라인에서 Jenkins를 제어할 수 있는 도구이다.

```bash
# CLI JAR 다운로드
curl -o jenkins-cli.jar http://localhost:30900/jnlpJars/jenkins-cli.jar

# 기본 사용법
java -jar jenkins-cli.jar -s http://localhost:30900/ -auth admin:$TOKEN <command>

# 주요 명령어
java -jar jenkins-cli.jar -s http://localhost:30900/ -auth admin:$TOKEN help
java -jar jenkins-cli.jar -s http://localhost:30900/ -auth admin:$TOKEN list-jobs
java -jar jenkins-cli.jar -s http://localhost:30900/ -auth admin:$TOKEN build my-pipeline
java -jar jenkins-cli.jar -s http://localhost:30900/ -auth admin:$TOKEN console my-pipeline 42
java -jar jenkins-cli.jar -s http://localhost:30900/ -auth admin:$TOKEN install-plugin git
java -jar jenkins-cli.jar -s http://localhost:30900/ -auth admin:$TOKEN safe-restart
java -jar jenkins-cli.jar -s http://localhost:30900/ -auth admin:$TOKEN reload-configuration

# Groovy 스크립트 실행
echo 'println Jenkins.instance.pluginManager.plugins.collect{it.shortName}.sort()' | \
  java -jar jenkins-cli.jar -s http://localhost:30900/ -auth admin:$TOKEN groovy =
```

---

## Jenkins 베스트 프랙티스

### Pipeline 작성 규칙

| 규칙 | 설명 |
|------|------|
| Declarative 우선 | 가능하면 Declarative Pipeline을 사용한다. 복잡한 로직은 `script` 블록이나 Shared Library로 분리한다 |
| Controller 빌드 금지 | Controller에서 빌드를 실행하지 않는다. `numExecutors: 0`으로 설정한다 |
| Credential 안전 사용 | `withCredentials`와 작은따옴표 `sh`를 사용한다. GString으로 비밀을 보간하지 않는다 |
| 타임아웃 설정 | 모든 파이프라인에 `timeout`을 설정한다. 무한 대기를 방지한다 |
| 빌드 이력 관리 | `buildDiscarder`로 오래된 빌드를 자동 삭제한다 |
| 워크스페이스 정리 | `cleanWs()`로 빌드 후 워크스페이스를 정리한다 |
| Shallow Clone | `depth: 1`로 체크아웃하여 시간을 단축한다 |
| 병렬 실행 | 독립적인 Stage는 `parallel`로 실행한다 |
| `beforeAgent` | `when` 조건에 `beforeAgent true`를 설정하여 불필요한 Agent 할당을 방지한다 |
| Shared Library | 공통 로직은 Shared Library로 분리하여 재사용한다 |

### 보안 체크리스트

| 항목 | 확인 사항 |
|------|----------|
| 인증 | LDAP/SSO 연동, 로컬 계정 최소화 |
| 권한 | Role-Based Strategy, 최소 권한 원칙 적용 |
| Credential | Folder Scope 활용, Vault 연동 고려 |
| Agent 보안 | Agent-to-Controller Security 활성화 |
| CSRF | Crumb 발급 활성화 (기본 설정 유지) |
| Script Approval | 최소한의 승인, 정기적 검토 |
| 네트워크 | Jenkins URL에 HTTPS 적용, JNLP 포트 방화벽 제한 |
| 플러그인 | 정기적 업데이트, 미사용 플러그인 제거 |
| 감사 | Audit Trail 플러그인으로 변경 이력 추적 |
| 백업 | 정기적 백업, 복원 테스트 수행 |

### 운영 체크리스트

| 항목 | 주기 | 작업 |
|------|------|------|
| 플러그인 업데이트 | 주 1회 | 보안 패치 포함 플러그인 업데이트 |
| 백업 검증 | 월 1회 | 백업 복원 테스트 수행 |
| 디스크 정리 | 자동 (빌드당) | `buildDiscarder`, `cleanWs()` |
| 성능 모니터링 | 상시 | Prometheus + Grafana Dashboard |
| 보안 점검 | 분기 1회 | Credential 검토, 권한 점검, Script Approval 검토 |
| JVM 튜닝 | 필요 시 | GC 로그 분석, 힙 크기 조정 |
| Agent 관리 | 주 1회 | 오프라인 Agent 정리, 리소스 사용량 확인 |

---

## 자가 점검
- [ ] CI와 CD의 차이를 설명할 수 있는가?
- [ ] Controller(Master)와 Agent의 역할 차이를 설명할 수 있는가?
- [ ] JNLP 프로토콜과 Jenkins Remoting의 동작 원리를 이해하고 있는가?
- [ ] Declarative Pipeline과 Scripted Pipeline의 차이와 선택 기준을 설명할 수 있는가?
- [ ] Jenkinsfile의 구조 (pipeline, agent, stages, steps, post)를 설명할 수 있는가?
- [ ] agent 지시자의 옵션 (any, none, label, docker, kubernetes)을 구분할 수 있는가?
- [ ] post 조건 (always, success, failure, unstable, changed, cleanup)의 차이를 알고 있는가?
- [ ] environment, parameters, triggers, options 지시자의 용도를 설명할 수 있는가?
- [ ] when 지시자의 다양한 조건 (branch, expression, changeset, allOf, anyOf)을 활용할 수 있는가?
- [ ] `beforeAgent`와 `beforeInput`의 역할과 중요성을 이해하고 있는가?
- [ ] CPS Transformation의 원리와 @NonCPS 어노테이션의 사용 규칙을 알고 있는가?
- [ ] Groovy String Interpolation의 보안 위험과 안전한 Credential 사용법을 알고 있는가?
- [ ] Jenkins Kubernetes 플러그인의 동적 Agent Provisioning 라이프사이클을 설명할 수 있는가?
- [ ] PodTemplate에서 containers, volumes, serviceAccount, nodeSelector를 설정할 수 있는가?
- [ ] Shared Library의 vars/, src/, resources/ 디렉토리 구조와 `@Library` 어노테이션 사용법을 알고 있는가?
- [ ] Global Library와 Folder-Scoped Library의 차이를 설명할 수 있는가?
- [ ] Credential 타입 (Username/Password, SSH Key, Secret Text, Secret File)과 Scope를 구분할 수 있는가?
- [ ] `withCredentials` 스텝을 사용하여 파이프라인에서 Credential을 안전하게 사용할 수 있는가?
- [ ] HashiCorp Vault와 Kubernetes Secrets를 Jenkins Credential로 활용하는 방법을 알고 있는가?
- [ ] Multibranch Pipeline의 동작 방식과 `when { branch ... }` 조건을 활용할 수 있는가?
- [ ] Organization Folder의 용도와 설정 방법을 이해하고 있는가?
- [ ] `parallel` 스테이지와 `matrix` 빌드의 용도와 차이를 설명할 수 있는가?
- [ ] `input` 스텝을 활용한 Manual Approval 흐름을 구현할 수 있는가?
- [ ] Jenkins 보안 (RBAC, Script Approval, Agent-to-Controller Security)의 개념을 이해하고 있는가?
- [ ] Build Trigger 유형 (SCM Polling, Webhook, Cron, Upstream, Generic Webhook Trigger)을 구분할 수 있는가?
- [ ] Kaniko를 사용한 rootless 이미지 빌드 방법을 알고 있는가?
- [ ] JUnit 테스트 결과 수집과 Code Coverage 설정 방법을 알고 있는가?
- [ ] SonarQube Quality Gate를 파이프라인에 통합할 수 있는가?
- [ ] JVM 튜닝 (힙 크기, GC 설정)의 기본 원리를 이해하고 있는가?
- [ ] Pipeline 성능 최적화 기법 (병렬 실행, 캐싱, shallow clone, durability hint)을 알고 있는가?
- [ ] Jenkins Configuration as Code (JCasC)로 시스템 설정, Credential, Cloud를 관리할 수 있는가?
- [ ] Kubernetes 환경에서 Jenkins HA 전략을 설명할 수 있는가?
- [ ] Prometheus 메트릭과 Grafana Dashboard로 Jenkins를 모니터링할 수 있는가?
- [ ] Pipeline 디버깅 (Replay, Script Console, 환경 변수 확인) 방법을 알고 있는가?
- [ ] Agent 연결 문제, 플러그인 충돌, 메모리 문제를 트러블슈팅할 수 있는가?
- [ ] GitOps 패턴으로 Jenkins CI와 ArgoCD CD를 연동하는 방법을 이해하고 있는가?
- [ ] Jenkins REST API와 CLI를 사용하여 자동화 스크립트를 작성할 수 있는가?

---

## 참고문헌

### 공식 문서
- [Jenkins 공식 문서](https://www.jenkins.io/doc/) - 설치, 설정, 파이프라인 문법 등 전체 가이드
- [Jenkins Pipeline 문법 레퍼런스](https://www.jenkins.io/doc/book/pipeline/syntax/) - Declarative/Scripted Pipeline 전체 문법
- [Jenkins Pipeline Steps 레퍼런스](https://www.jenkins.io/doc/pipeline/steps/) - 사용 가능한 모든 Pipeline Step 목록
- [Jenkins 보안 가이드](https://www.jenkins.io/doc/book/security/) - 인증, 권한, Agent 보안 설정
- [Jenkins Configuration as Code (JCasC)](https://www.jenkins.io/projects/jcasc/) - YAML 기반 설정 관리
- [Jenkins Architecture](https://www.jenkins.io/doc/developer/architecture/) - Jenkins 내부 아키텍처 문서

### GitHub 리포지토리
- [jenkinsci/jenkins](https://github.com/jenkinsci/jenkins) - Jenkins 코어 소스코드
- [jenkinsci/kubernetes-plugin](https://github.com/jenkinsci/kubernetes-plugin) - Kubernetes 플러그인 소스코드 및 문서
- [jenkinsci/pipeline-examples](https://github.com/jenkinsci/pipeline-examples) - 공식 파이프라인 예제 모음
- [jenkinsci/configuration-as-code-plugin](https://github.com/jenkinsci/configuration-as-code-plugin) - JCasC 플러그인
- [jenkinsci/helm-charts](https://github.com/jenkinsci/helm-charts) - Jenkins Helm Chart
- [GoogleContainerTools/kaniko](https://github.com/GoogleContainerTools/kaniko) - Kaniko 이미지 빌더

### 플러그인
- [Kubernetes Plugin](https://plugins.jenkins.io/kubernetes/) - Kubernetes 동적 Agent 프로비저닝
- [Pipeline Plugin](https://plugins.jenkins.io/workflow-aggregator/) - Jenkins Pipeline 핵심 플러그인
- [Blue Ocean Plugin](https://plugins.jenkins.io/blueocean/) - 시각적 파이프라인 UI
- [Role-based Authorization Strategy Plugin](https://plugins.jenkins.io/role-strategy/) - RBAC 플러그인
- [Credentials Plugin](https://plugins.jenkins.io/credentials/) - Credential 관리 핵심 플러그인
- [Configuration as Code Plugin](https://plugins.jenkins.io/configuration-as-code/) - JCasC 플러그인
- [Generic Webhook Trigger Plugin](https://plugins.jenkins.io/generic-webhook-trigger/) - 범용 Webhook 트리거
- [Prometheus Metrics Plugin](https://plugins.jenkins.io/prometheus/) - Prometheus 메트릭 노출
- [HashiCorp Vault Plugin](https://plugins.jenkins.io/hashicorp-vault-plugin/) - Vault 연동
- [Kubernetes Credentials Provider](https://plugins.jenkins.io/kubernetes-credentials-provider/) - K8s Secret을 Credential로
- [Pipeline Utility Steps](https://plugins.jenkins.io/pipeline-utility-steps/) - readJSON, readYaml 등 유틸리티
- [JaCoCo Plugin](https://plugins.jenkins.io/jacoco/) - Java 코드 커버리지
- [SonarQube Scanner Plugin](https://plugins.jenkins.io/sonar/) - SonarQube 연동
- [Audit Trail Plugin](https://plugins.jenkins.io/audit-trail/) - 감사 로깅
- [ThinBackup Plugin](https://plugins.jenkins.io/thinBackup/) - 백업 자동화

### 추가 학습 자료
- [Jenkins Shared Libraries 가이드](https://www.jenkins.io/doc/book/pipeline/shared-libraries/) - Shared Library 설정 및 작성 방법
- [Jenkins Kubernetes Plugin 가이드](https://www.jenkins.io/doc/pipeline/steps/kubernetes/) - Kubernetes 플러그인 Pipeline Step 상세
- [Jenkinsfile 베스트 프랙티스](https://www.jenkins.io/doc/book/pipeline/pipeline-best-practices/) - Pipeline 작성 권장 사항
- [Jenkins Scalability 가이드](https://www.jenkins.io/doc/book/scaling/) - 대규모 Jenkins 운영 가이드
- [CPS 방식의 이해](https://www.jenkins.io/doc/book/pipeline/cps-method-mismatches/) - CPS 변환과 관련 문제 해결
- [Jenkins on Kubernetes 운영 가이드](https://www.jenkins.io/doc/book/installing/kubernetes/) - K8s 환경 설치 및 운영
