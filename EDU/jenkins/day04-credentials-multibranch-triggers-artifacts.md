# Day 4: Credentials, Multibranch, Triggers, Artifact, 테스트

Jenkins Credentials 관리, Multibranch Pipeline, Build Triggers 심화, Artifact 관리, 그리고 테스트 통합을 다룬다.

---

## Credentials 관리

### Credential 타입

| 타입 | 설명 | 사용 예 |
|------|------|--------|
| Username with Password | 사용자명과 비밀번호 쌍이다 | Docker Registry, Git HTTPS 인증 |
| SSH Username with Private Key | SSH 개인키이다 | Git SSH 클론, 원격 서버 접속 |
| Secret Text | 단일 비밀 문자열이다 | API Token, Slack Webhook URL |
| Secret File | 비밀 파일이다 | kubeconfig, service account JSON |
| Certificate | PKCS#12 인증서이다 | TLS 클라이언트 인증서 |
| Username with Password (Token) | Personal Access Token이다 | GitHub PAT, GitLab Token |

### Credential Scope

| Scope | 설명 |
|-------|------|
| Global | 모든 Jenkins 항목에서 사용할 수 있다 |
| System | Jenkins 시스템 자체에서만 사용한다 (예: 이메일 서버 인증). Pipeline에서는 사용할 수 없다 |
| Folder | 해당 Folder 하위 항목에서만 사용할 수 있다. 팀별 Credential 분리에 유용하다 |

### withCredentials 사용 예시

```groovy
pipeline {
    agent any
    stages {
        stage('Deploy') {
            steps {
                // Username + Password
                withCredentials([usernamePassword(
                    credentialsId: 'registry-creds',
                    usernameVariable: 'REG_USER',
                    passwordVariable: 'REG_PASS'
                )]) {
                    sh 'echo $REG_PASS | docker login -u $REG_USER --password-stdin'
                }

                // SSH Key
                withCredentials([sshUserPrivateKey(
                    credentialsId: 'git-ssh-key',
                    keyFileVariable: 'SSH_KEY',
                    usernameVariable: 'SSH_USER'
                )]) {
                    sh 'GIT_SSH_COMMAND="ssh -i $SSH_KEY" git clone git@github.com:org/repo.git'
                }

                // Secret Text
                withCredentials([string(
                    credentialsId: 'slack-token',
                    variable: 'SLACK_TOKEN'
                )]) {
                    sh 'curl -H "Authorization: Bearer $SLACK_TOKEN" https://slack.com/api/...'
                }

                // Secret File
                withCredentials([file(
                    credentialsId: 'kubeconfig',
                    variable: 'KUBECONFIG'
                )]) {
                    sh 'kubectl --kubeconfig=$KUBECONFIG get pods'
                }
            }
        }
    }
}
```

### Credential Provider 확장

Jenkins는 다양한 Credential Provider를 통해 외부 비밀 관리 시스템과 통합할 수 있다.

| Provider | 플러그인 | 설명 |
|----------|---------|------|
| Jenkins 내장 | credentials | `$JENKINS_HOME/credentials.xml`에 암호화 저장한다 |
| HashiCorp Vault | hashicorp-vault-plugin | Vault에서 동적으로 비밀을 가져온다 |
| AWS Secrets Manager | aws-secrets-manager-credentials-provider | AWS에서 비밀을 가져온다 |
| Azure Key Vault | azure-credentials | Azure Key Vault 연동이다 |
| Kubernetes Secrets | kubernetes-credentials-provider | K8s Secret을 Credential로 자동 등록한다 |
| CyberArk | conjur-credentials | CyberArk Conjur 연동이다 |

### HashiCorp Vault 연동

Vault 연동은 파이프라인에서 동적 시크릿을 사용할 때 유용하다.

```groovy
// 방법 1: Vault Plugin Step
pipeline {
    agent any
    stages {
        stage('Deploy') {
            steps {
                withVault(
                    configuration: [
                        vaultUrl: 'https://vault.example.com',
                        vaultCredentialId: 'vault-approle'
                    ],
                    vaultSecrets: [
                        [
                            path: 'secret/data/myapp',
                            engineVersion: 2,
                            secretValues: [
                                [envVar: 'DB_PASSWORD', vaultKey: 'db_password'],
                                [envVar: 'API_KEY', vaultKey: 'api_key']
                            ]
                        ]
                    ]
                ) {
                    sh 'echo "DB 접속 테스트..." && psql -h db.example.com -U admin'
                }
            }
        }
    }
}

// 방법 2: Vault Credential Provider (자동 동기화)
// Jenkins 설정에서 Vault를 Credential Provider로 등록하면
// Vault의 비밀이 Jenkins Credential로 자동 노출된다
// withCredentials로 일반 Credential처럼 사용할 수 있다
```

### Kubernetes Secrets as Credentials

tart-infra 프로젝트에서는 Kubernetes Secret을 Jenkins Credential로 활용할 수 있다. `kubernetes-credentials-provider` 플러그인을 사용하면 jenkins 네임스페이스의 Secret이 자동으로 Credential로 등록된다.

```yaml
# manifests/jenkins/credential-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: github-pat
  namespace: jenkins
  labels:
    "jenkins.io/credentials-type": "secretText"
  annotations:
    "jenkins.io/credentials-description": "GitHub Personal Access Token"
type: Opaque
stringData:
  text: "ghp_xxxxxxxxxxxxxxxxxxxx"

---
apiVersion: v1
kind: Secret
metadata:
  name: docker-registry
  namespace: jenkins
  labels:
    "jenkins.io/credentials-type": "usernamePassword"
  annotations:
    "jenkins.io/credentials-description": "Docker Registry Credentials"
type: Opaque
stringData:
  username: "myuser"
  password: "mypassword"

---
apiVersion: v1
kind: Secret
metadata:
  name: platform-kubeconfig
  namespace: jenkins
  labels:
    "jenkins.io/credentials-type": "secretFile"
  annotations:
    "jenkins.io/credentials-description": "Platform cluster kubeconfig"
type: Opaque
data:
  data: <base64-encoded-kubeconfig>
```

이렇게 하면 Jenkinsfile에서 `credentialsId: 'github-pat'`으로 바로 사용할 수 있다.

---

## Multibranch Pipeline

### 개요

Multibranch Pipeline은 Git 리포지토리의 각 브랜치에서 Jenkinsfile을 자동으로 발견하고, 브랜치별 파이프라인을 생성한다.

```
Git Repository
├── main          → Jenkinsfile 발견 → Pipeline 자동 생성
├── develop       → Jenkinsfile 발견 → Pipeline 자동 생성
├── feature/login → Jenkinsfile 발견 → Pipeline 자동 생성
└── hotfix/bug-1  → Jenkinsfile 없음 → Pipeline 미생성
```

### 동작 방식
1. **Branch Source**: Git 리포지토리를 스캔하여 브랜치 목록을 가져온다
2. **Jenkinsfile Discovery**: 각 브랜치에서 Jenkinsfile이 존재하는지 확인한다
3. **자동 빌드**: 새 브랜치가 발견되거나, 기존 브랜치에 변경이 있으면 빌드를 실행한다
4. **브랜치 삭제**: 브랜치가 삭제되면 해당 파이프라인도 자동으로 정리된다 (Orphaned Item Strategy)
5. **PR 빌드**: GitHub/GitLab Branch Source 플러그인과 연동하면 Pull Request 빌드도 자동화할 수 있다

```groovy
// Multibranch Pipeline에서 브랜치별 동작 분기
pipeline {
    agent any
    stages {
        stage('Build') {
            steps { sh 'make build' }
        }
        stage('Deploy to Dev') {
            when { branch 'develop' }
            steps { sh 'make deploy-dev' }
        }
        stage('Deploy to Staging') {
            when { branch 'release/*' }
            steps { sh 'make deploy-staging' }
        }
        stage('Deploy to Prod') {
            when {
                branch 'main'
                beforeInput true
            }
            steps { sh 'make deploy-prod' }
        }
    }
}
```

### Organization Folders

Organization Folder는 GitHub Organization이나 GitLab Group 전체를 스캔하여, 각 리포지토리의 Multibranch Pipeline을 자동으로 생성한다.

```
GitHub Organization: my-org
├── repo-a (Jenkinsfile 있음)  → Multibranch Pipeline 자동 생성
│   ├── main                  → Pipeline
│   ├── develop               → Pipeline
│   └── feature/login         → Pipeline
├── repo-b (Jenkinsfile 있음)  → Multibranch Pipeline 자동 생성
│   ├── main                  → Pipeline
│   └── feature/api           → Pipeline
└── repo-c (Jenkinsfile 없음)  → 무시
```

**설정 방법:**

```
New Item > Organization Folder
  GitHub Organization:
    API endpoint: https://api.github.com
    Credentials: github-pat
    Owner: my-org
  Scan Organization Folder Triggers:
    Periodically if not otherwise run: 1 hour
  Project Recognizers:
    Pipeline Jenkinsfile
    Script Path: Jenkinsfile
  Orphaned Item Strategy:
    Discard old items: true
    Days to keep: 30
    Max to keep: 100
```

---

## Blue Ocean vs Classic UI

| 항목 | Blue Ocean | Classic UI |
|------|-----------|------------|
| 파이프라인 시각화 | 그래프 형태로 Stage 흐름을 직관적으로 보여준다 | 목록 형태로 표시한다 |
| 파이프라인 에디터 | 시각적 에디터를 제공한다 (드래그 앤 드롭) | 텍스트 에디터만 제공한다 |
| Git 통합 | GitHub/Bitbucket 연동 마법사를 제공한다 | 수동으로 설정해야 한다 |
| 브랜치/PR | 브랜치별 빌드를 한눈에 볼 수 있다 | Multibranch 뷰에서 확인한다 |
| 프로젝트 현황 | 2022년 이후 유지보수 모드에 진입했다 | 지속적으로 개선되고 있다 |

> **참고**: Blue Ocean은 공식적으로 유지보수 모드이다. Jenkins 프로젝트에서는 Classic UI 개선에 집중하고 있으며, Pipeline Graph View 플러그인이 대안으로 부상하고 있다.

---

## Build Triggers 심화

### SCM Polling

SCM Polling은 Jenkins가 주기적으로 Git 리포지토리를 확인하여 변경이 있으면 빌드를 트리거하는 방식이다.

```groovy
triggers {
    // H는 해시 기반 분산을 의미한다. Job 이름의 해시로 분 단위를 결정한다
    // 이렇게 하면 동일 시각에 여러 Job이 동시에 SCM을 폴링하는 것을 방지한다
    pollSCM('H/5 * * * *')    // 약 5분마다 폴링
}
```

**SCM Polling의 한계:**
- 폴링 간격만큼의 지연이 발생한다
- Git 서버에 불필요한 부하를 준다
- 많은 Job이 동시에 폴링하면 성능 문제가 발생할 수 있다

### Webhook (추천)

Webhook은 Git 서버(GitHub, GitLab)에서 Push 이벤트가 발생할 때 Jenkins에 HTTP 요청을 보내는 방식이다. SCM Polling보다 즉각적이고 효율적이다.

**GitHub Webhook 설정:**

```
GitHub Repository > Settings > Webhooks > Add webhook
  Payload URL: http://<jenkins-url>/github-webhook/
  Content type: application/json
  Secret: <webhook-secret>
  Events: Just the push event (또는 필요한 이벤트 선택)
```

```groovy
// GitHub Webhook 기반 트리거
pipeline {
    agent any
    triggers {
        // GitHub Branch Source 플러그인이 설치되어 있으면 자동 감지된다
        githubPush()
    }
    stages {
        stage('Build') {
            steps { sh 'make build' }
        }
    }
}
```

### Generic Webhook Trigger

Generic Webhook Trigger 플러그인은 어떤 HTTP 요청이든 파이프라인 트리거로 사용할 수 있게 한다. ArgoCD, Kubernetes, 외부 시스템과의 연동에 유용하다.

```groovy
pipeline {
    agent any
    triggers {
        GenericTrigger(
            genericVariables: [
                [key: 'ACTION', value: '$.action'],
                [key: 'REPO_NAME', value: '$.repository.name'],
                [key: 'BRANCH', value: '$.ref', regexpFilter: 'refs/heads/'],
                [key: 'COMMIT_SHA', value: '$.after']
            ],
            causeString: 'Triggered by ${ACTION} on ${REPO_NAME}/${BRANCH}',
            token: 'my-pipeline-token',
            tokenCredentialId: '',
            printContributedVariables: true,
            printPostContent: true,
            silentResponse: false,
            regexpFilterText: '$BRANCH',
            regexpFilterExpression: '^(main|develop)$'
        )
    }
    stages {
        stage('Build') {
            steps {
                echo "Building ${REPO_NAME} branch ${BRANCH} at ${COMMIT_SHA}"
                sh 'make build'
            }
        }
    }
}
```

**Generic Webhook Trigger 호출 예시:**

```bash
# 외부에서 Jenkins Pipeline 트리거
curl -X POST \
  'http://<jenkins-url>/generic-webhook-trigger/invoke?token=my-pipeline-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "action": "push",
    "repository": {"name": "my-app"},
    "ref": "refs/heads/main",
    "after": "abc123"
  }'
```

### Cron 표현식 심화

Jenkins cron 표현식은 표준 Unix cron에 `H` (해시) 기능을 추가한 것이다.

```
┌───────────── 분 (0-59)
│ ┌───────────── 시 (0-23)
│ │ ┌───────────── 일 (1-31)
│ │ │ ┌───────────── 월 (1-12)
│ │ │ │ ┌───────────── 요일 (0-7, 0과 7이 일요일)
│ │ │ │ │
H * * * *
```

| 표현식 | 의미 |
|--------|------|
| `H/15 * * * *` | 약 15분마다 (해시 기반 분산) |
| `H 2 * * 1-5` | 평일 새벽 2시 (정확한 분은 해시로 결정) |
| `H H(0-3) * * *` | 0시~3시 사이 (해시로 시와 분 결정) |
| `H 8,12,18 * * 1-5` | 평일 8시, 12시, 18시 |
| `@hourly` | 매시 (H * * * * 와 동일) |
| `@daily` | 매일 (H H * * * 와 동일) |
| `@weekly` | 매주 (H H * * H 와 동일) |
| `@midnight` | 자정 (H H(0-2) * * * 와 동일) |

**`H`의 중요성:**

`H`를 사용하지 않고 `0 * * * *`으로 설정하면, 모든 Job이 정각에 동시에 실행되어 Jenkins에 부하가 집중된다. `H`는 Job 이름의 해시를 기반으로 실행 시각을 분산시켜 부하를 균등하게 분배한다.

### Upstream/Downstream 트리거

```groovy
// 상위 Job이 완료되면 자동으로 하위 Job을 트리거한다
pipeline {
    agent any
    triggers {
        upstream(
            upstreamProjects: 'build-job,test-job',
            threshold: hudson.model.Result.SUCCESS
        )
    }
    stages {
        stage('Deploy') {
            steps {
                echo '상위 Job이 성공하여 배포를 시작한다'
                sh 'make deploy'
            }
        }
    }
}

// 하위 Job을 직접 트리거하는 방법
pipeline {
    agent any
    stages {
        stage('Build') {
            steps { sh 'make build' }
        }
        stage('Trigger Downstream') {
            steps {
                // 다른 Job을 트리거한다
                build job: 'deploy-job',
                      parameters: [
                          string(name: 'VERSION', value: env.BUILD_NUMBER),
                          string(name: 'ENVIRONMENT', value: 'staging')
                      ],
                      wait: false  // 비동기 트리거 (완료 대기 안 함)
            }
        }
    }
}
```

---

## Artifact 관리

### Artifact 아카이빙과 핑거프린팅

Jenkins는 빌드 결과물(Artifact)을 아카이빙하고 핑거프린팅하여 추적할 수 있다.

```groovy
pipeline {
    agent any
    stages {
        stage('Build') {
            steps {
                sh 'mvn clean package'
            }
        }
    }
    post {
        success {
            // Artifact 아카이빙
            archiveArtifacts artifacts: '**/target/*.jar',
                             fingerprint: true,        // 핑거프린트 생성 (MD5 해시)
                             onlyIfSuccessful: true,   // 성공 시에만 아카이빙
                             allowEmptyArchive: false   // 아카이브 없으면 실패

            // 별도 핑거프린트 등록
            fingerprint '**/target/*.jar'
        }
    }
}
```

**핑거프린팅의 용도:**

핑거프린팅은 빌드 간 아티팩트 추적에 사용된다. 동일한 JAR 파일이 여러 Job에서 사용될 때, 핑거프린트를 통해 해당 아티팩트를 생성한 원본 빌드를 추적할 수 있다.

### Container Image 빌드 전략

Kubernetes 환경에서 Container Image를 빌드하는 방법은 여러 가지가 있다.

| 방법 | 보안 | 속도 | 설명 |
|------|------|------|------|
| Docker-in-Docker (DinD) | 낮다 (privileged 필요) | 빠르다 | Docker 데몬을 Pod 안에서 실행한다 |
| Docker Socket Mount | 낮다 (호스트 접근) | 빠르다 | 호스트의 Docker 소켓을 마운트한다 |
| Kaniko | 높다 (unprivileged) | 보통 | Google의 rootless 이미지 빌더이다 |
| Buildah | 높다 (unprivileged) | 보통 | Red Hat의 OCI 이미지 빌더이다 |

**Kaniko를 사용한 안전한 이미지 빌드 (권장):**

```groovy
pipeline {
    agent {
        kubernetes {
            yaml '''
                apiVersion: v1
                kind: Pod
                spec:
                  containers:
                    - name: kaniko
                      image: gcr.io/kaniko-project/executor:debug
                      command: ['sleep', 'infinity']
                      volumeMounts:
                        - name: docker-config
                          mountPath: /kaniko/.docker
                  volumes:
                    - name: docker-config
                      secret:
                        secretName: docker-registry-config
                        items:
                          - key: .dockerconfigjson
                            path: config.json
            '''
        }
    }
    stages {
        stage('Build & Push Image') {
            steps {
                container('kaniko') {
                    sh '''
                        /kaniko/executor \
                          --context=dir:///workspace \
                          --destination=registry.example.com/my-app:${BUILD_NUMBER} \
                          --destination=registry.example.com/my-app:latest \
                          --cache=true \
                          --cache-repo=registry.example.com/my-app/cache \
                          --snapshot-mode=redo \
                          --skip-unused-stages
                    '''
                }
            }
        }
    }
}
```

### Nexus/Artifactory 연동

엔터프라이즈 환경에서는 Nexus나 Artifactory를 Artifact Repository로 사용한다.

```groovy
// Nexus에 Maven 아티팩트 배포
pipeline {
    agent any
    stages {
        stage('Build') {
            steps {
                sh 'mvn clean package'
            }
        }
        stage('Upload to Nexus') {
            steps {
                nexusArtifactUploader(
                    nexusVersion: 'nexus3',
                    protocol: 'https',
                    nexusUrl: 'nexus.example.com',
                    groupId: 'com.example',
                    version: "${env.BUILD_NUMBER}",
                    repository: 'maven-releases',
                    credentialsId: 'nexus-creds',
                    artifacts: [
                        [
                            artifactId: 'my-app',
                            classifier: '',
                            file: 'target/my-app.jar',
                            type: 'jar'
                        ]
                    ]
                )
            }
        }
    }
}
```

---

## 테스트 통합

### JUnit 테스트 결과 수집

Jenkins는 JUnit XML 형식의 테스트 결과를 수집하여 시각화한다. 대부분의 테스트 프레임워크(JUnit, pytest, Jest, Go test 등)가 이 형식을 지원한다.

```groovy
pipeline {
    agent any
    stages {
        stage('Test') {
            steps {
                sh 'mvn test'
            }
            post {
                always {
                    // JUnit 테스트 결과 수집
                    junit testResults: '**/target/surefire-reports/*.xml',
                          allowEmptyResults: false,
                          skipPublishingChecks: false,  // GitHub Checks API 연동
                          healthScaleFactor: 1.0        // 빌드 건강도 가중치
                }
            }
        }
    }
}
```

**다양한 언어의 JUnit XML 생성:**

```groovy
pipeline {
    agent any
    stages {
        // Python (pytest)
        stage('Python Tests') {
            steps {
                sh 'pytest --junitxml=reports/python-results.xml'
            }
            post {
                always { junit 'reports/python-results.xml' }
            }
        }
        // JavaScript (Jest)
        stage('JS Tests') {
            steps {
                sh 'npx jest --ci --reporters=default --reporters=jest-junit'
            }
            post {
                always { junit 'junit.xml' }
            }
        }
        // Go
        stage('Go Tests') {
            steps {
                sh 'go test -v ./... 2>&1 | go-junit-report > reports/go-results.xml'
            }
            post {
                always { junit 'reports/go-results.xml' }
            }
        }
    }
}
```

### Code Coverage 수집

```groovy
pipeline {
    agent any
    stages {
        stage('Test with Coverage') {
            steps {
                sh 'mvn test jacoco:report'
            }
            post {
                always {
                    // JaCoCo 코드 커버리지 리포트
                    jacoco(
                        execPattern: '**/target/jacoco.exec',
                        classPattern: '**/target/classes',
                        sourcePattern: '**/src/main/java',
                        exclusionPattern: '**/test/**',
                        minimumLineCoverage: '80',      // 최소 80% 라인 커버리지
                        minimumBranchCoverage: '70',    // 최소 70% 브랜치 커버리지
                        changeBuildStatus: true          // 기준 미달 시 빌드 실패
                    )

                    // Cobertura 형식 (Python, JS 등)
                    cobertura coberturaReportFile: '**/coverage.xml',
                              conditionalCoverageTargets: '70, 0, 0',
                              lineCoverageTargets: '80, 0, 0',
                              failUnhealthy: true,
                              failUnstable: true
                }
            }
        }
    }
}
```

### SonarQube 연동

SonarQube는 코드 품질 분석 도구이다. Jenkins와 연동하면 빌드 시 자동으로 코드 분석을 수행하고, Quality Gate를 적용할 수 있다.

```groovy
pipeline {
    agent any
    environment {
        SONAR_TOKEN = credentials('sonarqube-token')
    }
    stages {
        stage('Build') {
            steps {
                sh 'mvn clean package'
            }
        }
        stage('SonarQube Analysis') {
            steps {
                withSonarQubeEnv('sonarqube-server') {
                    sh '''
                        mvn sonar:sonar \
                          -Dsonar.projectKey=my-app \
                          -Dsonar.projectName='My Application' \
                          -Dsonar.host.url=$SONAR_HOST_URL \
                          -Dsonar.token=$SONAR_TOKEN \
                          -Dsonar.qualitygate.wait=false
                    '''
                }
            }
        }
        stage('Quality Gate') {
            steps {
                // SonarQube Quality Gate 결과를 대기한다
                // webhook 설정이 필요하다 (SonarQube > Administration > Webhooks)
                timeout(time: 5, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }
    }
}
```

**Quality Gate 기준 예시:**

| 메트릭 | 기준 | 설명 |
|--------|------|------|
| Coverage | >= 80% | 신규 코드의 테스트 커버리지 |
| Duplicated Lines | <= 3% | 중복 코드 비율 |
| Maintainability Rating | A | 유지보수성 등급 |
| Reliability Rating | A | 신뢰성 등급 (버그 없음) |
| Security Rating | A | 보안 등급 (취약점 없음) |
| Security Hotspots Reviewed | 100% | 보안 핫스팟 검토 완료 |

---

