# Day 5: 보안, 성능 튜닝, 고가용성

Jenkins 보안 강화(CSRF, RBAC, API Token), JVM 성능 튜닝, 그리고 고가용성(HA) 구성을 다룬다.

---

## 보안 심화

### Matrix Authorization Strategy

Matrix Authorization은 사용자별/그룹별로 세밀한 권한을 설정하는 방식이다.

```
Manage Jenkins > Security > Authorization > Matrix-based security

                     Overall  Job      View     Agent    Credential
                     Admin    Build    Read     Connect  View
                     Read     Config
                     RunScripts Create

admin               [x]      [x]      [x]      [x]      [x]
developer           [ ]      [x]      [x]      [ ]      [ ]
viewer              [ ]      [ ]      [x]      [ ]      [ ]
deploy-bot          [ ]      [x]      [x]      [ ]      [x]
anonymous           [ ]      [ ]      [ ]      [ ]      [ ]
```

### Role-Based Authorization Strategy

Role-Based Strategy는 역할(Role)을 정의하고 사용자에게 역할을 할당하는 방식이다. Matrix Authorization보다 관리가 편하다.

**역할 정의:**

| 역할 | 권한 | 적용 범위 |
|------|------|----------|
| admin | 전체 관리 | 글로벌 |
| developer | Job 빌드, 읽기, 설정 | 글로벌 |
| viewer | 읽기 전용 | 글로벌 |
| team-a-admin | Job 전체 권한 | `team-a-.*` 패턴 |
| team-b-admin | Job 전체 권한 | `team-b-.*` 패턴 |

```
Manage Jenkins > Security > Authorization > Role-Based Strategy

Global Roles:
  admin:     Overall/Administer
  developer: Overall/Read, Job/Build, Job/Read, Job/Workspace
  viewer:    Overall/Read, Job/Read

Project Roles (Pattern 기반):
  team-a-admin (Pattern: team-a-.*):
    Job/Build, Job/Cancel, Job/Configure, Job/Create, Job/Delete, Job/Read, Job/Workspace
  team-b-admin (Pattern: team-b-.*):
    Job/Build, Job/Cancel, Job/Configure, Job/Create, Job/Delete, Job/Read, Job/Workspace
```

### CSRF Protection

Jenkins는 Cross-Site Request Forgery(CSRF) 공격을 방어하기 위해 Crumb 토큰을 사용한다.

```bash
# API 호출 시 CSRF Crumb 획득
CRUMB=$(curl -s -u admin:password \
  'http://jenkins:8080/crumbIssuer/api/json' | jq -r '.crumb')

# Crumb을 포함하여 API 호출
curl -X POST -u admin:password \
  -H "Jenkins-Crumb: ${CRUMB}" \
  'http://jenkins:8080/job/my-pipeline/build'
```

**API Token 사용 (Crumb 불필요):**

API Token을 사용하면 CSRF Crumb 없이 API를 호출할 수 있다. `User > Configure > API Token > Add new Token`에서 생성한다.

```bash
# API Token으로 빌드 트리거 (Crumb 불필요)
curl -X POST -u admin:API_TOKEN \
  'http://jenkins:8080/job/my-pipeline/build'
```

### Script Approval과 Groovy Sandbox

Jenkins Pipeline은 기본적으로 Groovy Sandbox 안에서 실행된다. Sandbox는 허용된 메서드만 호출할 수 있게 제한한다.

```groovy
// Sandbox에서 허용되는 코드
pipeline {
    agent any
    stages {
        stage('Example') {
            steps {
                script {
                    def list = [3, 1, 4, 1, 5]
                    list.sort()           // 허용
                    echo list.toString()  // 허용
                }
            }
        }
    }
}

// Sandbox에서 차단되는 코드 (Script Approval 필요)
pipeline {
    agent any
    stages {
        stage('Example') {
            steps {
                script {
                    // 파일 시스템 직접 접근: 차단
                    // new File('/etc/passwd').text

                    // 네트워크 소켓 직접 생성: 차단
                    // new URL('http://example.com').text

                    // Runtime 명령 실행: 차단
                    // 'ls'.execute()

                    // System 프로퍼티 접근: 차단
                    // System.getProperty('user.home')
                }
            }
        }
    }
}
```

**Script Approval 관리:**

`Manage Jenkins > In-process Script Approval`에서 대기 중인 스크립트를 확인하고 승인/거부할 수 있다. 하지만 무분별한 승인은 보안 위험을 초래한다.

**안전한 대안:**
- `sh` Step으로 셸 명령을 실행한다 (Pipeline Step은 Sandbox에서 허용된다)
- Pipeline Utility Steps 플러그인의 `readJSON`, `readYaml`, `writeFile` 등을 사용한다
- `@NonCPS` 메서드에서 필요한 로직을 처리하고 Script Approval을 받는다

### Secrets 관리 모범 사례

```groovy
pipeline {
    agent any
    stages {
        stage('Secure Deployment') {
            steps {
                // 모범 사례 1: Credential은 최소 범위로 사용한다
                withCredentials([
                    file(credentialsId: 'kubeconfig', variable: 'KUBECONFIG')
                ]) {
                    // 모범 사례 2: 작은따옴표 sh로 마스킹을 보장한다
                    sh 'kubectl --kubeconfig=$KUBECONFIG apply -f manifests/'
                }

                // 모범 사례 3: 환경 변수에 직접 할당하지 않는다
                // 잘못된 예: env.MY_SECRET = credentials('my-secret')  // 로그에 노출 위험

                // 모범 사례 4: Credential ID는 의미 있는 이름을 사용한다
                // 좋은 예: 'prod-registry-creds', 'github-deploy-key'
                // 나쁜 예: 'cred1', 'my-secret'
            }
        }
    }
}
```

### Audit Logging

Jenkins의 감사 로깅은 보안 사고 추적과 컴플라이언스에 필수적이다.

```
# Audit Trail 플러그인 설정
Manage Jenkins > System > Audit Trail
  Logger:
    Log Location: /var/jenkins_home/audit/audit.log
    Log File Size: 100MB
    Log File Count: 10
  Pattern: .*  (모든 요청 기록)
```

기록되는 이벤트:
- 사용자 로그인/로그아웃
- Job 생성/수정/삭제
- 빌드 실행/중단
- Credential 생성/수정
- 플러그인 설치/업데이트
- 시스템 설정 변경

### Agent-to-Controller Security

Jenkins 2.x부터 Agent에서 Controller의 파일 시스템에 접근하는 것을 기본적으로 차단한다. `Manage Jenkins > Security > Agent → Controller Security`에서 화이트리스트를 관리할 수 있다. Agent가 실행하는 코드를 신뢰할 수 없는 경우 반드시 이 설정을 유지해야 한다.

---

## 성능 튜닝

### JVM 튜닝

Jenkins Controller는 Java 애플리케이션이므로, JVM 설정이 성능에 큰 영향을 미친다.

```bash
# 권장 JVM 옵션 (jenkins-values.yaml의 javaOpts에 설정)
JAVA_OPTS="
  -Xms2g                          # 초기 힙 크기
  -Xmx4g                          # 최대 힙 크기
  -XX:+UseG1GC                    # G1 가비지 컬렉터 사용
  -XX:+ParallelRefProcEnabled     # 병렬 참조 처리
  -XX:+DisableExplicitGC          # System.gc() 호출 무시
  -XX:MaxMetaspaceSize=512m       # Metaspace 최대 크기 (플러그인이 많으면 증가)
  -XX:+HeapDumpOnOutOfMemoryError # OOM 발생 시 힙 덤프
  -XX:HeapDumpPath=/var/jenkins_home/heapdumps
  -Djava.awt.headless=true        # 헤드리스 모드
  -Djenkins.model.Jenkins.crumbIssuerProxyCompatibility=true
  -Dhudson.model.DirectoryBrowserSupport.CSP=\"default-src 'self'; img-src * data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'\"
"
```

**힙 크기 가이드라인:**

| 규모 | Job 수 | 동시 빌드 | 권장 힙 | 비고 |
|------|--------|----------|---------|------|
| 소규모 | < 50 | < 5 | 1-2 GB | 개인/팀 프로젝트 |
| 중규모 | 50-200 | 5-20 | 2-4 GB | 부서 단위 |
| 대규모 | 200-1000 | 20-50 | 4-8 GB | 조직 전체 |
| 초대규모 | 1000+ | 50+ | 8-16 GB | 다수 팀 공유 |

### 빌드 최적화

**1. Parallel Stages:**

```groovy
pipeline {
    agent any
    stages {
        stage('Parallel Tests') {
            parallel {
                stage('Unit Tests') {
                    agent { label 'linux' }
                    steps { sh 'make test-unit' }
                }
                stage('Integration Tests') {
                    agent { label 'linux' }
                    steps { sh 'make test-integration' }
                }
                stage('Linting') {
                    agent { label 'linux' }
                    steps { sh 'make lint' }
                }
                stage('Security Scan') {
                    agent { label 'linux' }
                    steps { sh 'make security-scan' }
                }
            }
            // failFast: true이면 하나의 병렬 Stage가 실패하면 나머지도 중단한다
        }
    }
}
```

**2. 캐싱 전략:**

```groovy
pipeline {
    agent {
        kubernetes {
            yaml '''
                apiVersion: v1
                kind: Pod
                spec:
                  containers:
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
                    - name: gradle
                      image: gradle:8-jdk17
                      command: ['sleep', 'infinity']
                      volumeMounts:
                        - name: gradle-cache
                          mountPath: /home/gradle/.gradle
                  volumes:
                    - name: maven-cache
                      persistentVolumeClaim:
                        claimName: maven-cache-pvc
                    - name: npm-cache
                      persistentVolumeClaim:
                        claimName: npm-cache-pvc
                    - name: gradle-cache
                      persistentVolumeClaim:
                        claimName: gradle-cache-pvc
            '''
        }
    }
    stages {
        stage('Build Maven') {
            steps {
                container('maven') {
                    sh 'mvn clean package -DskipTests -T 1C'  // 멀티스레드 빌드
                }
            }
        }
        stage('Build Node') {
            steps {
                container('node') {
                    sh 'npm ci --cache /root/.npm'  // npm 캐시 활용
                }
            }
        }
    }
}
```

**3. 증분 빌드:**

```groovy
pipeline {
    agent any
    options {
        skipDefaultCheckout()
    }
    stages {
        stage('Checkout') {
            steps {
                // Shallow clone으로 체크아웃 시간 단축
                checkout([
                    $class: 'GitSCM',
                    branches: [[name: '*/main']],
                    extensions: [
                        [$class: 'CloneOption',
                         depth: 1,
                         shallow: true,
                         noTags: true],
                        [$class: 'SparseCheckoutPaths',
                         sparseCheckoutPaths: [
                             [$class: 'SparseCheckoutPath', path: 'src/'],
                             [$class: 'SparseCheckoutPath', path: 'pom.xml']
                         ]]
                    ],
                    userRemoteConfigs: [[url: 'https://github.com/org/repo.git']]
                ])
            }
        }
    }
}
```

### Workspace Cleanup 전략

```groovy
pipeline {
    agent any
    options {
        // 오래된 빌드 자동 삭제
        buildDiscarder(logRotator(
            numToKeepStr: '20',      // 최근 20개 빌드만 유지
            daysToKeepStr: '30',     // 30일 이상 된 빌드 삭제
            artifactNumToKeepStr: '5', // 아티팩트는 최근 5개만 유지
            artifactDaysToKeepStr: '14' // 아티팩트는 14일만 유지
        ))
    }
    stages {
        stage('Build') {
            steps { sh 'make build' }
        }
    }
    post {
        cleanup {
            // 워크스페이스 정리
            cleanWs(
                cleanWhenNotBuilt: false,
                deleteDirs: true,
                disableDeferredWipeout: false,
                notFailBuild: true,
                patterns: [
                    [pattern: '.gitignore', type: 'INCLUDE'],
                    [pattern: '.git/**', type: 'EXCLUDE'],  // Git 캐시 유지
                    [pattern: 'node_modules/**', type: 'EXCLUDE']  // 의존성 캐시 유지
                ]
            )
        }
    }
}
```

### Pipeline Durability 설정

Pipeline 내구성(Durability) 설정은 성능과 안정성 사이의 트레이드오프이다.

| 레벨 | 설명 | 성능 | 내구성 |
|------|------|------|--------|
| `MAX_SURVIVABILITY` | 모든 Step마다 상태 저장한다 | 느리다 | 최고 |
| `SURVIVABLE_NONATOMIC` | 주기적으로 상태를 저장한다 (기본값) | 보통 | 높다 |
| `PERFORMANCE_OPTIMIZED` | 최소한만 저장한다 | 빠르다 | 낮다 |

```groovy
// Jenkinsfile에서 설정
pipeline {
    agent any
    options {
        durabilityHint('PERFORMANCE_OPTIMIZED')  // 빠른 빌드가 우선인 경우
    }
    stages {
        stage('Fast Build') {
            steps { sh 'make build' }
        }
    }
}
```

---

## 고가용성 (HA)

### Jenkins HA 아키텍처

Jenkins는 단일 Controller 아키텍처이므로, HA 구성에는 특별한 접근이 필요하다.

```
┌──────────────────────────────────────────────────────────┐
│                  Load Balancer (Ingress)                  │
└──────────────┬───────────────────────┬───────────────────┘
               │                       │
   ┌───────────▼──────────┐  ┌────────▼───────────────┐
   │  Jenkins Controller  │  │  Jenkins Controller    │
   │  (Active)            │  │  (Standby - 수동 전환)  │
   │                      │  │                        │
   │  ┌────────────────┐  │  │  ┌────────────────┐    │
   │  │ JENKINS_HOME   │  │  │  │ JENKINS_HOME   │    │
   │  │ (Shared Storage│  │  │  │ (Shared Storage│    │
   │  │  NFS/EFS/GCS) │  │  │  │  NFS/EFS/GCS) │    │
   │  └───────┬────────┘  │  │  └───────┬────────┘    │
   └──────────│───────────┘  └──────────│─────────────┘
              │                         │
   ┌──────────▼─────────────────────────▼─────────────┐
   │              Shared Storage (PV)                   │
   │              NFS / EFS / GCS / Azure Files         │
   └──────────────────────────────────────────────────┘
```

**HA 구현 방식:**

| 방식 | 복잡도 | 설명 |
|------|--------|------|
| Active-Standby | 낮다 | 하나의 Controller만 활성화하고, 장애 시 수동/자동 전환한다 |
| Shared Storage | 보통 | JENKINS_HOME을 NFS/EFS에 저장하여 Controller 교체를 용이하게 한다 |
| Jenkins on K8s | 높다 | Kubernetes의 자가 복구 기능을 활용한다 |
| CloudBees CI (상용) | 매우 높다 | 진정한 HA (Active-Active)를 지원한다 |

### Jenkins on Kubernetes (Helm Chart)

tart-infra 프로젝트에서는 Helm Chart로 Jenkins를 Kubernetes에 배포한다.

```yaml
# manifests/jenkins-values.yaml (일반적인 구조)
controller:
  # Controller Pod 설정
  image: jenkins/jenkins
  tag: lts-jdk17
  imagePullPolicy: IfNotPresent

  # 리소스 설정
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: "2"
      memory: 4Gi

  # JVM 옵션
  javaOpts: >-
    -Xms1g -Xmx2g
    -XX:+UseG1GC
    -Dhudson.slaves.NodeProvisioner.initialDelay=0
    -Dhudson.slaves.NodeProvisioner.MARGIN=50
    -Dhudson.slaves.NodeProvisioner.MARGIN0=0.85

  # Service 설정
  serviceType: NodePort
  nodePort: 30900

  # JNLP Agent 포트
  agentListenerPort: 50000

  # 플러그인 설치
  installPlugins:
    - kubernetes:latest
    - workflow-aggregator:latest
    - git:latest
    - configuration-as-code:latest
    - job-dsl:latest
    - blueocean:latest
    - credentials-binding:latest
    - pipeline-utility-steps:latest

  # Jenkins Configuration as Code (JCasC)
  JCasC:
    defaultConfig: true
    configScripts:
      welcome-message: |
        jenkins:
          systemMessage: "Jenkins on Kubernetes - tart-infra"

  # 어드민 비밀번호
  adminPassword: ""  # 빈 값이면 자동 생성

  # Ingress (NodePort 대신 사용 시)
  ingress:
    enabled: false
    # hostName: jenkins.example.com

persistence:
  enabled: true
  storageClass: local-path
  size: 5Gi
  accessMode: ReadWriteOnce

# Agent 설정
agent:
  enabled: true
  image: jenkins/inbound-agent
  tag: latest
  # Kubernetes Agent 기본 설정은 JCasC에서 관리한다

# RBAC
serviceAccount:
  create: true
  name: jenkins

rbac:
  create: true
  readSecrets: true
```

**Kubernetes에서 Jenkins 자가 복구:**

```yaml
# Jenkins Deployment의 자가 복구 설정 (Helm Chart에 포함)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jenkins
  namespace: jenkins
spec:
  replicas: 1    # Controller는 반드시 1개만 실행해야 한다
  strategy:
    type: Recreate  # Rolling Update가 아닌 Recreate 전략 사용
  template:
    spec:
      containers:
        - name: jenkins
          image: jenkins/jenkins:lts-jdk17
          ports:
            - containerPort: 8080
            - containerPort: 50000
          livenessProbe:
            httpGet:
              path: /login
              port: 8080
            initialDelaySeconds: 120
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 5
          readinessProbe:
            httpGet:
              path: /login
              port: 8080
            initialDelaySeconds: 60
            periodSeconds: 10
            timeoutSeconds: 5
            successThreshold: 1
          volumeMounts:
            - name: jenkins-home
              mountPath: /var/jenkins_home
      volumes:
        - name: jenkins-home
          persistentVolumeClaim:
            claimName: jenkins-pvc
```

### 백업과 복원

```bash
# Jenkins 백업 (Kubernetes 환경)
# 방법 1: kubectl cp로 직접 복사
kubectl cp jenkins/jenkins-0:/var/jenkins_home ./jenkins-backup \
  --kubeconfig=kubeconfig/platform.yaml

# 방법 2: PVC 스냅샷 (CSI 지원 시)
kubectl apply -f - <<EOF
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: jenkins-backup-$(date +%Y%m%d)
  namespace: jenkins
spec:
  volumeSnapshotClassName: csi-snapshotter
  source:
    persistentVolumeClaimName: jenkins-pvc
EOF

# 방법 3: ThinBackup 플러그인 사용 (권장)
# Manage Jenkins > ThinBackup > Settings
#   Backup directory: /var/jenkins_home/backups
#   Full backup schedule: H 3 * * 0    (매주 일요일 새벽 3시)
#   Diff backup schedule:  H 3 * * 1-6 (평일 새벽 3시)
```

---

