# Jenkins - CI 서버

## 개념

### Jenkins란?
- 오픈소스 자동화 서버로, CI/CD(Continuous Integration / Continuous Delivery) 파이프라인을 구축한다
- Java로 작성되었으며 (Java 11/17 지원), 1800+ 플러그인 생태계를 보유하고 있다
- Jenkinsfile로 파이프라인을 코드로 정의한다 (Pipeline as Code)
- Kubernetes 플러그인으로 동적 에이전트 Pod를 생성하여 빌드 리소스를 탄력적으로 운영할 수 있다
- 2004년 Hudson으로 시작하여 2011년 Jenkins로 분기되었으며, 현재 가장 널리 사용되는 CI 서버이다

### 핵심 개념
| 개념 | 설명 |
|------|------|
| Pipeline | 빌드-테스트-배포의 전체 워크플로우를 정의한다 |
| Jenkinsfile | 파이프라인을 코드로 정의하는 파일이다 (Groovy DSL) |
| Stage | 파이프라인의 논리적 단계 (Build, Test, Deploy 등)이다 |
| Step | Stage 내의 개별 작업 단위이다 |
| Agent | 파이프라인을 실행하는 워커이다 |
| Node | Jenkins 에이전트가 실행되는 서버이다 |
| Credential | 비밀번호, 토큰 등을 안전하게 관리하는 저장소이다 |
| Shared Library | 여러 파이프라인에서 공유하는 재사용 가능한 Groovy 코드이다 |
| Multibranch Pipeline | Git 브랜치별로 자동으로 파이프라인을 생성하는 프로젝트 타입이다 |

---

### 이 프로젝트에서의 실습 환경

이 프로젝트에서 Jenkins는 platform 클러스터의 `jenkins` 네임스페이스에 배포된다.

- 설치 스크립트: `scripts/install/08-install-cicd.sh`
- Helm Chart: `jenkins/jenkins`
- NodePort: 30900
- 기본 계정: admin (비밀번호는 Secret에서 조회)
- 파이프라인 예제: `manifests/jenkins/demo-pipeline.yaml`
- PVC: 5Gi (작업 공간 영속성)
- 실습 대상 클러스터: platform (`kubeconfig/platform.yaml`)

```bash
# platform 클러스터에서 Jenkins 접근
export KUBECONFIG=kubeconfig/platform.yaml
# admin 비밀번호 조회
kubectl get secret jenkins -n jenkins -o jsonpath='{.data.jenkins-admin-password}' | base64 -d; echo
# 브라우저에서 http://<platform-worker-ip>:30900 접속
```

---

## 아키텍처

### Controller(Master)와 Agent

Jenkins는 분산 빌드 아키텍처를 채택하고 있다. Controller(과거 명칭 Master)가 중앙 관리 역할을 하고, Agent가 실제 빌드를 수행한다.

```
┌─────────────────────────────────────────────────────────┐
│              Jenkins Controller (Master)                │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Scheduling  │  │  Web UI /    │  │  Plugin      │   │
│  │  & Queue     │  │  REST API    │  │  Management  │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Credential  │  │  Build Log   │  │  SCM Polling │   │
│  │  Store       │  │  Storage     │  │  & Triggers  │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└───────────┬──────────────┬──────────────┬───────────────┘
            │ JNLP/SSH     │ JNLP/SSH     │ JNLP/SSH
    ┌───────▼──────┐ ┌─────▼────────┐ ┌───▼────────────┐
    │  Agent 1     │ │  Agent 2     │ │  Agent 3       │
    │  (Linux)     │ │  (Windows)   │ │  (K8s Pod)     │
    │  ┌────────┐  │ │  ┌────────┐  │ │  ┌────────┐    │
    │  │Executor│  │ │  │Executor│  │ │  │Executor│    │
    │  │(빌드)  │  │ │  │(빌드)  │  │ │  │(빌드)  │    │
    │  └────────┘  │ │  └────────┘  │ │  └────────┘    │
    └──────────────┘ └──────────────┘ └────────────────┘
```

**Controller의 역할:**
- 빌드 작업 스케줄링 및 큐 관리를 담당한다
- 웹 UI와 REST API를 제공한다
- 플러그인, Credential, 빌드 로그를 관리한다
- Controller 자체에서도 빌드를 실행할 수 있지만, 보안과 성능상 Agent에 위임하는 것을 권장한다

**Agent의 역할:**
- Controller로부터 빌드 작업을 할당받아 실행한다
- Executor 슬롯 수만큼 동시 빌드가 가능하다
- SSH 또는 JNLP(Java Network Launch Protocol) 프로토콜로 Controller와 통신한다

**JNLP와 Remoting:**
- Jenkins Remoting은 Controller-Agent 간 통신 프레임워크이다
- JNLP Agent는 Agent 쪽에서 Controller로 연결을 개시하므로, 방화벽 뒤의 Agent도 연결할 수 있다
- TCP 포트(기본 50000)를 통해 양방향 채널을 형성한다
- Kubernetes 환경에서는 JNLP 컨테이너가 Agent Pod에 자동으로 포함된다

---

## Pipeline 유형

### Declarative vs Scripted Pipeline

Jenkins Pipeline은 두 가지 문법을 제공한다. Declarative Pipeline이 권장 방식이다.

| 항목 | Declarative Pipeline | Scripted Pipeline |
|------|---------------------|-------------------|
| 문법 | 구조화된 DSL (`pipeline { }`) | 자유로운 Groovy 코드 (`node { }`) |
| 학습 난이도 | 낮다 | 높다 (Groovy 지식 필요) |
| 유효성 검사 | 실행 전 구문 검사가 가능하다 | 불가능하다 (런타임에만 오류 발견) |
| 유연성 | 정해진 구조 안에서 작성한다 | 완전히 자유로운 로직 구성이 가능하다 |
| `script` 블록 | Scripted 코드 삽입이 가능하다 | 해당 없다 |
| Blue Ocean | 완전 지원한다 | 제한적이다 |
| 권장 상황 | 대부분의 CI/CD 파이프라인 | 복잡한 조건 분기, 동적 Stage 생성이 필요할 때 |

```groovy
// Declarative Pipeline (권장)
pipeline {
    agent any
    stages {
        stage('Build') {
            steps {
                sh 'make build'
            }
        }
    }
}

// Scripted Pipeline
node {
    stage('Build') {
        sh 'make build'
    }
}
```

---

## Declarative Pipeline 문법 상세

### agent 지시자

`agent`는 파이프라인 또는 Stage가 어디에서 실행될지를 결정한다.

| agent 옵션 | 설명 |
|------------|------|
| `any` | 사용 가능한 아무 Agent에서 실행한다 |
| `none` | 최상위에서 Agent를 지정하지 않는다. 각 Stage에서 개별 지정해야 한다 |
| `label 'name'` | 지정된 Label을 가진 Agent에서 실행한다 |
| `docker { image 'node:18' }` | Docker 컨테이너 안에서 실행한다 |
| `kubernetes { yaml '...' }` | Kubernetes Pod를 동적으로 생성하여 실행한다 |

```groovy
// Stage별 다른 Agent 사용 예시
pipeline {
    agent none
    stages {
        stage('Build') {
            agent { docker { image 'maven:3.9' } }
            steps { sh 'mvn package' }
        }
        stage('Test') {
            agent { label 'linux' }
            steps { sh './run-tests.sh' }
        }
        stage('Deploy') {
            agent {
                kubernetes {
                    yaml '''
                        apiVersion: v1
                        kind: Pod
                        spec:
                          containers:
                            - name: kubectl
                              image: bitnami/kubectl:latest
                              command: ['sleep', 'infinity']
                    '''
                }
            }
            steps {
                container('kubectl') {
                    sh 'kubectl apply -f manifests/'
                }
            }
        }
    }
}
```

### post 조건

`post` 블록은 파이프라인 또는 Stage 완료 후 실행되는 후처리 로직을 정의한다.

| 조건 | 실행 시점 |
|------|----------|
| `always` | 결과에 관계없이 항상 실행한다 |
| `success` | 파이프라인이 성공했을 때만 실행한다 |
| `failure` | 파이프라인이 실패했을 때만 실행한다 |
| `unstable` | 테스트 실패 등으로 불안정 상태일 때 실행한다 |
| `changed` | 이전 빌드와 결과가 달라졌을 때 실행한다 |
| `cleanup` | 모든 post 조건 실행 후 최종적으로 실행한다 (리소스 정리 용도) |

```groovy
post {
    always {
        junit '**/target/surefire-reports/*.xml'    // 테스트 리포트 수집
        archiveArtifacts artifacts: '**/target/*.jar'
    }
    success {
        slackSend channel: '#builds', message: "빌드 성공: ${env.JOB_NAME} #${env.BUILD_NUMBER}"
    }
    failure {
        slackSend channel: '#builds', color: 'danger',
                  message: "빌드 실패: ${env.JOB_NAME} #${env.BUILD_NUMBER}"
    }
    unstable {
        echo '테스트 일부 실패 - 불안정 상태이다'
    }
    changed {
        echo '이전 빌드와 결과가 달라졌다'
    }
    cleanup {
        cleanWs()  // 워크스페이스 정리
    }
}
```

### environment 지시자

환경 변수를 선언한다. `credentials()` 헬퍼로 Credential을 환경 변수로 바인딩할 수 있다.

```groovy
pipeline {
    agent any
    environment {
        REGISTRY = 'registry.example.com'
        APP_NAME = 'my-app'
        DOCKER_CREDS = credentials('docker-registry-creds')  // USERNAME과 PASSWORD 자동 분리
        // DOCKER_CREDS_USR, DOCKER_CREDS_PSW 변수가 자동 생성된다
    }
    stages {
        stage('Build') {
            environment {
                // Stage 레벨 환경 변수 (이 Stage에서만 유효하다)
                DEBUG = 'true'
            }
            steps {
                sh 'echo "Building ${APP_NAME} for ${REGISTRY}"'
            }
        }
    }
}
```

### parameters 지시자

파이프라인 실행 시 사용자 입력 파라미터를 정의한다. 첫 실행 후 "Build with Parameters" 옵션이 나타난다.

```groovy
pipeline {
    agent any
    parameters {
        string(name: 'BRANCH', defaultValue: 'main', description: '빌드할 브랜치')
        choice(name: 'ENVIRONMENT', choices: ['dev', 'staging', 'prod'], description: '배포 환경')
        booleanParam(name: 'RUN_TESTS', defaultValue: true, description: '테스트 실행 여부')
        password(name: 'API_KEY', description: 'API 키 입력')
    }
    stages {
        stage('Deploy') {
            when {
                expression { params.ENVIRONMENT == 'prod' }
            }
            steps {
                echo "Production 배포: ${params.BRANCH}"
            }
        }
    }
}
```

### triggers 지시자

파이프라인 자동 실행 트리거를 정의한다.

| 트리거 | 설명 |
|--------|------|
| `cron('H/15 * * * *')` | cron 표현식에 따라 주기적으로 실행한다. `H`는 해시 기반 분산을 의미한다 |
| `pollSCM('H/5 * * * *')` | 주기적으로 SCM(Git)을 폴링하여 변경이 있으면 실행한다 |
| `upstream(upstreamProjects: 'job-a', threshold: hudson.model.Result.SUCCESS)` | 지정된 상위 Job이 성공하면 실행한다 |

```groovy
pipeline {
    agent any
    triggers {
        pollSCM('H/5 * * * *')  // 5분마다 Git 변경 감지
        cron('H 2 * * 1-5')      // 평일 새벽 2시에 정기 빌드
    }
    stages {
        stage('Build') {
            steps { sh 'make build' }
        }
    }
}
```

### options 지시자

파이프라인의 동작 옵션을 설정한다.

```groovy
pipeline {
    agent any
    options {
        timeout(time: 30, unit: 'MINUTES')    // 전체 파이프라인 타임아웃
        retry(3)                               // 실패 시 최대 3회 재시도
        timestamps()                           // 로그에 타임스탬프 추가
        disableConcurrentBuilds()              // 동시 빌드 방지
        buildDiscarder(logRotator(             // 빌드 이력 관리
            numToKeepStr: '10',
            daysToKeepStr: '30'
        ))
        skipDefaultCheckout()                  // 기본 SCM Checkout 비활성화
    }
    stages {
        stage('Build') {
            options {
                timeout(time: 10, unit: 'MINUTES')  // Stage 레벨 타임아웃
            }
            steps { sh 'make build' }
        }
    }
}
```

---

## Kubernetes 플러그인 상세

### PodTemplate 정의

Kubernetes 플러그인은 빌드 시 동적으로 Pod를 생성한다. PodTemplate에서 컨테이너, 볼륨, 리소스 등을 상세하게 정의할 수 있다.

```groovy
pipeline {
    agent {
        kubernetes {
            yaml '''
                apiVersion: v1
                kind: Pod
                metadata:
                  labels:
                    jenkins: agent
                spec:
                  serviceAccountName: jenkins-agent
                  nodeSelector:
                    role: ci
                  tolerations:
                    - key: "ci"
                      operator: "Equal"
                      value: "true"
                      effect: "NoSchedule"
                  containers:
                    - name: jnlp
                      image: jenkins/inbound-agent:latest
                      resources:
                        requests:
                          cpu: 200m
                          memory: 256Mi
                        limits:
                          cpu: 500m
                          memory: 512Mi
                    - name: docker
                      image: docker:dind
                      securityContext:
                        privileged: true
                      volumeMounts:
                        - name: docker-sock
                          mountPath: /var/run/docker.sock
                    - name: maven
                      image: maven:3.9-eclipse-temurin-17
                      command: ['sleep', 'infinity']
                      resources:
                        requests:
                          cpu: 500m
                          memory: 1Gi
                        limits:
                          cpu: '2'
                          memory: 2Gi
                  volumes:
                    - name: docker-sock
                      hostPath:
                        path: /var/run/docker.sock
                    - name: maven-cache
                      persistentVolumeClaim:
                        claimName: maven-repo-pvc
            '''
        }
    }
    stages {
        stage('Build') {
            steps {
                container('maven') {
                    sh 'mvn clean package -DskipTests'
                }
            }
        }
        stage('Docker Build') {
            steps {
                container('docker') {
                    sh 'docker build -t my-app:${BUILD_NUMBER} .'
                }
            }
        }
    }
}
```

### 동적 Agent Provisioning 라이프사이클

```
빌드 요청 (Trigger)
     │
     ▼
┌─────────────────────────┐
│ 1. Controller 큐에 등록  │  Jenkins Controller가 빌드 큐에 작업을 추가한다
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 2. PodTemplate 해석     │  Jenkinsfile의 kubernetes agent 블록을 파싱한다
│    Pod Spec 생성        │  JNLP 컨테이너가 없으면 자동으로 추가한다
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 3. K8s API로 Pod 생성   │  Kubernetes API를 호출하여 Agent Pod를 생성한다
│    kubectl create pod   │  nodeSelector, tolerations 등이 적용된다
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 4. JNLP 연결 수립       │  JNLP 컨테이너가 Controller의 50000 포트로 연결한다
│    Agent 등록           │  연결이 성공하면 Agent가 온라인 상태가 된다
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 5. 빌드 실행            │  container() 스텝으로 지정된 컨테이너에서 명령을 실행한다
│    container('name')    │  워크스페이스는 모든 컨테이너가 공유한다
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 6. Pod 삭제             │  빌드 완료 후 Pod가 자동으로 삭제된다
│    리소스 반환           │  podRetention 정책에 따라 동작이 달라질 수 있다
└─────────────────────────┘
```

### Pod Retention 정책

| 정책 | 설명 |
|------|------|
| `Never` | 빌드 완료 후 항상 Pod를 삭제한다 (기본값) |
| `OnFailure` | 빌드 실패 시 Pod를 유지한다 (디버깅 목적) |
| `Always` | 빌드 완료 후에도 Pod를 유지한다 |
| `Default` | Kubernetes 플러그인 전역 설정을 따른다 |

```groovy
agent {
    kubernetes {
        podRetention onFailure()    // 실패 시 Pod 유지
        activeDeadlineSeconds 3600  // 최대 1시간 실행
        idleMinutes 10              // 유휴 시간 10분 후 삭제
        yaml '...'
    }
}
```

### 이 프로젝트의 Jenkins 파이프라인 (7단계)
```
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│1. Clone │→ │2. Build │→ │3. Unit  │→ │4. Lint  │
│  Git    │  │ Docker  │  │  Test   │  │  Code   │
└─────────┘  └─────────┘  └─────────┘  └─────────┘
                                             │
┌─────────┐  ┌─────────┐  ┌─────────┐       │
│7. Notify│← │6. Push  │← │5. Scan  │← ─────┘
│ Slack   │  │ Registry│  │Security │
└─────────┘  └─────────┘  └─────────┘
```

---

## Shared Libraries

### 개요

Shared Library는 여러 파이프라인에서 공유하는 재사용 가능한 Groovy 코드이다. 코드 중복을 제거하고 표준 파이프라인 패턴을 조직 전체에 적용할 수 있다.

### 디렉토리 구조

```
(root)
├── vars/                    # 전역 변수 및 함수 (Pipeline에서 직접 호출 가능)
│   ├── buildDocker.groovy   # buildDocker() 함수로 호출
│   ├── deployToK8s.groovy   # deployToK8s() 함수로 호출
│   └── notifySlack.groovy   # notifySlack() 함수로 호출
├── src/                     # Groovy 클래스 (OOP 스타일 코드)
│   └── com/
│       └── example/
│           └── Pipeline.groovy
├── resources/               # 비Groovy 리소스 파일 (JSON, YAML, 셸 스크립트 등)
│   └── com/
│       └── example/
│           └── config.yaml
└── README.md
```

### 사용 방법

```groovy
// 1. 암묵적 로딩 (Jenkins 시스템 설정에서 등록된 경우)
@Library('my-shared-library') _

// 2. 명시적 로딩 (특정 버전 지정)
@Library('my-shared-library@v2.1.0') _

// 3. 여러 라이브러리 동시 로딩
@Library(['lib-a@main', 'lib-b@v1.0']) _

pipeline {
    agent any
    stages {
        stage('Build') {
            steps {
                // vars/buildDocker.groovy의 call() 메서드가 호출된다
                buildDocker(image: 'my-app', tag: env.BUILD_NUMBER)
            }
        }
        stage('Notify') {
            steps {
                notifySlack(channel: '#builds', status: currentBuild.result)
            }
        }
    }
}
```

### vars/ 파일 작성 예시

```groovy
// vars/buildDocker.groovy
def call(Map config = [:]) {
    def image = config.image ?: error("image 파라미터가 필요하다")
    def tag = config.tag ?: 'latest'
    def registry = config.registry ?: 'registry.example.com'

    sh "docker build -t ${registry}/${image}:${tag} ."
    sh "docker push ${registry}/${image}:${tag}"
}
```

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

## 보안

### RBAC (Role-Based Access Control)

Jenkins는 기본적으로 Matrix Authorization Strategy 플러그인과 Role-based Authorization Strategy 플러그인을 통해 세밀한 권한 관리를 제공한다.

| 권한 레벨 | 설명 |
|-----------|------|
| Overall/Administer | Jenkins 전체 관리 권한이다 |
| Job/Build | 빌드 실행 권한이다 |
| Job/Configure | Job 설정 변경 권한이다 |
| Job/Read | Job 조회 권한이다 |
| Credentials/View | Credential 조회 권한이다 |

### Script Approval

Groovy Sandbox 외부에서 실행되는 스크립트는 관리자의 승인이 필요하다. `Manage Jenkins > In-process Script Approval`에서 대기 중인 스크립트를 확인하고 승인할 수 있다.

```groovy
// Sandbox 안에서 허용되지 않는 코드 예시 (승인 필요)
@NonCPS
def parseJson(text) {
    new groovy.json.JsonSlurper().parseText(text)
}
```

### Agent-to-Controller Security

Jenkins 2.x부터 Agent에서 Controller의 파일 시스템에 접근하는 것을 기본적으로 차단한다. `Manage Jenkins > Security > Agent → Controller Security`에서 화이트리스트를 관리할 수 있다. Agent가 실행하는 코드를 신뢰할 수 없는 경우 반드시 이 설정을 유지해야 한다.

---

## 실습

### 실습 1: Jenkins 접속
```bash
# Jenkins 포트포워딩
kubectl port-forward -n jenkins svc/jenkins 8080:8080

# 초기 비밀번호 확인
kubectl exec -n jenkins deploy/jenkins -- cat /var/jenkins_home/secrets/initialAdminPassword

# 브라우저에서 http://localhost:8080 접속
```

### 실습 2: 파이프라인 생성
```
1. New Item > Pipeline 선택
2. Pipeline 섹션에서 "Pipeline script" 선택
3. Jenkinsfile 내용 입력
4. Build Now 클릭
5. Console Output에서 실행 로그 확인
```

### 실습 3: Jenkins 설정 확인
```bash
# Jenkins Pod 확인
kubectl get pods -n jenkins

# Jenkins 설정 확인
kubectl get cm -n jenkins

# Jenkins Credential 확인 (이름만)
kubectl exec -n jenkins deploy/jenkins -- ls /var/jenkins_home/credentials.xml

# 프로젝트 Jenkins 설정 확인
cat ../../manifests/helm-values/jenkins-values.yaml
```

### 실습 4: 파이프라인 실행 모니터링
```
1. Pipeline Graph View 플러그인 또는 Blue Ocean 플러그인으로 시각적 파이프라인 뷰 확인
2. Console Output에서 각 Stage 로그 확인
3. Build History에서 이전 빌드 결과 비교
```

### 실습 5: Multibranch Pipeline 생성
```
1. New Item > Multibranch Pipeline 선택
2. Branch Sources에서 Git 리포지토리 URL 입력
3. Jenkinsfile 경로를 지정 (기본값: Jenkinsfile)
4. Scan Multibranch Pipeline Now를 클릭하여 브랜치 스캔
5. 각 브랜치별 빌드 결과를 확인
```

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
- [ ] Jenkins Kubernetes 플러그인의 동적 Agent Provisioning 라이프사이클을 설명할 수 있는가?
- [ ] PodTemplate에서 containers, volumes, serviceAccount, nodeSelector를 설정할 수 있는가?
- [ ] Shared Library의 vars/와 src/ 디렉토리 구조와 `@Library` 어노테이션 사용법을 알고 있는가?
- [ ] Credential 타입 (Username/Password, SSH Key, Secret Text, Secret File)과 Scope를 구분할 수 있는가?
- [ ] `withCredentials` 스텝을 사용하여 파이프라인에서 Credential을 안전하게 사용할 수 있는가?
- [ ] Multibranch Pipeline의 동작 방식과 `when { branch ... }` 조건을 활용할 수 있는가?
- [ ] `parallel` 스테이지와 `matrix` 빌드의 용도와 차이를 설명할 수 있는가?
- [ ] `input` 스텝을 활용한 Manual Approval 흐름을 구현할 수 있는가?
- [ ] Jenkins 보안 (RBAC, Script Approval, Agent-to-Controller Security)의 개념을 이해하고 있는가?

---

## 참고문헌

### 공식 문서
- [Jenkins 공식 문서](https://www.jenkins.io/doc/) - 설치, 설정, 파이프라인 문법 등 전체 가이드
- [Jenkins Pipeline 문법 레퍼런스](https://www.jenkins.io/doc/book/pipeline/syntax/) - Declarative/Scripted Pipeline 전체 문법
- [Jenkins Pipeline Steps 레퍼런스](https://www.jenkins.io/doc/pipeline/steps/) - 사용 가능한 모든 Pipeline Step 목록
- [Jenkins 보안 가이드](https://www.jenkins.io/doc/book/security/) - 인증, 권한, Agent 보안 설정

### GitHub 리포지토리
- [jenkinsci/jenkins](https://github.com/jenkinsci/jenkins) - Jenkins 코어 소스코드
- [jenkinsci/kubernetes-plugin](https://github.com/jenkinsci/kubernetes-plugin) - Kubernetes 플러그인 소스코드 및 문서
- [jenkinsci/pipeline-examples](https://github.com/jenkinsci/pipeline-examples) - 공식 파이프라인 예제 모음

### 플러그인
- [Kubernetes Plugin](https://plugins.jenkins.io/kubernetes/) - Kubernetes 동적 Agent 프로비저닝
- [Pipeline Plugin](https://plugins.jenkins.io/workflow-aggregator/) - Jenkins Pipeline 핵심 플러그인
- [Blue Ocean Plugin](https://plugins.jenkins.io/blueocean/) - 시각적 파이프라인 UI
- [Role-based Authorization Strategy Plugin](https://plugins.jenkins.io/role-strategy/) - RBAC 플러그인
- [Credentials Plugin](https://plugins.jenkins.io/credentials/) - Credential 관리 핵심 플러그인

### 추가 학습 자료
- [Jenkins Shared Libraries 가이드](https://www.jenkins.io/doc/book/pipeline/shared-libraries/) - Shared Library 설정 및 작성 방법
- [Jenkins Kubernetes Plugin 가이드](https://www.jenkins.io/doc/pipeline/steps/kubernetes/) - Kubernetes 플러그인 Pipeline Step 상세
- [Jenkinsfile 베스트 프랙티스](https://www.jenkins.io/doc/book/pipeline/pipeline-best-practices/) - Pipeline 작성 권장 사항
