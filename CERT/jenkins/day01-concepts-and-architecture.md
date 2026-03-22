# Day 1: Jenkins 개념과 아키텍처

Jenkins의 기본 개념, CI/CD 핵심 용어, Controller-Agent 분산 빌드 아키텍처, 그리고 tart-infra 프로젝트에서의 Jenkins 실습 환경을 다룬다.

---

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

#### tart-infra 프로젝트의 Jenkins 설치 상세

`scripts/install/08-install-cicd.sh` 스크립트는 ArgoCD와 Jenkins를 함께 설치한다. Jenkins 설치 과정은 다음과 같다.

```bash
# 1. local-path-provisioner 설치 (Jenkins PVC용)
kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.28/deploy/local-path-storage.yaml
kubectl patch storageclass local-path -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'

# 2. jenkins 네임스페이스 생성
kubectl create namespace jenkins

# 3. Helm Chart로 Jenkins 설치
helm repo add jenkins https://charts.jenkins.io
helm upgrade --install jenkins jenkins/jenkins \
  --kubeconfig kubeconfig/platform.yaml \
  --namespace jenkins \
  --values manifests/jenkins-values.yaml \
  --wait --timeout 10m
```

설치 후 접속 정보는 다음과 같다.

| 항목 | 값 |
|------|-----|
| URL | `http://<platform-worker-ip>:30900` |
| 사용자명 | `admin` |
| 비밀번호 | `kubectl get secret jenkins -n jenkins -o jsonpath='{.data.jenkins-admin-password}' \| base64 -d` |
| JNLP 포트 | `50000` (Agent 연결용) |
| kubeconfig | `kubeconfig/platform.yaml` |

#### 프로젝트 데모 파이프라인 구조

`manifests/jenkins/demo-pipeline.yaml`에 정의된 7단계 파이프라인은 tart-infra 프로젝트의 전체 인프라를 검증한다.

```
Stage 1: Validate Manifests    → kubectl --dry-run=client으로 매니페스트 문법 검증
Stage 2: Security Scan         → 하드코딩된 시크릿, 리소스 제한, :latest 태그 검사
Stage 3: Deploy to Dev         → ArgoCD app sync로 GitOps 배포 트리거
Stage 4: Wait for Rollouts     → nginx, httpbin, redis, postgres, rabbitmq, keycloak 롤아웃 대기
Stage 5: Health Check          → Pod 상태, HPA, Service, CiliumNetworkPolicy 확인
Stage 6: Integration Test      → 각 서비스 응답 확인 (nginx 30080, Keycloak 30880, Redis PING 등)
Stage 7: Smoke Test            → E2E 체인 검증, L7 정책 검증, Keycloak health 확인
```

이 파이프라인은 Kubernetes Agent를 사용하며, `inheritFrom 'default'`로 기본 PodTemplate을 상속받는다. `KUBECONFIG`는 `/kubeconfig/dev.yaml`로 dev 클러스터를 대상으로 한다.

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

## 아키텍처 심화

### Jenkins 내부 구조

Jenkins는 단순한 CI 도구를 넘어, 정교한 Java 애플리케이션 아키텍처를 갖추고 있다. 내부 동작을 이해하면 트러블슈팅과 최적화에 큰 도움이 된다.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Jenkins Controller JVM                       │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Stapler Web Framework                   │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │  │ Jelly    │  │ REST API │  │ CLI      │  │ WebSocket│  │  │
│  │  │ Views    │  │ Endpoint │  │ Handler  │  │ Handler  │  │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Core Engine                             │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │  │ Queue    │  │ Executor │  │ Security │  │ SCM      │  │  │
│  │  │ Manager  │  │ Service  │  │ Realm    │  │ Manager  │  │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │  │ Trigger  │  │ Artifact │  │ Log      │  │ Finger-  │  │  │
│  │  │ System   │  │ Manager  │  │ Storage  │  │ printing │  │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Plugin System                           │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │  │ Plugin   │  │ Extension │  │ Class    │  │ Dependency│ │  │
│  │  │ Manager  │  │ Points   │  │ Loader   │  │ Resolver  │ │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Remoting Layer                          │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐               │  │
│  │  │ JNLP     │  │ SSH      │  │ WebSocket│               │  │
│  │  │ Channel  │  │ Channel  │  │ Channel  │               │  │
│  │  └──────────┘  └──────────┘  └──────────┘               │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Stapler Web Framework

Stapler는 Jenkins의 웹 레이어를 담당하는 프레임워크이다. URL 경로를 Java 객체 그래프에 자동으로 매핑한다.

**URL-to-Object Mapping 원리:**

```
URL: /job/my-pipeline/42/console

매핑 과정:
  Jenkins.getInstance()          → /
  .getItem("my-pipeline")       → /job/my-pipeline
  .getBuildByNumber(42)          → /job/my-pipeline/42
  .doConsole(req, rsp)           → /job/my-pipeline/42/console
```

Stapler는 다음 규칙으로 URL 세그먼트를 Java 메서드에 매핑한다.

| URL 패턴 | Java 메서드 | 설명 |
|-----------|------------|------|
| `/foo` | `getFoo()` | getter 메서드 호출이다 |
| `/foo` | `doFoo(req, rsp)` | action 메서드 호출이다 |
| `/foo` | `getDynamic("foo", req, rsp)` | 동적 디스패치이다 |

**Jelly/Groovy View:**

Jenkins UI는 Jelly XML 또는 Groovy 템플릿으로 렌더링된다. 각 Model 클래스는 대응하는 View 파일을 가진다.

```
src/main/java/hudson/model/FreeStyleProject.java
src/main/resources/hudson/model/FreeStyleProject/
  ├── config.jelly          # 설정 페이지
  ├── index.jelly           # 메인 페이지
  ├── sidepanel.jelly       # 사이드 패널
  └── help-description.html # 도움말
```

### Plugin System 심화

Jenkins의 강력함은 플러그인 시스템에서 나온다. 플러그인은 Extension Point 패턴으로 핵심 기능을 확장한다.

**Extension Point 패턴:**

```java
// Jenkins 코어에서 Extension Point 정의
public abstract class SCM extends Describable<SCM> implements ExtensionPoint {
    public abstract void checkout(Run<?,?> build, Launcher launcher,
                                   FilePath workspace, TaskListener listener,
                                   File changelogFile, SCMRevisionState baseline);
}

// 플러그인에서 Extension Point 구현
@Extension
public class GitSCM extends SCM {
    @Override
    public void checkout(...) {
        // Git-specific checkout 구현
    }
}
```

주요 Extension Point 목록:

| Extension Point | 용도 | 대표 구현체 |
|----------------|------|------------|
| `SCM` | 소스 코드 관리 | GitSCM, SubversionSCM |
| `Builder` | 빌드 스텝 | ShellScript, Maven |
| `Publisher` | 빌드 후 처리 | JUnitResultArchiver, Mailer |
| `Trigger` | 빌드 트리거 | SCMTrigger, TimerTrigger |
| `Cloud` | Agent 클라우드 | KubernetesCloud, EC2Cloud |
| `CredentialsProvider` | Credential 제공 | SystemCredentialsProvider |
| `SecurityRealm` | 인증 제공자 | LDAPSecurityRealm, HudsonPrivateSecurityRealm |
| `AuthorizationStrategy` | 권한 전략 | RoleBasedAuthorizationStrategy |
| `QueueDecisionHandler` | 큐 의사 결정 | 빌드 실행 여부 판단 |
| `NodeProvisioner.Strategy` | Node 프로비저닝 전략 | 동적 Agent 생성 |

**ClassLoader 계층 구조:**

Jenkins는 복잡한 ClassLoader 계층을 통해 플러그인 간 격리와 의존성 해결을 수행한다.

```
Bootstrap ClassLoader (JDK core)
  └── System ClassLoader (jenkins.war/WEB-INF/lib)
        └── Jenkins ClassLoader (jenkins-core.jar)
              ├── Plugin ClassLoader A (plugin-a.hpi)
              │     └── 의존하는 Plugin ClassLoader 참조
              ├── Plugin ClassLoader B (plugin-b.hpi)
              └── Plugin ClassLoader C (plugin-c.hpi)
```

각 플러그인은 독립적인 ClassLoader를 가지며, `MANIFEST.MF`의 `Plugin-Dependencies` 헤더에 선언된 의존성만 참조할 수 있다. 이 구조 때문에 플러그인 간 클래스 충돌이 발생할 수 있으며, 이를 해결하려면 의존성 버전을 맞추거나 플러그인을 업데이트해야 한다.

**플러그인 파일 구조 (.hpi/.jpi):**

```
my-plugin.hpi (실제로는 ZIP 파일)
├── META-INF/
│   └── MANIFEST.MF           # 플러그인 메타데이터
│       # Plugin-Version: 1.0
│       # Jenkins-Version: 2.387.3
│       # Plugin-Dependencies: credentials:1311,git:5.2.0
├── WEB-INF/
│   ├── classes/               # 컴파일된 클래스 파일
│   └── lib/                   # 의존성 JAR
└── (Jelly/Groovy views)       # UI 템플릿
```

### Remoting Protocol 심화

Jenkins Remoting은 Controller와 Agent 간의 양방향 RPC(Remote Procedure Call) 프레임워크이다.

**통신 채널 유형:**

| 채널 유형 | 포트 | 방향 | 특징 |
|-----------|------|------|------|
| JNLP4 (TCP) | 50000 (기본) | Agent → Controller | 가장 일반적이다. 방화벽 뒤 Agent에 유용하다 |
| JNLP4 over WebSocket | 80/443 | Agent → Controller | HTTP 프록시 통과가 가능하다 |
| SSH | 22 (Agent) | Controller → Agent | Controller가 Agent에 SSH로 연결한다 |

**JNLP 연결 수립 과정:**

```
Agent                                    Controller
  │                                          │
  │  1. HTTP GET /jnlpJars/agent.jar         │
  │ ────────────────────────────────────────> │
  │  2. agent.jar 다운로드                     │
  │ <──────────────────────────────────────── │
  │                                          │
  │  3. java -jar agent.jar -url URL         │
  │     -secret SECRET -name AGENT_NAME      │
  │                                          │
  │  4. TCP 연결 (포트 50000)                  │
  │ ────────────────────────────────────────> │
  │                                          │
  │  5. JNLP4-connect 프로토콜 핸드셰이크       │
  │ <──────────────────────────────────────> │
  │                                          │
  │  6. Secret 기반 인증                       │
  │ <──────────────────────────────────────> │
  │                                          │
  │  7. 양방향 Remoting 채널 수립               │
  │ <═══════════════════════════════════════> │
  │                                          │
  │  8. 빌드 명령 전송 / 결과 반환              │
  │ <═══════════════════════════════════════> │
```

**Remoting Channel의 동작 원리:**

Remoting 채널은 Java 직렬화를 기반으로 객체를 전송한다. Controller에서 Agent로 `Callable` 객체를 전송하면, Agent 측 JVM에서 해당 `Callable.call()` 메서드가 실행되고 결과가 Controller로 반환된다.

```java
// Controller 측에서 Agent로 작업 위임 (내부 동작 원리)
FilePath workspace = new FilePath(agent.getChannel(), "/workspace/my-job");
workspace.act(new FileCallable<String>() {
    @Override
    public String invoke(File f, VirtualChannel channel) {
        // 이 코드는 Agent JVM에서 실행된다
        return f.listFiles().length + " files found";
    }
});
```

**보안 고려사항:**

- Remoting 채널은 암호화되지 않으므로, 네트워크 레벨에서 TLS/VPN을 사용해야 한다
- Agent → Controller 방향의 파일 시스템 접근은 기본적으로 차단된다 (Agent-to-Controller Security)
- Secret 기반 인증으로 Agent 위변조를 방지한다
- WebSocket 모드를 사용하면 기존 HTTPS 인프라를 재활용할 수 있다

### Jenkins 데이터 저장 구조

Jenkins는 모든 설정과 빌드 데이터를 `JENKINS_HOME` 디렉토리에 파일 시스템으로 저장한다.

```
$JENKINS_HOME/
├── config.xml                     # Jenkins 전역 설정
├── credentials.xml                # 암호화된 Credential 저장소
├── secrets/                       # 마스터 암호화 키
│   ├── master.key                 # 마스터 키
│   ├── hudson.util.Secret         # 비밀 암호화 키
│   └── initialAdminPassword       # 초기 관리자 비밀번호
├── jobs/                          # 모든 Job 설정 및 빌드 이력
│   ├── my-pipeline/
│   │   ├── config.xml             # Job 설정
│   │   ├── nextBuildNumber        # 다음 빌드 번호
│   │   └── builds/
│   │       ├── 1/
│   │       │   ├── build.xml      # 빌드 메타데이터
│   │       │   ├── log            # 콘솔 출력 로그
│   │       │   └── changelog.xml  # 변경 이력
│   │       └── 2/
│   │           └── ...
│   └── my-multibranch/
│       ├── config.xml
│       └── branches/
│           ├── main/
│           └── develop/
├── nodes/                         # Agent(Node) 설정
│   ├── agent-1/
│   │   └── config.xml
│   └── agent-2/
│       └── config.xml
├── plugins/                       # 설치된 플러그인
│   ├── git.jpi
│   ├── git/                       # 언팩된 플러그인 파일
│   └── kubernetes.jpi
├── users/                         # 사용자 데이터
│   └── admin/
│       └── config.xml
├── workspace/                     # 빌드 작업 공간 (Controller 실행 시)
├── logs/                          # Jenkins 시스템 로그
│   └── tasks/
└── updates/                       # 플러그인 업데이트 정보
    └── default.json
```

`JENKINS_HOME`의 백업은 곧 Jenkins 전체 상태의 백업이다. 특히 `config.xml`, `credentials.xml`, `secrets/`, `jobs/*/config.xml`은 반드시 백업해야 한다.

---

