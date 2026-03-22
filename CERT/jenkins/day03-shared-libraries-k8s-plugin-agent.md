# Day 3: Shared Libraries, Kubernetes 플러그인, Agent 관리

파이프라인 코드 재사용을 위한 Shared Libraries, Kubernetes 플러그인을 통한 동적 Agent Pod 관리, 그리고 Agent 관리 심화를 다룬다.

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

### Global vs Folder-Scoped Library

Shared Library는 두 가지 범위로 등록할 수 있다.

| 범위 | 설정 위치 | 적용 대상 | 용도 |
|------|----------|----------|------|
| Global | Manage Jenkins > System > Global Pipeline Libraries | 모든 파이프라인 | 조직 전체 표준 라이브러리 |
| Folder-Scoped | Folder 설정 > Pipeline Libraries | 해당 Folder 하위 파이프라인만 | 팀별 커스텀 라이브러리 |

**Global Library 설정 (Manage Jenkins > System):**

```
Library Name: my-shared-library
Default version: main
Retrieval method: Modern SCM
  Source Code Management: Git
  Project Repository: https://github.com/org/jenkins-shared-library.git
  Credentials: github-pat
Load implicitly: false    (true이면 @Library 없이 자동 로딩)
Allow default version to be overridden: true
Include @Library changes in job recent changes: true
```

### src/ 디렉토리 - OOP 스타일 코드

`src/` 디렉토리는 표준 Groovy 클래스를 작성하는 곳이다. Java 패키지 규칙을 따른다.

```groovy
// src/com/example/Docker.groovy
package com.example

class Docker implements Serializable {
    private def script  // Pipeline script 컨텍스트

    Docker(script) {
        this.script = script
    }

    def build(String image, String tag = 'latest') {
        script.sh "docker build -t ${image}:${tag} ."
    }

    def push(String image, String tag = 'latest', String registry = 'docker.io') {
        script.sh "docker push ${registry}/${image}:${tag}"
    }

    def buildAndPush(Map config) {
        def image = config.image
        def tag = config.tag ?: 'latest'
        def registry = config.registry ?: 'docker.io'

        build(image, tag)
        push(image, tag, registry)
    }
}
```

```groovy
// src/com/example/Kubernetes.groovy
package com.example

class Kubernetes implements Serializable {
    private def script

    Kubernetes(script) {
        this.script = script
    }

    def deploy(String manifest, String namespace = 'default') {
        script.sh "kubectl apply -f ${manifest} -n ${namespace}"
    }

    def rolloutStatus(String deployment, String namespace = 'default', int timeout = 120) {
        script.sh "kubectl rollout status deployment/${deployment} -n ${namespace} --timeout=${timeout}s"
    }

    def rollback(String deployment, String namespace = 'default') {
        script.sh "kubectl rollout undo deployment/${deployment} -n ${namespace}"
    }
}
```

**사용 예시:**

```groovy
@Library('my-shared-library') _
import com.example.Docker
import com.example.Kubernetes

pipeline {
    agent any
    stages {
        stage('Build & Push') {
            steps {
                script {
                    def docker = new Docker(this)
                    docker.buildAndPush(
                        image: 'my-app',
                        tag: env.BUILD_NUMBER,
                        registry: 'registry.example.com'
                    )
                }
            }
        }
        stage('Deploy') {
            steps {
                script {
                    def k8s = new Kubernetes(this)
                    k8s.deploy('manifests/deployment.yaml', 'production')
                    k8s.rolloutStatus('my-app', 'production', 300)
                }
            }
        }
    }
}
```

### resources/ 디렉토리

`resources/` 디렉토리에는 비Groovy 파일(JSON, YAML, 셸 스크립트 등)을 저장한다. `libraryResource` Step으로 로드한다.

```groovy
// resources/com/example/pod-template.yaml
// apiVersion: v1
// kind: Pod
// spec:
//   containers:
//     - name: maven
//       image: maven:3.9

// vars/standardPipeline.groovy
def call(Map config = [:]) {
    def podYaml = libraryResource 'com/example/pod-template.yaml'

    pipeline {
        agent {
            kubernetes {
                yaml podYaml
            }
        }
        stages {
            stage('Build') {
                steps {
                    container('maven') {
                        sh 'mvn clean package'
                    }
                }
            }
        }
    }
}
```

### Shared Library 테스트

Shared Library는 일반 Groovy/Java 프로젝트처럼 테스트할 수 있다. `JenkinsPipelineUnit` 프레임워크를 사용하면 Pipeline을 단위 테스트할 수 있다.

```groovy
// test/groovy/BuildDockerTest.groovy
import com.lesfurets.jenkins.unit.BasePipelineTest
import org.junit.Before
import org.junit.Test

class BuildDockerTest extends BasePipelineTest {
    @Before
    void setUp() {
        super.setUp()
        // vars/ 스크립트 로딩
        helper.registerAllowedMethod('sh', [String], null)
    }

    @Test
    void testBuildDocker() {
        def script = loadScript('vars/buildDocker.groovy')
        script.call(image: 'test-app', tag: '1.0', registry: 'myregistry.com')

        // sh 호출 검증
        assertJobStatusSuccess()
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

## Agent 관리 심화

### Static Agent (고정 Agent)

Static Agent는 Jenkins Controller에 영구적으로 등록된 Agent이다. 전용 빌드 서버나 특수 하드웨어(GPU, 특수 라이선스)가 필요한 경우에 사용한다.

**SSH Agent 설정:**

```
Manage Jenkins > Nodes > New Node
  Node name: build-server-01
  Type: Permanent Agent
  # of Executors: 4
  Remote root directory: /var/jenkins
  Labels: linux docker gpu
  Usage: Only build jobs with label expressions matching this node
  Launch method: Launch agents via SSH
    Host: 192.168.1.100
    Credentials: ssh-key-for-build-server
    Host Key Verification Strategy: Known hosts file
  Availability: Keep this agent online as much as possible
```

**Agent Label 활용:**

```groovy
pipeline {
    agent none
    stages {
        stage('Build') {
            agent { label 'linux && docker' }      // AND 조건
            steps { sh 'docker build .' }
        }
        stage('GPU Test') {
            agent { label 'gpu || high-memory' }   // OR 조건
            steps { sh './run-gpu-tests.sh' }
        }
        stage('Deploy') {
            agent { label 'linux && !staging' }    // NOT 조건
            steps { sh './deploy.sh' }
        }
    }
}
```

### Cloud Agent (동적 Agent)

Cloud Agent는 빌드 수요에 따라 자동으로 생성되고 삭제되는 Agent이다. Kubernetes, AWS EC2, Docker 등 다양한 클라우드 프로바이더를 지원한다.

**Kubernetes Cloud 설정:**

```
Manage Jenkins > Clouds > New Cloud > Kubernetes
  Kubernetes URL: https://kubernetes.default.svc    (클러스터 내부)
  Kubernetes Namespace: jenkins
  Credentials: kubeconfig-secret
  Jenkins URL: http://jenkins.jenkins.svc.cluster.local:8080
  Jenkins tunnel: jenkins-agent.jenkins.svc.cluster.local:50000
  Container Cap: 10        (동시 최대 Pod 수)
  Pod Labels:
    jenkins: agent
```

### Kubernetes Agent 리소스 관리

Kubernetes 환경에서 Agent Pod의 리소스를 적절히 관리해야 클러스터 안정성을 유지할 수 있다.

**ResourceQuota로 Jenkins Agent 리소스 제한:**

```yaml
# manifests/jenkins/agent-resource-quota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: jenkins-agent-quota
  namespace: jenkins
spec:
  hard:
    requests.cpu: "8"
    requests.memory: 16Gi
    limits.cpu: "16"
    limits.memory: 32Gi
    pods: "20"
```

**LimitRange로 기본 리소스 설정:**

```yaml
# manifests/jenkins/agent-limit-range.yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: jenkins-agent-limits
  namespace: jenkins
spec:
  limits:
    - type: Container
      default:
        cpu: 500m
        memory: 512Mi
      defaultRequest:
        cpu: 200m
        memory: 256Mi
      max:
        cpu: "4"
        memory: 4Gi
      min:
        cpu: 100m
        memory: 128Mi
```

**PriorityClass로 빌드 우선순위 관리:**

```yaml
# 일반 빌드용 PriorityClass
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: jenkins-normal-build
value: 100
globalDefault: false
description: "일반 Jenkins 빌드 우선순위"

---
# 긴급 빌드용 PriorityClass
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: jenkins-critical-build
value: 1000
globalDefault: false
description: "긴급 Jenkins 빌드 우선순위 (핫픽스 등)"
```

```groovy
// PriorityClass를 적용한 PodTemplate
pipeline {
    agent {
        kubernetes {
            yaml """
                apiVersion: v1
                kind: Pod
                spec:
                  priorityClassName: jenkins-critical-build
                  containers:
                    - name: jnlp
                      image: jenkins/inbound-agent:latest
                    - name: builder
                      image: maven:3.9
                      command: ['sleep', 'infinity']
            """
        }
    }
    stages {
        stage('Hotfix Build') {
            steps {
                container('builder') {
                    sh 'mvn clean package'
                }
            }
        }
    }
}
```

### 워크스페이스 공유와 볼륨 전략

Kubernetes Agent Pod에서 모든 컨테이너는 동일한 워크스페이스를 공유한다. 이는 emptyDir 볼륨으로 구현된다.

```groovy
agent {
    kubernetes {
        yaml '''
            apiVersion: v1
            kind: Pod
            spec:
              containers:
                - name: jnlp
                  image: jenkins/inbound-agent:latest
                - name: maven
                  image: maven:3.9
                  command: ['sleep', 'infinity']
                  volumeMounts:
                    - name: maven-cache
                      mountPath: /root/.m2/repository
                - name: node
                  image: node:20
                  command: ['sleep', 'infinity']
                  volumeMounts:
                    - name: npm-cache
                      mountPath: /root/.npm
              volumes:
                # 빌드 간 캐시 공유를 위한 PVC
                - name: maven-cache
                  persistentVolumeClaim:
                    claimName: maven-repo-cache
                - name: npm-cache
                  persistentVolumeClaim:
                    claimName: npm-cache
        '''
    }
}
```

---

