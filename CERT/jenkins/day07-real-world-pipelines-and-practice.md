# Day 7: 실전 파이프라인과 실습

실전 파이프라인 예제(멀티 스테이지 빌드, GitOps 연동, 인프라 검증)와 Jenkins 실습 과제를 다룬다.

---

## 실전 파이프라인

### CI Pipeline (빌드-테스트-분석)

```groovy
// Jenkinsfile - CI Pipeline
@Library('shared-pipeline@main') _

pipeline {
    agent {
        kubernetes {
            yaml '''
                apiVersion: v1
                kind: Pod
                spec:
                  containers:
                    - name: jnlp
                      image: jenkins/inbound-agent:latest
                      resources:
                        requests: { cpu: 200m, memory: 256Mi }
                    - name: maven
                      image: maven:3.9-eclipse-temurin-17
                      command: ['sleep', 'infinity']
                      resources:
                        requests: { cpu: 500m, memory: 1Gi }
                        limits: { cpu: '2', memory: 2Gi }
                      volumeMounts:
                        - name: maven-cache
                          mountPath: /root/.m2/repository
                    - name: kaniko
                      image: gcr.io/kaniko-project/executor:debug
                      command: ['sleep', 'infinity']
                      volumeMounts:
                        - name: docker-config
                          mountPath: /kaniko/.docker
                  volumes:
                    - name: maven-cache
                      persistentVolumeClaim:
                        claimName: maven-cache-pvc
                    - name: docker-config
                      secret:
                        secretName: docker-registry-config
            '''
        }
    }

    environment {
        REGISTRY = 'registry.example.com'
        APP_NAME = 'my-service'
        VERSION  = "${env.BUILD_NUMBER}-${env.GIT_COMMIT?.take(7) ?: 'unknown'}"
    }

    options {
        timeout(time: 30, unit: 'MINUTES')
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '20'))
        disableConcurrentBuilds()
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    env.GIT_AUTHOR = sh(
                        script: 'git log -1 --pretty=%an',
                        returnStdout: true
                    ).trim()
                }
            }
        }

        stage('Compile') {
            steps {
                container('maven') {
                    sh 'mvn compile -DskipTests -T 1C'
                }
            }
        }

        stage('Quality Checks') {
            parallel {
                stage('Unit Tests') {
                    steps {
                        container('maven') {
                            sh 'mvn test jacoco:report'
                        }
                    }
                    post {
                        always {
                            junit '**/target/surefire-reports/*.xml'
                            jacoco(
                                execPattern: '**/target/jacoco.exec',
                                minimumLineCoverage: '80',
                                changeBuildStatus: true
                            )
                        }
                    }
                }

                stage('Static Analysis') {
                    steps {
                        container('maven') {
                            sh 'mvn spotbugs:check pmd:check checkstyle:check'
                        }
                    }
                    post {
                        always {
                            recordIssues(
                                tools: [
                                    spotBugs(pattern: '**/spotbugsXml.xml'),
                                    pmdParser(pattern: '**/pmd.xml'),
                                    checkStyle(pattern: '**/checkstyle-result.xml')
                                ]
                            )
                        }
                    }
                }

                stage('Dependency Check') {
                    steps {
                        container('maven') {
                            sh 'mvn org.owasp:dependency-check-maven:check'
                        }
                    }
                    post {
                        always {
                            dependencyCheckPublisher pattern: '**/dependency-check-report.xml'
                        }
                    }
                }
            }
        }

        stage('Build Image') {
            when {
                anyOf {
                    branch 'main'
                    branch 'develop'
                    branch 'release/*'
                }
                beforeAgent true
            }
            steps {
                container('maven') {
                    sh 'mvn package -DskipTests'
                }
                container('kaniko') {
                    sh """
                        /kaniko/executor \
                          --context=dir:///workspace \
                          --destination=${REGISTRY}/${APP_NAME}:${VERSION} \
                          --cache=true \
                          --cache-repo=${REGISTRY}/${APP_NAME}/cache
                    """
                }
            }
        }
    }

    post {
        success {
            slackSend(
                channel: '#builds',
                color: 'good',
                message: "CI 성공: ${env.JOB_NAME} #${env.BUILD_NUMBER}\n" +
                         "Author: ${env.GIT_AUTHOR}\n" +
                         "Image: ${REGISTRY}/${APP_NAME}:${VERSION}"
            )
        }
        failure {
            slackSend(
                channel: '#builds',
                color: 'danger',
                message: "CI 실패: ${env.JOB_NAME} #${env.BUILD_NUMBER}\n" +
                         "Author: ${env.GIT_AUTHOR}\n" +
                         "Log: ${env.BUILD_URL}console"
            )
        }
    }
}
```

### CD Pipeline (GitOps with ArgoCD)

tart-infra 프로젝트에서는 Jenkins CI와 ArgoCD CD를 함께 사용한다. Jenkins가 이미지를 빌드하면, Git 매니페스트를 업데이트하고 ArgoCD가 이를 감지하여 배포한다.

```
┌────────────┐     ┌──────────────┐     ┌────────────────┐     ┌──────────────┐
│ Developer  │────>│ Source Repo  │────>│ Jenkins CI     │────>│ Image        │
│ git push   │     │ (app code)   │     │ Build & Test   │     │ Registry     │
└────────────┘     └──────────────┘     └───────┬────────┘     └──────────────┘
                                                │
                                                │ Update image tag
                                                ▼
                                        ┌───────────────┐
                                        │ GitOps Repo   │
                                        │ (manifests)   │
                                        └───────┬───────┘
                                                │ Detect change
                                                ▼
                                        ┌───────────────┐     ┌──────────────┐
                                        │ ArgoCD        │────>│ Kubernetes   │
                                        │ Auto Sync     │     │ Cluster      │
                                        └───────────────┘     └──────────────┘
```

```groovy
// Jenkinsfile - CD Pipeline (GitOps)
pipeline {
    agent {
        kubernetes {
            inheritFrom 'default'
        }
    }

    environment {
        REGISTRY     = 'registry.example.com'
        APP_NAME     = 'my-service'
        GITOPS_REPO  = 'https://github.com/org/gitops-manifests.git'
        GITOPS_CREDS = 'github-pat'
        IMAGE_TAG    = "${env.BUILD_NUMBER}"
    }

    parameters {
        choice(
            name: 'ENVIRONMENT',
            choices: ['dev', 'staging', 'prod'],
            description: '배포 대상 환경'
        )
        booleanParam(
            name: 'SKIP_APPROVAL',
            defaultValue: false,
            description: '승인 단계 건너뛰기 (dev 환경에만 적용)'
        )
    }

    stages {
        stage('Update GitOps Manifest') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: GITOPS_CREDS,
                    usernameVariable: 'GIT_USER',
                    passwordVariable: 'GIT_TOKEN'
                )]) {
                    sh """
                        git clone https://\${GIT_USER}:\${GIT_TOKEN}@github.com/org/gitops-manifests.git gitops
                        cd gitops

                        # kustomize로 이미지 태그 업데이트
                        cd overlays/${params.ENVIRONMENT}
                        kustomize edit set image \
                          ${REGISTRY}/${APP_NAME}:${IMAGE_TAG}

                        git config user.email "jenkins@example.com"
                        git config user.name "Jenkins CI"
                        git add -A
                        git commit -m "deploy: ${APP_NAME}:${IMAGE_TAG} to ${params.ENVIRONMENT}"
                        git push origin main
                    """
                }
            }
        }

        stage('Approval') {
            when {
                allOf {
                    expression { params.ENVIRONMENT == 'prod' }
                    expression { !params.SKIP_APPROVAL }
                }
                beforeAgent true
            }
            steps {
                input(
                    message: "Production 배포를 승인하시겠습니까?\n" +
                             "Image: ${REGISTRY}/${APP_NAME}:${IMAGE_TAG}",
                    ok: '배포 승인',
                    submitter: 'admin,deploy-team'
                )
            }
        }

        stage('ArgoCD Sync') {
            steps {
                withCredentials([string(
                    credentialsId: 'argocd-auth-token',
                    variable: 'ARGOCD_AUTH_TOKEN'
                )]) {
                    sh """
                        argocd app sync ${APP_NAME}-${params.ENVIRONMENT} \
                          --server argocd.jenkins.svc.cluster.local:443 \
                          --auth-token \$ARGOCD_AUTH_TOKEN \
                          --insecure \
                          --timeout 300
                    """
                }
            }
        }

        stage('Verify Deployment') {
            steps {
                withCredentials([file(
                    credentialsId: 'platform-kubeconfig',
                    variable: 'KUBECONFIG'
                )]) {
                    sh """
                        # Rollout 상태 확인
                        kubectl --kubeconfig=\$KUBECONFIG \
                          rollout status deployment/${APP_NAME} \
                          -n ${params.ENVIRONMENT} \
                          --timeout=300s

                        # Health check
                        ENDPOINT=\$(kubectl --kubeconfig=\$KUBECONFIG \
                          get svc ${APP_NAME} -n ${params.ENVIRONMENT} \
                          -o jsonpath='{.spec.clusterIP}')
                        curl -sf http://\${ENDPOINT}/health || exit 1

                        echo "배포 완료: ${APP_NAME}:${IMAGE_TAG} → ${params.ENVIRONMENT}"
                    """
                }
            }
        }
    }

    post {
        success {
            slackSend(
                channel: '#deploys',
                color: 'good',
                message: "배포 성공: ${APP_NAME}:${IMAGE_TAG} → ${params.ENVIRONMENT}"
            )
        }
        failure {
            slackSend(
                channel: '#alerts',
                color: 'danger',
                message: "배포 실패: ${APP_NAME}:${IMAGE_TAG} → ${params.ENVIRONMENT}\n" +
                         "담당자 확인 필요: ${env.BUILD_URL}"
            )
            // prod 환경 실패 시 자동 롤백
            script {
                if (params.ENVIRONMENT == 'prod') {
                    withCredentials([string(
                        credentialsId: 'argocd-auth-token',
                        variable: 'ARGOCD_AUTH_TOKEN'
                    )]) {
                        sh """
                            argocd app rollback ${APP_NAME}-prod \
                              --server argocd.jenkins.svc.cluster.local:443 \
                              --auth-token \$ARGOCD_AUTH_TOKEN \
                              --insecure
                        """
                    }
                }
            }
        }
    }
}
```

### Multi-Environment 전체 배포 Pipeline

```groovy
// Jenkinsfile - Multi-Environment Progressive Deployment
pipeline {
    agent none

    environment {
        REGISTRY = 'registry.example.com'
        APP_NAME = 'my-service'
    }

    stages {
        stage('Build & Test') {
            agent {
                kubernetes {
                    yaml '''
                        apiVersion: v1
                        kind: Pod
                        spec:
                          containers:
                            - name: builder
                              image: maven:3.9-eclipse-temurin-17
                              command: ['sleep', 'infinity']
                    '''
                }
            }
            steps {
                container('builder') {
                    checkout scm
                    sh 'mvn clean package'
                    stash includes: 'target/*.jar', name: 'app-jar'
                }
            }
            post {
                always {
                    junit '**/target/surefire-reports/*.xml'
                }
            }
        }

        stage('Build Image') {
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
                    '''
                }
            }
            steps {
                unstash 'app-jar'
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

        stage('Deploy to Dev') {
            steps {
                build job: 'deploy-pipeline',
                      parameters: [
                          string(name: 'IMAGE_TAG', value: env.BUILD_NUMBER),
                          string(name: 'ENVIRONMENT', value: 'dev'),
                          booleanParam(name: 'SKIP_APPROVAL', value: true)
                      ]
            }
        }

        stage('Deploy to Staging') {
            when {
                branch 'main'
                beforeAgent true
            }
            steps {
                build job: 'deploy-pipeline',
                      parameters: [
                          string(name: 'IMAGE_TAG', value: env.BUILD_NUMBER),
                          string(name: 'ENVIRONMENT', value: 'staging'),
                          booleanParam(name: 'SKIP_APPROVAL', value: true)
                      ]
            }
        }

        stage('Performance Test') {
            when {
                branch 'main'
                beforeAgent true
            }
            agent {
                kubernetes {
                    yaml '''
                        apiVersion: v1
                        kind: Pod
                        spec:
                          containers:
                            - name: k6
                              image: grafana/k6:latest
                              command: ['sleep', 'infinity']
                    '''
                }
            }
            steps {
                container('k6') {
                    sh 'k6 run --vus 50 --duration 5m tests/load-test.js'
                }
            }
        }

        stage('Deploy to Production') {
            when {
                branch 'main'
                beforeAgent true
            }
            steps {
                build job: 'deploy-pipeline',
                      parameters: [
                          string(name: 'IMAGE_TAG', value: env.BUILD_NUMBER),
                          string(name: 'ENVIRONMENT', value: 'prod'),
                          booleanParam(name: 'SKIP_APPROVAL', value: false)
                      ]
            }
        }
    }
}
```

### tart-infra 프로젝트 전용 파이프라인

tart-infra 프로젝트에서 실제로 사용할 수 있는 인프라 검증 파이프라인이다. `manifests/jenkins/demo-pipeline.yaml`의 7단계 파이프라인을 기반으로 한다.

```groovy
// Jenkinsfile - tart-infra 인프라 검증 파이프라인
pipeline {
    agent {
        kubernetes {
            inheritFrom 'default'
        }
    }

    environment {
        KUBECONFIG   = '/kubeconfig/platform.yaml'
        DEV_CONFIG   = '/kubeconfig/dev.yaml'
        NAMESPACE    = 'demo'
        ARGOCD_APP   = 'demo-apps'
    }

    options {
        timeout(time: 20, unit: 'MINUTES')
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    stages {
        stage('Validate Manifests') {
            steps {
                sh '''
                    echo "=== Validating Kubernetes manifests ==="
                    ERRORS=0
                    for f in manifests/demo/*.yaml manifests/hpa/*.yaml; do
                        if ! kubectl --kubeconfig ${DEV_CONFIG} apply --dry-run=client -f "$f" 2>&1; then
                            ERRORS=$((ERRORS + 1))
                        fi
                    done
                    [ $ERRORS -eq 0 ] || exit 1
                '''
            }
        }

        stage('Security Scan') {
            steps {
                sh '''
                    echo "=== Security checks ==="
                    ISSUES=0
                    for f in manifests/demo/*.yaml; do
                        # 하드코딩된 시크릿 검사
                        if grep -qiE '(password|secret|token).*:.*[A-Za-z0-9]{8,}' "$f" 2>/dev/null; then
                            echo "WARNING: Potential secret in $f"
                            ISSUES=$((ISSUES + 1))
                        fi
                        # 리소스 제한 검사
                        if ! grep -q 'limits:' "$f"; then
                            echo "WARN: $f missing resource limits"
                        fi
                        # latest 태그 검사
                        if grep -qE 'image:.*:latest' "$f"; then
                            echo "WARN: $f uses :latest tag"
                        fi
                    done
                '''
            }
        }

        stage('Deploy via ArgoCD') {
            steps {
                sh '''
                    argocd app sync ${ARGOCD_APP} --timeout 180 \
                        || echo "ArgoCD sync triggered (async)"
                '''
            }
        }

        stage('Health Verification') {
            parallel {
                stage('Wait for Rollouts') {
                    steps {
                        sh '''
                            DEPLOYMENTS="nginx-web httpbin redis postgres rabbitmq keycloak"
                            for deploy in $DEPLOYMENTS; do
                                kubectl --kubeconfig ${DEV_CONFIG} -n ${NAMESPACE} \
                                    rollout status deploy/$deploy --timeout=180s 2>/dev/null \
                                    && echo "$deploy: READY" \
                                    || echo "$deploy: FAILED"
                            done
                        '''
                    }
                }
                stage('Check HPA & Services') {
                    steps {
                        sh '''
                            kubectl --kubeconfig ${DEV_CONFIG} -n ${NAMESPACE} get hpa
                            kubectl --kubeconfig ${DEV_CONFIG} -n ${NAMESPACE} get svc
                            kubectl --kubeconfig ${DEV_CONFIG} -n ${NAMESPACE} get cnp 2>/dev/null \
                                || echo "(CiliumNetworkPolicy CRD not available)"
                        '''
                    }
                }
            }
        }

        stage('Integration Tests') {
            steps {
                sh '''
                    DEV_IP=$(kubectl --kubeconfig ${DEV_CONFIG} get nodes \
                        -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
                    PASS=0; FAIL=0

                    # nginx
                    curl -sf --max-time 10 "http://${DEV_IP}:30080" > /dev/null 2>&1 \
                        && { echo "PASS: nginx"; PASS=$((PASS + 1)); } \
                        || { echo "FAIL: nginx"; FAIL=$((FAIL + 1)); }

                    # Keycloak
                    curl -sf --max-time 15 "http://${DEV_IP}:30880" > /dev/null 2>&1 \
                        && { echo "PASS: Keycloak"; PASS=$((PASS + 1)); } \
                        || { echo "FAIL: Keycloak"; FAIL=$((FAIL + 1)); }

                    # Redis
                    kubectl --kubeconfig ${DEV_CONFIG} -n ${NAMESPACE} exec deploy/redis -- \
                        redis-cli ping 2>/dev/null | grep -q PONG \
                        && { echo "PASS: Redis"; PASS=$((PASS + 1)); } \
                        || { echo "FAIL: Redis"; FAIL=$((FAIL + 1)); }

                    # PostgreSQL
                    kubectl --kubeconfig ${DEV_CONFIG} -n ${NAMESPACE} exec deploy/postgres -- \
                        pg_isready -U demo -d demo 2>/dev/null \
                        && { echo "PASS: PostgreSQL"; PASS=$((PASS + 1)); } \
                        || { echo "FAIL: PostgreSQL"; FAIL=$((FAIL + 1)); }

                    echo "Results: $PASS passed, $FAIL failed"
                    [ $FAIL -eq 0 ] || exit 1
                '''
            }
        }

        stage('E2E Smoke Test') {
            steps {
                sh '''
                    DEV_IP=$(kubectl --kubeconfig ${DEV_CONFIG} get nodes \
                        -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')

                    # L7 Policy: GET 허용, POST 차단 검증
                    GET_CODE=$(kubectl --kubeconfig ${DEV_CONFIG} -n ${NAMESPACE} \
                        exec deploy/nginx-web -c nginx -- \
                        curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
                        "http://httpbin.${NAMESPACE}.svc.cluster.local/get" || echo "000")
                    echo "nginx -> httpbin GET: HTTP $GET_CODE"

                    POST_CODE=$(kubectl --kubeconfig ${DEV_CONFIG} -n ${NAMESPACE} \
                        exec deploy/nginx-web -c nginx -- \
                        curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
                        -X POST "http://httpbin.${NAMESPACE}.svc.cluster.local/post" || echo "000")
                    echo "nginx -> httpbin POST: HTTP $POST_CODE (expected: blocked)"

                    # Keycloak health
                    KC_HEALTH=$(curl -sf --max-time 10 \
                        "http://${DEV_IP}:30880/health/ready" || echo '{"status":"DOWN"}')
                    echo "Keycloak health: $KC_HEALTH"

                    echo "=== Pipeline complete ==="
                    echo "nginx:    http://${DEV_IP}:30080"
                    echo "keycloak: http://${DEV_IP}:30880"
                '''
            }
        }
    }

    post {
        success {
            echo "Pipeline SUCCESS: All stages passed. Infrastructure verified."
        }
        failure {
            echo "Pipeline FAILED: Check stage logs for details."
        }
        always {
            echo "Pipeline finished: ${currentBuild.result ?: 'SUCCESS'}"
        }
    }
}
```

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

### 실습 6: JCasC로 Jenkins 설정 관리
```bash
# 1. JCasC 설정 파일을 ConfigMap으로 생성
kubectl create configmap jenkins-casc-config \
  --from-file=jenkins.yaml=jenkins-casc.yaml \
  -n jenkins --kubeconfig=kubeconfig/platform.yaml

# 2. Jenkins Pod에서 설정 리로드
# Manage Jenkins > Configuration as Code > Reload existing configuration

# 3. 또는 API로 리로드
CRUMB=$(curl -s -u admin:$(kubectl get secret jenkins -n jenkins \
  -o jsonpath='{.data.jenkins-admin-password}' | base64 -d) \
  'http://localhost:8080/crumbIssuer/api/json' | jq -r '.crumb')

curl -X POST -u admin:$PASSWORD \
  -H "Jenkins-Crumb: ${CRUMB}" \
  'http://localhost:8080/configuration-as-code/reload'
```

### 실습 7: Kubernetes Agent 디버깅
```bash
# Agent Pod 확인
kubectl get pods -n jenkins -l jenkins=agent \
  --kubeconfig=kubeconfig/platform.yaml

# Agent Pod 로그 확인
kubectl logs <agent-pod-name> -c jnlp -n jenkins \
  --kubeconfig=kubeconfig/platform.yaml

# Agent Pod 이벤트 확인
kubectl describe pod <agent-pod-name> -n jenkins \
  --kubeconfig=kubeconfig/platform.yaml

# Jenkins Controller 로그에서 Agent 관련 확인
kubectl logs deploy/jenkins -n jenkins --tail=100 \
  --kubeconfig=kubeconfig/platform.yaml | grep -i agent
```

### 실습 8: Shared Library 설정
```
1. GitHub에 Shared Library 리포지토리를 생성한다
2. vars/ 디렉토리에 공유 함수를 작성한다
3. Manage Jenkins > System > Global Pipeline Libraries에서 등록한다
4. Jenkinsfile에서 @Library('my-library') _ 로 사용한다
```

### 실습 9: Prometheus 메트릭 확인
```bash
# Jenkins Prometheus 메트릭 확인
kubectl port-forward -n jenkins svc/jenkins 8080:8080 \
  --kubeconfig=kubeconfig/platform.yaml

# 메트릭 엔드포인트 조회
curl -s http://localhost:8080/prometheus/ | head -50

# 특정 메트릭 확인
curl -s http://localhost:8080/prometheus/ | grep jenkins_queue_size
curl -s http://localhost:8080/prometheus/ | grep jenkins_executor
curl -s http://localhost:8080/prometheus/ | grep jenkins_node_online
```

### 실습 10: Pipeline 성능 최적화
```groovy
// 최적화 전: 순차 실행 (느림)
pipeline {
    agent any
    stages {
        stage('Unit Test')        { steps { sh 'make test-unit' } }
        stage('Integration Test') { steps { sh 'make test-integration' } }
        stage('Lint')             { steps { sh 'make lint' } }
        stage('Security Scan')    { steps { sh 'make security-scan' } }
    }
}

// 최적화 후: 병렬 실행 + 캐싱 + shallow clone
pipeline {
    agent {
        kubernetes {
            yaml '''
                apiVersion: v1
                kind: Pod
                spec:
                  containers:
                    - name: builder
                      image: node:20
                      command: ['sleep', 'infinity']
                      volumeMounts:
                        - name: npm-cache
                          mountPath: /root/.npm
                  volumes:
                    - name: npm-cache
                      persistentVolumeClaim:
                        claimName: npm-cache-pvc
            '''
        }
    }
    options {
        skipDefaultCheckout()
        durabilityHint('PERFORMANCE_OPTIMIZED')
    }
    stages {
        stage('Checkout') {
            steps {
                checkout([$class: 'GitSCM',
                    branches: [[name: '*/main']],
                    extensions: [[$class: 'CloneOption', depth: 1, shallow: true]],
                    userRemoteConfigs: [[url: 'https://github.com/org/repo.git']]
                ])
            }
        }
        stage('Install') {
            steps {
                container('builder') {
                    sh 'npm ci --cache /root/.npm'
                }
            }
        }
        stage('Quality Checks') {
            parallel {
                stage('Unit Test')        { steps { container('builder') { sh 'npm run test:unit' } } }
                stage('Integration Test') { steps { container('builder') { sh 'npm run test:integration' } } }
                stage('Lint')             { steps { container('builder') { sh 'npm run lint' } } }
                stage('Security Scan')    { steps { container('builder') { sh 'npm audit' } } }
            }
        }
    }
    post {
        cleanup { cleanWs() }
    }
}
```

---

