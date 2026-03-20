# Day 2: Pipeline과 Groovy

Jenkins Pipeline 유형(Scripted vs Declarative), Declarative Pipeline 문법 상세, 그리고 Groovy 언어 심화를 다룬다.

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

### Pipeline 내부 실행 엔진

Pipeline은 내부적으로 Groovy CPS(Continuation-Passing Style) 인터프리터에 의해 실행된다. 이 엔진은 파이프라인 실행 상태를 직렬화하여 Jenkins 재시작 후에도 파이프라인을 이어서 실행할 수 있게 한다.

```
Jenkinsfile (Groovy DSL)
     │
     ▼
┌─────────────────────┐
│  Groovy Compiler    │  Jenkinsfile을 Groovy AST로 파싱한다
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  CPS Transformer    │  AST를 CPS 형태로 변환한다
│  (workflow-cps)     │  모든 메서드 호출이 Continuation으로 래핑된다
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  CPS VM Thread      │  CPS 변환된 코드를 실행한다
│                     │  각 스텝 사이에 실행 상태를 직렬화한다
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  FlowNode Graph     │  실행 흐름을 DAG(Directed Acyclic Graph)로 기록한다
│                     │  Stage, Step, 병렬 실행이 모두 노드로 표현된다
└─────────────────────┘
```

**CPS 변환이 필요한 이유:**

일반 Groovy 코드는 JVM 스레드에서 실행되므로, 중간에 Jenkins가 재시작되면 실행 상태가 소실된다. CPS 변환은 실행 흐름을 "continuation"으로 분해하여, 각 스텝 실행 후 상태를 디스크에 저장한다. Jenkins가 재시작되면 마지막 저장된 상태에서 실행을 재개한다.

```groovy
// 원본 코드
def result = sh(returnStdout: true, script: 'echo hello')
echo result

// CPS 변환 후 (개념적 표현)
sh(returnStdout: true, script: 'echo hello', continuation: { result ->
    serialize_state()  // 상태 저장
    echo(result, continuation: {
        serialize_state()  // 상태 저장
        // 다음 스텝으로 이동
    })
})
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

### when 지시자 심화

`when` 지시자는 Stage의 실행 조건을 정의한다. 조건이 충족되지 않으면 해당 Stage는 건너뛴다.

| 조건 | 설명 | 예시 |
|------|------|------|
| `branch` | 현재 브랜치 이름과 매칭한다 | `when { branch 'main' }` |
| `buildingTag` | 태그 빌드인지 확인한다 | `when { buildingTag() }` |
| `tag` | 태그 패턴과 매칭한다 | `when { tag 'v*' }` |
| `environment` | 환경 변수 값을 확인한다 | `when { environment name: 'ENV', value: 'prod' }` |
| `expression` | Groovy 표현식을 평가한다 | `when { expression { return params.RUN_TESTS } }` |
| `not` | 조건을 부정한다 | `when { not { branch 'main' } }` |
| `allOf` | 모든 조건이 참이어야 한다 | `when { allOf { branch 'main'; environment name: 'DEPLOY', value: 'true' } }` |
| `anyOf` | 하나라도 참이면 된다 | `when { anyOf { branch 'main'; branch 'develop' } }` |
| `changeset` | 변경된 파일 경로를 매칭한다 | `when { changeset '**/*.java' }` |
| `changelog` | 커밋 메시지 패턴을 매칭한다 | `when { changelog '.*\\[ci skip\\].*' }` |
| `triggeredBy` | 빌드 트리거 유형을 확인한다 | `when { triggeredBy 'TimerTrigger' }` |

```groovy
pipeline {
    agent any
    stages {
        stage('Build') {
            steps { sh 'make build' }
        }
        stage('Deploy to Dev') {
            when {
                branch 'develop'
                changeset 'src/**'  // src/ 디렉토리에 변경이 있을 때만
            }
            steps { sh 'make deploy-dev' }
        }
        stage('Deploy to Prod') {
            when {
                allOf {
                    branch 'main'
                    expression { currentBuild.resultIsBetterOrEqualTo('SUCCESS') }
                    not { changelog '.*\\[skip deploy\\].*' }
                }
                beforeAgent true    // Agent 할당 전에 조건 평가 (리소스 절약)
                beforeInput true    // input 전에 조건 평가
            }
            input {
                message '프로덕션 배포를 승인하시겠습니까?'
                ok '승인'
                submitter 'admin,deploy-team'
            }
            steps { sh 'make deploy-prod' }
        }
    }
}
```

**`beforeAgent`와 `beforeInput`의 중요성:**

`beforeAgent true`를 설정하면, 조건 평가를 Agent 할당 전에 수행한다. 이렇게 하면 조건이 충족되지 않는 Stage에서 불필요하게 Agent를 할당하지 않아 리소스를 절약할 수 있다. 특히 Kubernetes Agent를 사용할 때는 Pod 생성 비용이 크므로, `beforeAgent true` 설정이 권장된다.

---

## Groovy in Jenkins 심화

### CPS Transformation 이해

Jenkins Pipeline은 Groovy 코드를 CPS(Continuation-Passing Style)로 변환하여 실행한다. 이 변환은 파이프라인의 내구성(durability)을 보장하지만, 몇 가지 제약사항을 발생시킨다.

**CPS에서 직렬화 불가능한 객체 문제:**

```groovy
// 문제: java.io.NotSerializableException 발생
pipeline {
    agent any
    stages {
        stage('Parse') {
            steps {
                script {
                    // JsonSlurper의 반환 객체는 직렬화 불가능하다
                    def json = new groovy.json.JsonSlurper().parseText('{"key": "value"}')
                    echo json.key  // CPS checkpoint에서 json 직렬화 시도 → 실패
                }
            }
        }
    }
}
```

**해결 방법 1 - @NonCPS 어노테이션:**

```groovy
// @NonCPS 메서드는 CPS 변환 없이 일반 Groovy로 실행된다
// 주의: @NonCPS 메서드 안에서는 Pipeline Step(sh, echo 등)을 호출할 수 없다
@NonCPS
def parseJson(String text) {
    def slurper = new groovy.json.JsonSlurper()
    def result = slurper.parseText(text)
    return result  // 반환 시점에 직렬화 가능한 타입으로 변환되어야 한다
}

pipeline {
    agent any
    stages {
        stage('Parse') {
            steps {
                script {
                    def data = parseJson('{"key": "value", "count": 42}')
                    echo "key = ${data.key}, count = ${data.count}"
                }
            }
        }
    }
}
```

**해결 방법 2 - readJSON Step 사용 (Pipeline Utility Steps 플러그인):**

```groovy
pipeline {
    agent any
    stages {
        stage('Parse') {
            steps {
                script {
                    // readJSON은 CPS-safe한 Pipeline Step이다
                    writeFile file: 'data.json', text: '{"key": "value"}'
                    def json = readJSON file: 'data.json'
                    echo "key = ${json.key}"
                }
            }
        }
    }
}
```

### @NonCPS 심화 규칙

`@NonCPS`를 사용할 때 반드시 지켜야 할 규칙이 있다.

| 규칙 | 설명 |
|------|------|
| Pipeline Step 호출 금지 | `sh`, `echo`, `writeFile` 등 Pipeline Step을 호출하면 안 된다 |
| 반환값 직렬화 | 반환값은 반드시 직렬화 가능한 타입이어야 한다 (String, Integer, List, Map 등) |
| 중단 불가 | `@NonCPS` 메서드 실행 중에는 Pipeline을 중단할 수 없다 |
| 재시작 비호환 | `@NonCPS` 실행 중 Jenkins가 재시작되면 해당 메서드는 처음부터 재실행된다 |

```groovy
// 올바른 @NonCPS 사용
@NonCPS
def sortVersions(List<String> versions) {
    return versions.sort { a, b ->
        def aParts = a.tokenize('.').collect { it.toInteger() }
        def bParts = b.tokenize('.').collect { it.toInteger() }
        for (int i = 0; i < Math.min(aParts.size(), bParts.size()); i++) {
            if (aParts[i] != bParts[i]) return aParts[i] <=> bParts[i]
        }
        return aParts.size() <=> bParts.size()
    }
}

// 잘못된 @NonCPS 사용 (Pipeline Step 호출)
@NonCPS
def badExample() {
    sh 'echo hello'  // 실행 시 에러 발생: Steps may not be run inside @NonCPS methods
}
```

### Groovy Closure와 CPS

CPS 환경에서 Groovy Closure를 사용할 때 주의해야 한다.

```groovy
pipeline {
    agent any
    stages {
        stage('Example') {
            steps {
                script {
                    // 문제: collect, each 등 Groovy 컬렉션 메서드에 Closure 전달 시
                    // CPS 변환 문제가 발생할 수 있다
                    def items = ['a', 'b', 'c']

                    // 안전한 방법: for 루프 사용
                    for (int i = 0; i < items.size(); i++) {
                        echo "Item: ${items[i]}"
                    }

                    // 위험한 방법: .each() Closure (CPS 버그 가능)
                    // items.each { item ->
                    //     echo "Item: ${item}"
                    // }

                    // Closure를 꼭 써야 한다면, @NonCPS 메서드로 분리
                    def result = transformItems(items)
                    echo "Transformed: ${result}"
                }
            }
        }
    }
}

@NonCPS
def transformItems(List items) {
    return items.collect { it.toUpperCase() }
}
```

### String Interpolation과 보안

Groovy String Interpolation은 편리하지만, 보안 위험을 초래할 수 있다.

```groovy
pipeline {
    agent any
    environment {
        SECRET_TOKEN = credentials('my-secret-token')
    }
    stages {
        stage('Example') {
            steps {
                // 위험: GString 보간은 Groovy 레벨에서 발생하여 로그에 비밀이 노출될 수 있다
                // sh "curl -H 'Authorization: Bearer ${SECRET_TOKEN}' https://api.example.com"

                // 안전: 작은따옴표로 shell 변수를 사용하면 Jenkins가 마스킹 처리한다
                sh 'curl -H "Authorization: Bearer $SECRET_TOKEN" https://api.example.com'
            }
        }
    }
}
```

**GString vs String 차이점:**

| 구분 | 문법 | 보간 시점 | 보안 |
|------|------|----------|------|
| GString (큰따옴표) | `"Hello ${name}"` | Groovy 레벨 (Pipeline 스크립트 내) | Credential이 소스에 노출될 수 있다 |
| String (작은따옴표) | `'Hello $name'` | Shell 레벨 (sh Step에서) | Jenkins가 Credential을 마스킹한다 |

```groovy
// 안전한 패턴: Credential은 항상 작은따옴표 sh에서 사용
withCredentials([string(credentialsId: 'api-key', variable: 'API_KEY')]) {
    // 안전: Shell에서 변수 치환
    sh 'echo "Calling API..." && curl -H "X-API-Key: $API_KEY" https://api.example.com'

    // 위험: Groovy 보간
    // sh "curl -H 'X-API-Key: ${API_KEY}' https://api.example.com"
}
```

### Groovy 유용한 패턴

```groovy
// 1. Map 파라미터 패턴
def call(Map config = [:]) {
    def image = config.get('image', 'default-image')
    def tag = config.get('tag', 'latest')
    def registry = config.get('registry', 'docker.io')
    // ...
}

// 2. try-catch 에러 처리 (Scripted Pipeline 또는 script 블록 내)
script {
    try {
        sh 'make test'
    } catch (Exception e) {
        currentBuild.result = 'UNSTABLE'
        echo "테스트 실패 (비차단): ${e.message}"
    }
}

// 3. 동적 Stage 생성 (Scripted Pipeline)
def environments = ['dev', 'staging', 'prod']
for (env in environments) {
    stage("Deploy to ${env}") {
        node {
            sh "deploy.sh --env ${env}"
        }
    }
}

// 4. 환경 변수 조건 분기
script {
    if (env.BRANCH_NAME == 'main') {
        env.DEPLOY_ENV = 'production'
    } else if (env.BRANCH_NAME == 'develop') {
        env.DEPLOY_ENV = 'staging'
    } else {
        env.DEPLOY_ENV = 'development'
    }
}

// 5. 외부 스크립트 로딩
script {
    def utils = load 'ci/utils.groovy'
    utils.buildAndPush(image: 'my-app', tag: env.BUILD_NUMBER)
}
```

---

