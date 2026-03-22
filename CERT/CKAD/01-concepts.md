# CKAD 핵심 개념 정리

> CKAD(Certified Kubernetes Application Developer)는 Kubernetes 환경에서 애플리케이션을 설계, 빌드, 배포, 운영하는 능력을 검증하는 **실기 시험**이다.
> 시험 시간은 2시간이며, 실제 클러스터에서 kubectl을 사용하여 문제를 풀어야 한다.

---

## 1. Application Design and Build (20%)

애플리케이션을 컨테이너 이미지로 빌드하고, 멀티 컨테이너 패턴을 활용하여 Pod를 설계하는 영역이다.

### 1.1 Dockerfile 최적화

컨테이너 이미지 크기를 줄이고 보안을 강화하는 것이 핵심이다.

**멀티스테이지 빌드**

빌드 환경과 런타임 환경을 분리하여 최종 이미지 크기를 최소화하는 기법이다.

- 1단계(builder): 소스 코드 컴파일, 의존성 설치 등 빌드 작업을 수행한다.
- 2단계(runtime): 빌드 결과물만 복사하여 경량 베이스 이미지 위에서 실행한다.
- 빌드 도구, 소스 코드, 중간 산출물이 최종 이미지에 포함되지 않으므로 이미지 크기가 대폭 줄어든다.

**.dockerignore**

빌드 컨텍스트에서 불필요한 파일을 제외하여 빌드 속도를 높이고 이미지에 민감 정보가 포함되는 것을 방지한다.

- `.git`, `node_modules`, `*.md`, `.env` 등을 제외하는 것이 일반적이다.

**이미지 크기 최적화 전략**

- 경량 베이스 이미지 사용: `alpine`, `distroless`, `scratch`
- RUN 명령 체이닝: 여러 명령을 `&&`로 연결하여 레이어 수를 줄인다.
- 불필요한 패키지 설치 금지: `--no-install-recommends` 옵션 활용
- 캐시 정리: `apt-get clean && rm -rf /var/lib/apt/lists/*`

### 1.2 Init Container

Pod의 메인 컨테이너가 시작되기 **전에** 순차적으로 실행되는 컨테이너이다.

**특징**

- 모든 init container가 성공적으로 완료되어야 메인 컨테이너가 시작된다.
- 여러 init container가 있으면 정의된 순서대로 하나씩 실행된다.
- init container가 실패하면 Pod의 `restartPolicy`에 따라 재시도한다.
- init container는 메인 컨테이너와 다른 이미지를 사용할 수 있다.

**주요 용도**

- 외부 서비스가 준비될 때까지 대기 (예: DB가 올라올 때까지 wait)
- 설정 파일 생성 또는 다운로드
- 데이터베이스 스키마 마이그레이션
- Git 저장소에서 소스 코드 클론
- 보안 토큰 획득

**실행 순서 정리**

1. Pod 스케줄링 -> Node 배정
2. init container 1 실행 -> 완료
3. init container 2 실행 -> 완료
4. 메인 컨테이너 시작

### 1.3 Sidecar Container

메인 컨테이너와 함께 동일 Pod에서 실행되면서 보조 기능을 제공하는 컨테이너이다.

**Sidecar 패턴**

메인 컨테이너의 기능을 확장하거나 보강하는 패턴이다.

- 로그 수집 에이전트: 메인 앱이 파일에 쓴 로그를 수집하여 외부 시스템으로 전송한다.
- 파일 동기화: Git 저장소와 로컬 볼륨을 주기적으로 동기화한다.
- Istio envoy proxy: 서비스 메시의 사이드카로 트래픽을 가로채어 mTLS, 라우팅 등을 처리한다.

**Ambassador 패턴**

메인 컨테이너를 대신하여 외부 서비스에 대한 연결을 프록시하는 패턴이다.

- 메인 앱은 localhost로 요청하고, ambassador 컨테이너가 실제 외부 서비스로 라우팅한다.
- 예: localhost:6379로 요청하면 ambassador가 적절한 Redis 샤드로 라우팅한다.

**Adapter 패턴**

메인 컨테이너의 출력을 표준화하거나 변환하는 패턴이다.

- 다양한 형식의 로그를 통일된 형식으로 변환한다.
- 메트릭 데이터를 Prometheus가 수집할 수 있는 형식으로 변환한다.

### 1.4 Volume

Pod 내 컨테이너 간 데이터를 공유하거나, 컨테이너 재시작 시에도 데이터를 보존하기 위한 저장소이다.

**emptyDir**

- Pod가 생성될 때 빈 디렉토리가 만들어지고, Pod가 삭제되면 함께 삭제된다.
- 동일 Pod 내 컨테이너 간 임시 데이터 공유에 사용한다.
- `medium: Memory`를 지정하면 tmpfs(RAM 기반)로 마운트된다.

**configMap Volume**

- ConfigMap의 데이터를 파일로 마운트한다.
- 각 key가 파일명이 되고, value가 파일 내용이 된다.
- `subPath`를 사용하면 특정 key만 단일 파일로 마운트할 수 있다.

**secret Volume**

- Secret의 데이터를 파일로 마운트한다.
- 기본적으로 tmpfs에 마운트되어 디스크에 기록되지 않는다.
- `defaultMode`로 파일 권한을 설정할 수 있다 (기본값: 0644).

**PersistentVolumeClaim (PVC)**

- PersistentVolume(PV)에 대한 사용 요청이다.
- `accessModes`: ReadWriteOnce(RWO), ReadOnlyMany(ROX), ReadWriteMany(RWX)
- `storageClassName`을 지정하여 동적 프로비저닝을 활용할 수 있다.
- Pod가 삭제되어도 PVC와 PV는 유지된다 (`persistentVolumeReclaimPolicy`에 따라 다름).

### 1.5 Multi-container Pod 패턴 상세

하나의 Pod에 여러 컨테이너를 배치하는 이유와 패턴을 이해해야 한다.

**공유 리소스**

- 네트워크: 동일 Pod 내 컨테이너는 같은 IP 주소와 포트 공간을 공유한다. `localhost`로 상호 통신이 가능하다.
- 볼륨: `volumes`에 정의한 볼륨을 여러 컨테이너가 마운트하여 데이터를 공유한다.
- 프로세스 네임스페이스: `shareProcessNamespace: true`를 설정하면 프로세스 목록을 공유한다.

**설계 원칙**

- 단일 책임 원칙: 각 컨테이너는 하나의 역할만 담당한다.
- 밀접한 결합: 함께 배포, 스케일링, 관리되어야 하는 경우에만 같은 Pod에 배치한다.
- 독립적 운영이 가능한 서비스는 별도 Pod로 분리하는 것이 원칙이다.

---

## 2. Application Deployment (20%)

애플리케이션의 배포 전략, 업데이트, 롤백을 관리하는 영역이다.

### 2.1 Deployment 전략

**Rolling Update (기본값)**

Pod를 점진적으로 교체하는 전략이다. 다운타임 없이 업데이트가 가능하다.

- `maxSurge`: 업데이트 중 desired 수 대비 추가로 생성할 수 있는 최대 Pod 수이다. 기본값은 25%이다.
- `maxUnavailable`: 업데이트 중 사용 불가능한 최대 Pod 수이다. 기본값은 25%이다.
- 예: replicas=4, maxSurge=1, maxUnavailable=1이면 업데이트 중 최소 3개, 최대 5개 Pod가 존재한다.

**Recreate**

모든 기존 Pod를 먼저 삭제한 후 새 Pod를 생성하는 전략이다.

- 다운타임이 발생한다.
- 구버전과 신버전이 동시에 존재하면 안 되는 경우에 사용한다 (예: DB 스키마 변경).

**Rollback**

- `kubectl rollout undo deployment/<name>`: 직전 버전으로 롤백한다.
- `kubectl rollout undo deployment/<name> --to-revision=N`: 특정 리비전으로 롤백한다.
- `kubectl rollout history deployment/<name>`: 리비전 히스토리를 확인한다.
- `kubectl rollout status deployment/<name>`: 롤아웃 진행 상태를 확인한다.

### 2.2 Blue-Green 배포

구버전(Blue)과 신버전(Green) 두 환경을 동시에 운영하고, Service의 selector를 전환하여 트래픽을 한 번에 이동시키는 방식이다.

**구현 방법**

1. Blue Deployment (현재 버전)가 Service에 연결되어 트래픽을 처리한다.
2. Green Deployment (새 버전)를 별도로 배포한다.
3. Green이 정상 동작하는지 확인한다.
4. Service의 `selector` label을 Green으로 변경하여 트래픽을 전환한다.
5. Blue를 유지하다가 문제가 없으면 삭제한다.

**장점**: 즉각적인 롤백이 가능하다 (selector만 다시 변경).
**단점**: 두 배의 리소스가 필요하다.

### 2.3 Canary 배포

신버전을 소수의 사용자에게만 먼저 노출하여 검증한 후 점진적으로 확대하는 방식이다.

**Kubernetes 네이티브 방식**

- 동일한 label을 가진 두 Deployment를 생성하되 replica 비율로 트래픽을 조절한다.
- 예: v1 replicas=9, v2 replicas=1 -> 약 10%의 트래픽이 v2로 향한다.

**Istio VirtualService 방식**

- `weight` 필드를 사용하여 정밀한 트래픽 비율을 지정할 수 있다.
- replica 수와 무관하게 트래픽 비율을 제어할 수 있다.

### 2.4 Helm 기본

Kubernetes 패키지 매니저이다. Chart를 사용하여 애플리케이션을 템플릿화하고 배포한다.

**Chart 구조**

```
mychart/
  Chart.yaml          # 차트 메타데이터 (name, version, appVersion)
  values.yaml         # 기본 설정값
  templates/          # Kubernetes 매니페스트 템플릿
    deployment.yaml
    service.yaml
    _helpers.tpl      # 템플릿 헬퍼 함수
  charts/             # 의존성 차트
```

**주요 명령어**

- `helm install <release> <chart>`: 차트를 설치한다.
- `helm upgrade <release> <chart>`: 릴리스를 업그레이드한다.
- `helm rollback <release> <revision>`: 특정 리비전으로 롤백한다.
- `helm uninstall <release>`: 릴리스를 삭제한다.
- `helm list`: 설치된 릴리스 목록을 확인한다.
- `helm repo add/update/list`: 차트 저장소를 관리한다.
- `helm template <chart>`: 렌더링된 매니페스트를 미리 확인한다.

**Values 오버라이드**

- `--set key=value`: 명령줄에서 개별 값을 지정한다.
- `-f custom-values.yaml`: 사용자 정의 values 파일을 지정한다.

### 2.5 Kustomize

별도의 템플릿 엔진 없이 Kubernetes 매니페스트를 환경별로 커스터마이징하는 도구이다.

**base/overlay 구조**

```
kustomize/
  base/
    kustomization.yaml    # resources 목록
    deployment.yaml
    service.yaml
  overlays/
    dev/
      kustomization.yaml  # bases 참조 + patches
      patch.yaml
    prod/
      kustomization.yaml
      patch.yaml
```

**kustomization.yaml 주요 필드**

- `resources`: 기본 매니페스트 파일 목록
- `patches`: Strategic Merge Patch 또는 JSON Patch를 적용한다.
- `namePrefix`, `nameSuffix`: 리소스 이름에 접두사/접미사를 추가한다.
- `commonLabels`: 모든 리소스에 공통 label을 추가한다.
- `configMapGenerator`: ConfigMap을 자동 생성한다.
- `secretGenerator`: Secret을 자동 생성한다.
- `images`: 이미지 이름이나 태그를 변경한다.

**Patch 유형**

- Strategic Merge Patch: 원본 리소스와 동일한 구조로 변경할 부분만 작성한다. 배열 요소는 key 필드(예: name)로 매칭된다.
- JSON Patch: `op`, `path`, `value`를 사용하여 정밀하게 수정한다. 배열 인덱스로 특정 요소를 지정할 수 있다.

**적용 명령**

- `kubectl apply -k overlays/dev/`: kustomize를 적용한다.
- `kubectl kustomize overlays/dev/`: 렌더링 결과를 미리 확인한다.

---

## 3. Application Observability and Maintenance (15%)

애플리케이션의 상태를 모니터링하고, 문제를 진단하며, 로그를 관리하는 영역이다.

### 3.1 Liveness Probe

컨테이너가 **정상 동작 중**인지 확인하는 검사이다. 실패하면 kubelet이 컨테이너를 **재시작**한다.

**검사 방식**

- `httpGet`: 지정된 경로와 포트로 HTTP GET 요청을 보낸다. 응답 코드가 200~399이면 성공이다.
- `tcpSocket`: 지정된 포트에 TCP 연결을 시도한다. 연결이 성공하면 통과이다.
- `exec`: 컨테이너 내부에서 명령을 실행한다. 종료 코드가 0이면 성공이다.

**사용 시나리오**

- 애플리케이션이 데드락에 빠져 응답하지 않는 경우
- 메모리 누수로 인해 정상 동작하지 않는 경우
- 재시작하면 복구 가능한 장애 상황

### 3.2 Readiness Probe

컨테이너가 **트래픽을 받을 준비가 되었는지** 확인하는 검사이다. 실패하면 해당 Pod를 Service의 Endpoints에서 **제외**한다.

**사용 시나리오**

- 애플리케이션 초기화 중 (캐시 워밍업, DB 연결 등)
- 일시적 과부하로 요청을 처리할 수 없는 상태
- 외부 의존성이 사용 불가능한 상태

**Liveness와의 차이**

- Liveness 실패 -> 컨테이너 재시작
- Readiness 실패 -> Service에서 제외 (재시작하지 않음)
- 두 Probe를 함께 사용하는 것이 일반적이다.

### 3.3 Startup Probe

컨테이너가 **시작 완료**되었는지 확인하는 검사이다. Startup Probe가 성공할 때까지 Liveness/Readiness Probe는 비활성화된다.

**사용 시나리오**

- 시작에 오래 걸리는 레거시 애플리케이션
- Liveness Probe의 `initialDelaySeconds`를 길게 설정하는 대신 Startup Probe를 사용하면 시작 후에는 빠르게 장애를 감지할 수 있다.

**설정 예시**

- `failureThreshold: 30`, `periodSeconds: 10` -> 최대 300초(5분)까지 시작을 기다린다.
- Startup Probe 성공 후 Liveness Probe가 활성화된다.

### 3.4 Probe 공통 파라미터

| 파라미터 | 기본값 | 설명 |
|---------|-------|------|
| `initialDelaySeconds` | 0 | 컨테이너 시작 후 첫 검사까지 대기 시간 |
| `periodSeconds` | 10 | 검사 주기 |
| `timeoutSeconds` | 1 | 검사 응답 대기 시간 |
| `successThreshold` | 1 | 실패 후 성공으로 전환되기 위한 연속 성공 횟수 |
| `failureThreshold` | 3 | 실패로 판단하기 위한 연속 실패 횟수 |

### 3.5 로깅

**kubectl logs**

- `kubectl logs <pod>`: Pod의 로그를 확인한다.
- `kubectl logs <pod> -c <container>`: 멀티 컨테이너 Pod에서 특정 컨테이너 로그를 확인한다.
- `kubectl logs <pod> --previous`: 이전에 종료된 컨테이너의 로그를 확인한다.
- `kubectl logs <pod> -f`: 실시간으로 로그를 스트리밍한다.
- `kubectl logs <pod> --tail=100`: 마지막 100줄만 확인한다.
- `kubectl logs -l app=nginx`: label selector로 여러 Pod의 로그를 확인한다.

**Sidecar Logging 패턴**

메인 컨테이너가 파일에 로그를 쓰면, sidecar 컨테이너가 해당 파일을 읽어 stdout으로 출력하거나 외부 시스템으로 전송한다. emptyDir 볼륨을 공유하여 구현한다.

### 3.6 디버깅

**kubectl exec**

- `kubectl exec -it <pod> -- /bin/sh`: 컨테이너에 셸로 접속한다.
- `kubectl exec <pod> -- cat /etc/config/app.conf`: 단일 명령을 실행한다.
- `kubectl exec <pod> -c <container> -- command`: 특정 컨테이너에서 명령을 실행한다.

**kubectl debug**

- `kubectl debug <pod> -it --image=busybox --target=<container>`: 임시 디버그 컨테이너를 추가한다.
- `kubectl debug node/<node> -it --image=ubuntu`: 노드에 디버그 Pod를 생성한다.

**Ephemeral Containers**

- 실행 중인 Pod에 임시 컨테이너를 추가하여 디버깅한다.
- distroless 이미지처럼 셸이 없는 컨테이너를 디버깅할 때 유용하다.
- Pod를 재시작하지 않고도 디버깅 도구를 사용할 수 있다.

### 3.7 리소스 모니터링

- `kubectl top pods`: Pod의 CPU/Memory 사용량을 확인한다.
- `kubectl top nodes`: Node의 CPU/Memory 사용량을 확인한다.
- `kubectl top pods --sort-by=cpu`: CPU 사용량 기준으로 정렬한다.
- `kubectl top pods -A`: 모든 네임스페이스의 Pod를 확인한다.
- metrics-server가 설치되어 있어야 사용 가능하다.

---

## 4. Application Environment, Configuration and Security (25%)

가장 비중이 큰 영역이다. 설정 관리, 보안 컨텍스트, 리소스 관리를 다룬다.

### 4.1 ConfigMap

애플리케이션의 설정 데이터를 키-값 쌍으로 저장하는 리소스이다. 민감하지 않은 설정에 사용한다.

**생성 방법**

- `kubectl create configmap <name> --from-literal=key=value`: 명령줄에서 직접 값을 지정한다.
- `kubectl create configmap <name> --from-file=<path>`: 파일 내용을 ConfigMap으로 생성한다.
- `kubectl create configmap <name> --from-env-file=<path>`: `.env` 형식 파일에서 생성한다.
- YAML 매니페스트로 직접 작성하여 `kubectl apply`로 적용할 수도 있다.

**사용 방법**

- `env`: 개별 key를 환경 변수로 주입한다. `configMapKeyRef`를 사용한다.
- `envFrom`: ConfigMap의 모든 key를 환경 변수로 일괄 주입한다. `configMapRef`를 사용한다.
- `volume`: ConfigMap을 파일로 마운트한다. 각 key가 파일명, value가 파일 내용이 된다.

**주의사항**

- ConfigMap 업데이트 시 volume mount된 파일은 자동 갱신된다 (kubelet sync 주기에 따라 약간의 지연 발생).
- 환경 변수로 주입된 값은 Pod를 재시작해야 반영된다.
- `subPath`로 마운트한 경우 자동 갱신이 되지 않는다.

### 4.2 Secret

민감한 데이터(패스워드, 토큰, 인증서 등)를 저장하는 리소스이다.

**유형**

- `Opaque`: 기본 유형. 임의의 키-값 쌍을 저장한다.
- `kubernetes.io/dockerconfigjson`: 컨테이너 레지스트리 인증 정보를 저장한다. `imagePullSecrets`에 사용한다.
- `kubernetes.io/tls`: TLS 인증서와 개인 키를 저장한다. `tls.crt`와 `tls.key` 필드를 가진다.

**생성 방법**

- `kubectl create secret generic <name> --from-literal=key=value`: 명령줄에서 생성한다.
- `kubectl create secret docker-registry <name> --docker-server=... --docker-username=... --docker-password=...`: 레지스트리 인증 정보를 생성한다.
- `kubectl create secret tls <name> --cert=<path> --key=<path>`: TLS Secret을 생성한다.

**사용 방법**

ConfigMap과 동일하게 `env` (secretKeyRef), `envFrom` (secretRef), `volume`으로 사용한다.

**주의사항**

- Secret의 data 필드 값은 base64로 인코딩된다. `stringData`를 사용하면 평문으로 작성할 수 있다.
- 기본적으로 etcd에 암호화 없이 저장된다. EncryptionConfiguration으로 암호화를 활성화할 수 있다.
- RBAC으로 Secret 접근을 제한하는 것이 중요하다.

### 4.3 ServiceAccount

Pod가 Kubernetes API 서버와 통신할 때 사용하는 인증 주체이다.

- 모든 네임스페이스에는 `default` ServiceAccount가 자동 생성된다.
- Pod에 `serviceAccountName`을 지정하지 않으면 `default` ServiceAccount가 사용된다.
- 별도의 ServiceAccount를 생성하고 RBAC(Role/RoleBinding)과 연결하여 최소 권한 원칙을 적용한다.
- `automountServiceAccountToken: false`로 설정하면 API 서버 접근 토큰이 마운트되지 않는다.

**생성 명령**

- `kubectl create serviceaccount <name>`
- Pod spec에 `serviceAccountName: <name>`을 지정하여 연결한다.

### 4.4 SecurityContext

Pod 또는 컨테이너 수준에서 보안 설정을 정의한다.

**Pod 수준 (spec.securityContext)**

- `runAsUser: <UID>`: Pod의 모든 컨테이너를 지정된 UID로 실행한다.
- `runAsGroup: <GID>`: Pod의 모든 컨테이너를 지정된 GID로 실행한다.
- `fsGroup: <GID>`: 마운트된 볼륨의 소유 그룹을 지정한다. 볼륨 내 파일의 그룹이 이 GID로 설정된다.

**컨테이너 수준 (containers[].securityContext)**

- `runAsNonRoot: true`: root 사용자로 실행되는 것을 방지한다. root로 실행 시 컨테이너가 시작되지 않는다.
- `readOnlyRootFilesystem: true`: 컨테이너의 루트 파일시스템을 읽기 전용으로 설정한다.
- `allowPrivilegeEscalation: false`: 권한 상승을 방지한다.
- `capabilities.add`: 추가할 Linux capability 목록 (예: NET_ADMIN, SYS_TIME).
- `capabilities.drop`: 제거할 Linux capability 목록 (예: ALL).

**보안 모범 사례**

- `runAsNonRoot: true` + `readOnlyRootFilesystem: true` + `allowPrivilegeEscalation: false`를 함께 설정한다.
- `capabilities.drop: ["ALL"]`로 모든 capability를 제거한 후 필요한 것만 추가한다.
- 쓰기가 필요한 경로에만 emptyDir을 마운트한다.

### 4.5 Resource requests/limits

컨테이너가 사용하는 CPU와 메모리 리소스를 관리한다.

**requests**

- 컨테이너가 **보장받는** 최소 리소스량이다.
- 스케줄러가 Pod를 배치할 때 requests를 기준으로 노드를 선택한다.
- 예: `cpu: 100m` (0.1 CPU), `memory: 128Mi`

**limits**

- 컨테이너가 사용할 수 있는 **최대** 리소스량이다.
- CPU limit 초과 시 throttling이 발생한다 (성능 저하).
- Memory limit 초과 시 OOMKilled로 컨테이너가 종료된다.

**QoS 클래스**

| 클래스 | 조건 | 우선순위 |
|-------|------|---------|
| **Guaranteed** | 모든 컨테이너에 requests == limits가 설정됨 | 가장 높음 (마지막에 축출) |
| **Burstable** | 최소 하나의 컨테이너에 requests가 설정됨 | 중간 |
| **BestEffort** | requests와 limits가 모두 설정되지 않음 | 가장 낮음 (먼저 축출) |

**리소스 단위**

- CPU: `1` = 1 vCPU, `100m` = 0.1 vCPU, `500m` = 0.5 vCPU
- Memory: `128Mi` = 128 MiB, `1Gi` = 1 GiB, `256M` = 256 MB (10진수)

### 4.6 LimitRange

네임스페이스 수준에서 개별 컨테이너/Pod의 리소스 사용량을 제한한다.

- `default`: 컨테이너에 limits가 지정되지 않은 경우 적용되는 기본 limits 값
- `defaultRequest`: 컨테이너에 requests가 지정되지 않은 경우 적용되는 기본 requests 값
- `min`: 허용되는 최소 리소스량
- `max`: 허용되는 최대 리소스량
- `type`: Container, Pod, PersistentVolumeClaim

### 4.7 ResourceQuota

네임스페이스 수준에서 **전체 리소스 총량**을 제한한다.

- `requests.cpu`, `requests.memory`: 네임스페이스 내 모든 Pod의 requests 합계 제한
- `limits.cpu`, `limits.memory`: 네임스페이스 내 모든 Pod의 limits 합계 제한
- `pods`: 생성 가능한 최대 Pod 수
- `configmaps`, `secrets`, `services`, `persistentvolumeclaims`: 각 리소스의 최대 개수

---

## 5. Services and Networking (20%)

Pod 간 통신, 외부 노출, 네트워크 정책을 다루는 영역이다.

### 5.1 Service 종류

**ClusterIP (기본)**

- 클러스터 내부에서만 접근 가능한 가상 IP를 할당한다.
- Pod 간 내부 통신에 사용한다.

**NodePort**

- ClusterIP에 더하여 모든 노드의 특정 포트(30000~32767)로 외부 접근을 허용한다.
- `nodePort`를 지정하지 않으면 범위 내에서 자동 할당된다.

**LoadBalancer**

- NodePort에 더하여 클라우드 프로바이더의 로드밸런서를 자동 생성한다.
- 외부 IP가 할당되어 인터넷에서 직접 접근할 수 있다.

**Headless Service (ClusterIP: None)**

- ClusterIP를 할당하지 않고, DNS로 각 Pod의 IP를 직접 반환한다.
- StatefulSet과 함께 사용하여 각 Pod에 고유한 DNS 이름을 부여한다.
- 예: `pod-0.headless-svc.namespace.svc.cluster.local`

### 5.2 Ingress

HTTP/HTTPS 트래픽을 클러스터 내부 Service로 라우팅하는 규칙이다. Ingress Controller(예: nginx, traefik)가 필요하다.

**pathType**

- `Prefix`: 경로 접두사로 매칭한다. `/api`는 `/api`, `/api/v1`, `/api/users` 등과 매칭된다.
- `Exact`: 정확히 일치하는 경로만 매칭한다. `/api`는 `/api`만 매칭되고 `/api/`는 매칭되지 않는다.
- `ImplementationSpecific`: Ingress Controller 구현에 따라 다르다.

**Host-based Routing**

- `host` 필드를 사용하여 도메인 기반 라우팅을 설정한다.
- 예: `app.example.com`은 app-service로, `api.example.com`은 api-service로 라우팅한다.

**TLS**

- `tls` 섹션에서 Secret(tls 유형)을 참조하여 HTTPS를 활성화한다.
- `hosts`에 TLS를 적용할 도메인을 지정한다.

**IngressClass**

- `ingressClassName` 필드로 사용할 Ingress Controller를 지정한다.
- 클러스터에 여러 Ingress Controller가 있을 때 구분하기 위해 사용한다.

### 5.3 NetworkPolicy

Pod 간 네트워크 트래픽을 제어하는 방화벽 규칙이다. CNI 플러그인(Calico, Cilium 등)이 NetworkPolicy를 지원해야 한다.

**spec 구조**

- `podSelector`: 정책이 적용될 대상 Pod를 선택한다. 빈 selector(`{}`)는 네임스페이스의 모든 Pod를 선택한다.
- `policyTypes`: `Ingress`, `Egress` 또는 둘 다 지정한다.
- `ingress`: 허용할 인바운드 트래픽 규칙이다.
- `egress`: 허용할 아웃바운드 트래픽 규칙이다.

**selector 종류**

- `podSelector`: label로 특정 Pod를 선택한다.
- `namespaceSelector`: label로 특정 네임스페이스의 모든 Pod를 선택한다.
- `ipBlock`: CIDR 범위로 IP 대역을 지정한다. `except`로 특정 IP를 제외할 수 있다.
- `ports`: 프로토콜(TCP/UDP)과 포트 번호를 지정한다.

**Default Deny 정책**

NetworkPolicy가 없으면 모든 트래픽이 허용된다. Default deny 정책을 먼저 적용한 후 필요한 트래픽만 허용하는 것이 보안 모범 사례이다.

- Default deny ingress: `podSelector: {}`, `policyTypes: [Ingress]`, `ingress` 규칙 없음
- Default deny egress: `podSelector: {}`, `policyTypes: [Egress]`, `egress` 규칙 없음

### 5.4 DNS

Kubernetes 클러스터 내부 DNS는 CoreDNS가 담당한다.

**Service DNS**

- 형식: `<service-name>.<namespace>.svc.cluster.local`
- 같은 네임스페이스에서는 `<service-name>`만으로 접근 가능하다.
- 다른 네임스페이스의 서비스에 접근하려면 `<service-name>.<namespace>`를 사용한다.

**Pod DNS**

- 형식: `<pod-ip-with-dashes>.<namespace>.pod.cluster.local`
- 예: Pod IP가 10.244.1.5이면 `10-244-1-5.namespace.pod.cluster.local`이다.

**Headless Service의 Pod DNS**

- StatefulSet과 함께 사용 시: `<pod-name>.<service-name>.<namespace>.svc.cluster.local`
- 예: `web-0.nginx-headless.default.svc.cluster.local`

---

## 시험 팁

- **시간 관리**: 2시간 동안 15~20문제를 풀어야 한다. 문제당 평균 6~8분이다.
- **kubectl 자동완성**: 시험 환경에서 bash completion이 활성화되어 있다.
- **alias 설정**: `alias k=kubectl`은 기본 제공된다.
- **--dry-run=client -o yaml**: 매니페스트를 빠르게 생성할 수 있다.
- **kubectl explain**: 필드 구조를 확인할 때 `--recursive` 옵션이 유용하다.
- **공식 문서 참조 가능**: kubernetes.io 공식 문서를 시험 중에 참조할 수 있다.
- **쉬운 문제부터**: 점수가 낮은 어려운 문제에 시간을 낭비하지 말고 쉬운 문제부터 풀어야 한다.
