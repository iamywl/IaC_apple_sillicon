# Day 6: 모니터링, JCasC, 트러블슈팅

Prometheus 기반 Jenkins 모니터링, Jenkins Configuration as Code(JCasC)를 통한 선언적 설정 관리, 그리고 트러블슈팅 가이드를 다룬다.

---

## 모니터링

### Prometheus Metrics Endpoint

Prometheus 플러그인을 설치하면 Jenkins 메트릭을 Prometheus 형식으로 노출한다.

```
# Prometheus 메트릭 엔드포인트
http://<jenkins-url>/prometheus/

# 주요 메트릭:
# jenkins_executor_count_value            - Executor 총 수
# jenkins_executor_in_use_value           - 사용 중인 Executor 수
# jenkins_queue_size_value                - 빌드 큐 크기
# jenkins_node_online_value               - 온라인 Node 수
# jenkins_job_count_value                 - 전체 Job 수
# jenkins_plugins_active                  - 활성 플러그인 수
# jenkins_plugins_inactive                - 비활성 플러그인 수
# jenkins_health_check_score              - 전체 건강도 점수
# default_jenkins_builds_duration_milliseconds_summary  - 빌드 소요 시간
# default_jenkins_builds_success_build_count            - 성공 빌드 수
# default_jenkins_builds_failed_build_count             - 실패 빌드 수
```

**Prometheus 스크래핑 설정:**

```yaml
# Prometheus scrape config
scrape_configs:
  - job_name: 'jenkins'
    metrics_path: '/prometheus/'
    scheme: http
    static_configs:
      - targets: ['jenkins.jenkins.svc.cluster.local:8080']
    # 또는 Kubernetes Service Monitor 사용
    # tart-infra 프로젝트에서는 platform 클러스터의 jenkins 네임스페이스를 대상으로 한다
```

```yaml
# ServiceMonitor (Prometheus Operator 사용 시)
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: jenkins
  namespace: jenkins
  labels:
    release: prometheus
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: jenkins
  endpoints:
    - port: http
      path: /prometheus/
      interval: 30s
```

### Grafana Dashboard

Jenkins 모니터링을 위한 Grafana Dashboard를 구성한다.

**주요 모니터링 패널:**

| 패널 | 메트릭 | 설명 |
|------|--------|------|
| 빌드 큐 크기 | `jenkins_queue_size_value` | 대기 중인 빌드 수 |
| Executor 사용률 | `jenkins_executor_in_use_value / jenkins_executor_count_value` | Executor 사용 비율 |
| 빌드 성공률 | `success / (success + failed)` | 시간대별 빌드 성공률 |
| 평균 빌드 시간 | `jenkins_builds_duration_milliseconds` | Job별 평균 빌드 소요 시간 |
| Node 가용성 | `jenkins_node_online_value` | 온라인 Agent Node 수 |
| JVM 힙 사용량 | `jvm_memory_bytes_used` | Controller JVM 메모리 사용량 |
| GC 빈도 | `jvm_gc_collection_seconds_count` | GC 발생 횟수와 소요 시간 |
| 플러그인 상태 | `jenkins_plugins_active` | 활성/비활성 플러그인 수 |

**알림 규칙 예시:**

```yaml
# Prometheus Alert Rules
groups:
  - name: jenkins
    rules:
      - alert: JenkinsBuildQueueHigh
        expr: jenkins_queue_size_value > 10
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Jenkins 빌드 큐가 10개 이상 대기 중이다"
          description: "빌드 큐: {{ $value }}개. Agent 부족 가능성이 있다."

      - alert: JenkinsExecutorSaturation
        expr: jenkins_executor_in_use_value / jenkins_executor_count_value > 0.9
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "Jenkins Executor 사용률이 90% 이상이다"

      - alert: JenkinsHighMemory
        expr: jvm_memory_bytes_used{area="heap"} / jvm_memory_bytes_max{area="heap"} > 0.85
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Jenkins JVM 힙 메모리 사용률이 85%를 초과했다"
          description: "힙 사용량: {{ $value | humanizePercentage }}. OOM 위험이 있다."

      - alert: JenkinsNodeOffline
        expr: jenkins_node_online_value < 1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "모든 Jenkins Agent Node가 오프라인이다"
```

---

## Jenkins Configuration as Code (JCasC)

### JCasC 개요

JCasC(Jenkins Configuration as Code)는 Jenkins의 전체 설정을 YAML 파일로 관리하는 방식이다. 수동 UI 설정 대신 코드로 관리하면 버전 관리, 재현성, 자동화가 가능해진다.

```yaml
# jenkins.yaml (JCasC 설정 파일)

# 1. Jenkins 시스템 설정
jenkins:
  systemMessage: "Jenkins CI - tart-infra (Managed by JCasC)"
  numExecutors: 0          # Controller에서 빌드 실행 방지
  mode: EXCLUSIVE           # 레이블 매칭 Agent에서만 빌드
  quietPeriod: 5
  scmCheckoutRetryCount: 3

  # 보안 설정
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: admin
          password: "${JENKINS_ADMIN_PASSWORD}"
        - id: developer
          password: "${DEVELOPER_PASSWORD}"

  authorizationStrategy:
    roleBased:
      roles:
        global:
          - name: admin
            permissions:
              - "Overall/Administer"
            entries:
              - user: admin
          - name: developer
            permissions:
              - "Overall/Read"
              - "Job/Build"
              - "Job/Read"
              - "Job/Workspace"
              - "Job/Cancel"
            entries:
              - user: developer

  # Agent-to-Controller 보안
  remotingSecurity:
    enabled: true

  # Kubernetes Cloud 설정
  clouds:
    - kubernetes:
        name: "kubernetes"
        serverUrl: "https://kubernetes.default.svc"
        namespace: "jenkins"
        jenkinsUrl: "http://jenkins.jenkins.svc.cluster.local:8080"
        jenkinsTunnel: "jenkins-agent.jenkins.svc.cluster.local:50000"
        containerCapStr: "10"
        maxRequestsPerHostStr: "32"
        retentionTimeout: 5
        connectTimeout: 5
        readTimeout: 15
        templates:
          - name: "default"
            label: "default"
            nodeUsageMode: "NORMAL"
            containers:
              - name: "jnlp"
                image: "jenkins/inbound-agent:latest"
                resourceRequestCpu: "200m"
                resourceLimitCpu: "500m"
                resourceRequestMemory: "256Mi"
                resourceLimitMemory: "512Mi"
                workingDir: "/home/jenkins/agent"
                ttyEnabled: true
            podRetention: "never"
            idleMinutes: 0
            activeDeadlineSeconds: 1800

          - name: "docker-builder"
            label: "docker"
            containers:
              - name: "jnlp"
                image: "jenkins/inbound-agent:latest"
              - name: "docker"
                image: "docker:dind"
                privileged: true
                resourceRequestCpu: "500m"
                resourceLimitCpu: "2"
                resourceRequestMemory: "512Mi"
                resourceLimitMemory: "2Gi"

# 2. Credential 설정
credentials:
  system:
    domainCredentials:
      - credentials:
          - usernamePassword:
              scope: GLOBAL
              id: "github-creds"
              username: "${GITHUB_USERNAME}"
              password: "${GITHUB_TOKEN}"
              description: "GitHub Credentials"
          - string:
              scope: GLOBAL
              id: "slack-webhook"
              secret: "${SLACK_WEBHOOK_URL}"
              description: "Slack Webhook URL"
          - file:
              scope: GLOBAL
              id: "platform-kubeconfig"
              fileName: "kubeconfig"
              secretBytes: "${readFileBase64:kubeconfig/platform.yaml}"
              description: "Platform cluster kubeconfig"

# 3. 도구 설정
tool:
  git:
    installations:
      - name: "Default"
        home: "/usr/bin/git"
  jdk:
    installations:
      - name: "JDK17"
        properties:
          - installSource:
              installers:
                - adoptOpenJdkInstaller:
                    id: "jdk-17.0.2+8"
  maven:
    installations:
      - name: "Maven3"
        properties:
          - installSource:
              installers:
                - maven:
                    id: "3.9.6"

# 4. 공유 라이브러리 설정
unclassified:
  globalLibraries:
    libraries:
      - name: "shared-pipeline"
        defaultVersion: "main"
        retriever:
          modernSCM:
            scm:
              git:
                remote: "https://github.com/org/jenkins-shared-library.git"
                credentialsId: "github-creds"

  # 이메일 알림 설정
  mailer:
    smtpHost: "smtp.example.com"
    smtpPort: "587"
    useSsl: false
    charset: "UTF-8"
    defaultSuffix: "@example.com"

  # Slack 알림 설정
  slackNotifier:
    teamDomain: "my-team"
    tokenCredentialId: "slack-webhook"
    room: "#jenkins-builds"
    botUser: true

# 5. Job 설정 (Job DSL 또는 직접 정의)
jobs:
  - script: >
      multibranchPipelineJob('my-app') {
        branchSources {
          github {
            id('my-app-github')
            repoOwner('my-org')
            repository('my-app')
            scanCredentialsId('github-creds')
          }
        }
        orphanedItemStrategy {
          discardOldItems {
            numToKeep(20)
          }
        }
      }
```

### JCasC 환경 변수 치환

JCasC에서는 `${VAR_NAME}` 형식으로 환경 변수를 참조할 수 있다. Kubernetes Secret을 환경 변수로 주입하면 비밀 정보를 안전하게 관리할 수 있다.

```yaml
# Kubernetes Secret으로 JCasC 환경 변수 주입
apiVersion: v1
kind: Secret
metadata:
  name: jenkins-casc-secrets
  namespace: jenkins
type: Opaque
stringData:
  JENKINS_ADMIN_PASSWORD: "supersecret"
  GITHUB_USERNAME: "jenkins-bot"
  GITHUB_TOKEN: "ghp_xxxx"
  SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/xxx"
```

```yaml
# Helm values에서 Secret을 환경 변수로 마운트
controller:
  containerEnvFrom:
    - secretRef:
        name: jenkins-casc-secrets
  JCasC:
    configScripts:
      main-config: |
        # 여기에 JCasC YAML 작성
```

### JCasC 적용 방법

```bash
# 방법 1: ConfigMap으로 JCasC 설정 마운트
kubectl create configmap jenkins-casc-config \
  --from-file=jenkins.yaml=jenkins-casc.yaml \
  --namespace jenkins \
  --kubeconfig=kubeconfig/platform.yaml

# 방법 2: Helm values에 직접 포함 (위 예시 참조)

# 방법 3: 설정 리로드 (Jenkins 재시작 없이)
# Manage Jenkins > Configuration as Code > Reload existing configuration
# 또는 API:
curl -X POST -u admin:password \
  'http://<jenkins-url>/configuration-as-code/reload'
```

---

## 트러블슈팅

### Pipeline 디버깅

**1. Replay 기능:**

Pipeline 실행 실패 시, `Replay` 기능을 사용하면 Jenkinsfile을 수정하고 다시 실행할 수 있다. Git에 커밋하지 않고도 빠르게 디버깅할 수 있다.

```
Build History > 실패한 빌드 선택 > Replay
  → Groovy 코드를 수정 → Run
```

**2. 환경 변수 확인:**

```groovy
pipeline {
    agent any
    stages {
        stage('Debug Env') {
            steps {
                // 모든 환경 변수 출력
                sh 'env | sort'

                // 특정 Pipeline 변수 확인
                echo "BUILD_NUMBER: ${env.BUILD_NUMBER}"
                echo "JOB_NAME: ${env.JOB_NAME}"
                echo "WORKSPACE: ${env.WORKSPACE}"
                echo "NODE_NAME: ${env.NODE_NAME}"
                echo "BRANCH_NAME: ${env.BRANCH_NAME ?: 'N/A'}"
            }
        }
    }
}
```

**3. Groovy Script Console:**

`Manage Jenkins > Script Console`에서 Groovy 코드를 직접 실행하여 Jenkins 내부 상태를 확인할 수 있다.

```groovy
// 모든 Job 목록 출력
Jenkins.instance.getAllItems(Job).each { job ->
    println "${job.fullName} - Last build: ${job.lastBuild?.number ?: 'never'}"
}

// 빌드 큐 확인
def queue = Jenkins.instance.queue
queue.items.each { item ->
    println "Queued: ${item.task.name} - Why: ${item.why}"
}

// 모든 Agent 상태 확인
Jenkins.instance.computers.each { computer ->
    println "${computer.name}: ${computer.isOnline() ? 'ONLINE' : 'OFFLINE'} " +
            "(${computer.countBusy()}/${computer.numExecutors} busy)"
}

// 디스크 사용량 확인
def jenkinsHome = Jenkins.instance.rootDir
def usableSpace = jenkinsHome.usableSpace / (1024 * 1024 * 1024)
def totalSpace = jenkinsHome.totalSpace / (1024 * 1024 * 1024)
println "Disk: ${String.format('%.1f', totalSpace - usableSpace)}GB / ${String.format('%.1f', totalSpace)}GB used"
```

### Agent 연결 문제

**증상과 원인:**

| 증상 | 가능한 원인 | 해결 방법 |
|------|------------|----------|
| Agent가 오프라인이다 | 네트워크 연결 실패 | 방화벽/보안그룹에서 50000 포트 확인 |
| Agent가 연결되었다가 끊어진다 | 리소스 부족 (OOM) | Agent JVM 메모리 증가 |
| Agent Pod가 Pending이다 | 리소스 부족 (K8s) | Node 자원 확인, ResourceQuota 조정 |
| Agent Pod가 CrashLoopBackOff이다 | JNLP 설정 오류 | Jenkins URL/Tunnel 설정 확인 |
| 빌드가 큐에서 대기한다 | Agent/Executor 부족 | Agent 수 증가, Container Cap 조정 |

**Kubernetes Agent 트러블슈팅:**

```bash
# 1. Agent Pod 상태 확인
kubectl get pods -n jenkins -l jenkins=agent \
  --kubeconfig=kubeconfig/platform.yaml

# 2. Agent Pod 로그 확인
kubectl logs <agent-pod-name> -c jnlp -n jenkins \
  --kubeconfig=kubeconfig/platform.yaml

# 3. Agent Pod 이벤트 확인
kubectl describe pod <agent-pod-name> -n jenkins \
  --kubeconfig=kubeconfig/platform.yaml

# 4. Jenkins Controller 로그에서 Agent 관련 오류 확인
kubectl logs deploy/jenkins -n jenkins --tail=100 \
  --kubeconfig=kubeconfig/platform.yaml | grep -i "agent\|slave\|remoting"

# 5. JNLP 포트 연결 테스트
kubectl exec -n jenkins deploy/jenkins -- \
  curl -s http://jenkins.jenkins.svc.cluster.local:50000 || echo "JNLP port not accessible"

# 6. ServiceAccount 권한 확인
kubectl auth can-i create pods --as=system:serviceaccount:jenkins:jenkins \
  -n jenkins --kubeconfig=kubeconfig/platform.yaml
```

### 플러그인 충돌

**증상:**
- Jenkins 시작 후 특정 기능이 동작하지 않는다
- 로그에 `ClassNotFoundException` 또는 `LinkageError`가 발생한다
- UI에서 플러그인 관련 오류 메시지가 나타난다

**진단:**

```bash
# Jenkins 로그에서 플러그인 오류 확인
kubectl logs deploy/jenkins -n jenkins \
  --kubeconfig=kubeconfig/platform.yaml | grep -i "plugin\|exception\|error" | head -50

# 플러그인 의존성 확인 (Script Console)
# Jenkins.instance.pluginManager.plugins.each { plugin ->
#     def deps = plugin.getDependencies()
#     if (deps) {
#         println "${plugin.shortName}:${plugin.version} -> ${deps.collect { it.shortName + ':' + it.version }}"
#     }
# }
```

**해결 방법:**

```bash
# 1. 안전 모드로 Jenkins 시작 (모든 플러그인 비활성화)
# JENKINS_JAVA_OPTS에 추가: -Dhudson.PluginManager.className=hudson.ClassicPluginManager

# 2. 문제 플러그인 수동 제거
kubectl exec -n jenkins deploy/jenkins -- \
  rm /var/jenkins_home/plugins/problematic-plugin.jpi

# 3. 플러그인 업데이트
kubectl exec -n jenkins deploy/jenkins -- \
  java -jar /var/jenkins_home/war/WEB-INF/jenkins-cli.jar \
  -s http://localhost:8080/ install-plugin git@latest -restart

# 4. Plugin Manager CLI 도구 사용
# jenkins-plugin-manager --plugin-file plugins.txt --war /usr/share/jenkins/jenkins.war
```

### 메모리 문제

**JVM Heap Dump 분석:**

```bash
# 1. 힙 덤프 생성
kubectl exec -n jenkins deploy/jenkins -- \
  jmap -dump:format=b,file=/var/jenkins_home/heapdump.hprof $(pgrep -f jenkins.war)

# 2. 힙 덤프 복사
kubectl cp jenkins/jenkins-0:/var/jenkins_home/heapdump.hprof ./heapdump.hprof \
  --kubeconfig=kubeconfig/platform.yaml

# 3. MAT(Memory Analyzer Tool) 또는 VisualVM으로 분석
```

**메모리 최적화 체크리스트:**

| 항목 | 조치 |
|------|------|
| 빌드 이력 | `buildDiscarder`로 오래된 빌드 자동 삭제한다 |
| 워크스페이스 | `cleanWs()`로 빌드 후 워크스페이스 정리한다 |
| 플러그인 | 사용하지 않는 플러그인을 제거한다 |
| Pipeline 로그 | Pipeline Durability를 `PERFORMANCE_OPTIMIZED`로 설정한다 |
| 동시 빌드 | `disableConcurrentBuilds()`로 과다 빌드 방지한다 |
| GC 로그 | `-Xlog:gc*:file=/var/jenkins_home/gc.log`으로 GC 로그를 활성화한다 |

### 빌드 큐 문제

빌드가 큐에서 무한 대기하는 경우의 원인과 해결 방법이다.

```groovy
// Script Console에서 큐 상태 확인
Jenkins.instance.queue.items.each { item ->
    println """
    Task: ${item.task.name}
    In Queue Since: ${new Date(item.inQueueSince)}
    Blocked: ${item.isBlocked()}
    Buildable: ${item.isBuildable()}
    Stuck: ${item.isStuck()}
    Why: ${item.why}
    Caused By: ${item.causeOfBlockage}
    """
}

// 큐 초기화 (주의: 대기 중인 모든 빌드가 취소된다)
// Jenkins.instance.queue.clear()

// 특정 항목만 큐에서 제거
// Jenkins.instance.queue.items.findAll { it.task.name == 'stuck-job' }.each {
//     Jenkins.instance.queue.cancel(it.task)
// }
```

| 원인 | 증상 (Why 메시지) | 해결 |
|------|-------------------|------|
| Agent 부족 | "Waiting for next available executor" | Agent 추가 또는 Container Cap 증가 |
| Label 불일치 | "There are no nodes with the label..." | Agent Label 확인 또는 수정 |
| 동시 빌드 제한 | "Build is blocked by..." | `disableConcurrentBuilds()` 설정 확인 |
| 리소스 부족 | K8s Pod Pending | Node 리소스 확인, ResourceQuota 조정 |
| 큐 데드락 | 여러 Job이 서로를 기다림 | Job 의존성 그래프 검토 |

---

