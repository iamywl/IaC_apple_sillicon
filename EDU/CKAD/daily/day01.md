# CKAD Day 1: Pod 기초와 Dockerfile 멀티스테이지 빌드

> CKAD 도메인: Application Design and Build (20%) - Part 1a | 예상 소요 시간: 1시간

---

## 오늘의 학습 목표

- [ ] Pod의 개념과 내부 동작 원리를 이해한다
- [ ] Pod YAML 매니페스트의 각 필드를 정확히 설명할 수 있다
- [ ] Dockerfile 멀티스테이지 빌드의 원리와 최적화 기법을 이해한다

---

## 1. Pod 기초 - 쿠버네티스의 가장 작은 단위

### 1.1 Pod란 무엇인가?

**공학적 정의:**
Pod는 쿠버네티스의 최소 스케줄링 단위로, 하나 이상의 컨테이너가 동일한 Linux Network Namespace, IPC Namespace, UTS Namespace를 공유하는 cgroup 격리 단위이다. Pod 내 컨테이너들은 동일한 veth pair를 통해 할당된 Pod IP를 공유하므로 loopback(127.0.0.1)으로 상호 통신하며, 동일한 Volume mount point를 통해 파일시스템을 공유할 수 있다. Pod의 생명주기는 kubelet이 관리하며, Pod 삭제 시 해당 cgroup 하위의 모든 프로세스가 SIGTERM -> SIGKILL 순서로 종료된다.

**핵심 특징:**
- 같은 Pod 안의 컨테이너들은 같은 IP 주소를 공유한다 (localhost로 서로 통신 가능)
- 같은 Pod 안의 컨테이너들은 볼륨(Volume)을 공유할 수 있다
- Pod가 삭제되면 안의 모든 컨테이너도 함께 삭제된다
- Pod는 일반적으로 직접 생성하지 않고, Deployment 같은 상위 리소스를 통해 관리한다

### 1.2 Pod YAML 상세 해부

```yaml
# --- Pod 매니페스트(Manifest) 상세 설명 ---
apiVersion: v1                # API 버전. Pod는 core API group에 속하므로 "v1"
                              # Deployment는 "apps/v1", Job은 "batch/v1" 등
                              # kubectl api-resources 명령으로 확인 가능

kind: Pod                     # 리소스 종류. 쿠버네티스에게 "이것은 Pod입니다"라고 알려줌
                              # 대소문자 정확히 지켜야 함 (pod가 아닌 Pod)

metadata:                     # 리소스의 메타데이터(이름표 정보)
  name: my-first-pod          # Pod의 이름. 같은 네임스페이스에서 유일해야 함
                              # DNS 호환 이름 (소문자, 하이픈 사용 가능, 253자 이하)
  namespace: default          # Pod가 속할 네임스페이스. 생략하면 "default"
                              # 네임스페이스(Namespace)는 "폴더"와 비슷한 논리적 분리 단위
  labels:                     # 레이블(Label): 리소스를 분류하는 키-값 쌍
    app: web                  # Service, Deployment 등이 이 레이블로 Pod를 찾음
    tier: frontend            # 여러 레이블을 붙여 다양한 기준으로 분류 가능
    environment: production   # 운영 환경 구분에 활용
  annotations:                # 어노테이션(Annotation): 추가 정보 저장 (선택적 메타데이터)
    description: "웹 서버 Pod" # 사람이 읽기 위한 설명
    owner: "team-alpha"       # 도구나 시스템이 사용하는 정보

spec:                         # 스펙(Spec): Pod의 원하는 상태를 정의
                              # "이런 상태로 Pod를 만들어 주세요"라는 요청서

  restartPolicy: Always       # 컨테이너 재시작 정책
                              # Always(기본값): 항상 재시작
                              # OnFailure: 실패(exit code != 0)시만 재시작
                              # Never: 재시작하지 않음
                              # Job은 보통 OnFailure 또는 Never 사용

  containers:                 # 컨테이너 목록 (최소 1개 필수)
    - name: nginx             # 컨테이너 이름. Pod 내에서 유일해야 함
                              # kubectl logs <pod> -c <name> 으로 특정 컨테이너 로그 조회
      image: nginx:1.25       # 컨테이너 이미지. 레지스트리/이름:태그 형식
                              # 태그 생략 시 :latest가 사용됨 (비추천)
      ports:                  # 컨테이너가 노출하는 포트 목록 (문서화 목적)
        - containerPort: 80   # 실제 방화벽 역할은 하지 않음. 참조 정보
          protocol: TCP       # TCP(기본값) 또는 UDP
      env:                    # 환경 변수 목록
        - name: APP_ENV       # 환경 변수 이름
          value: "production" # 환경 변수 값 (문자열)
      resources:              # 리소스 요청량과 제한량
        requests:             # 최소 보장 리소스. 스케줄링 기준
          cpu: 100m           # 100 밀리코어 = 0.1 CPU
          memory: 128Mi       # 128 메비바이트
        limits:               # 최대 사용 가능 리소스
          cpu: 200m           # 이 이상 CPU 사용 시 쓰로틀링(throttling)
          memory: 256Mi       # 이 이상 메모리 사용 시 OOMKilled
```

### 1.3 Pod 내부 동작 원리

```
[사용자] kubectl apply -f pod.yaml
    |
    v
[API Server] --- 요청 수신, 유효성 검사, etcd에 저장
    |
    v
[Scheduler] --- Pod를 어떤 Node에 배치할지 결정
    |           (리소스 requests, nodeSelector, affinity 등 고려)
    v
[Kubelet] --- 해당 Node의 kubelet이 Pod 생성 지시 수신
    |
    v
[Container Runtime] --- containerd/CRI-O가 실제 컨테이너 생성
    |
    v
[Pod 실행 중] --- kubelet이 지속적으로 상태 모니터링
                  Probe 검사, 재시작 관리 등
```

---

## 2. Dockerfile 멀티스테이지 빌드

### 2.1 멀티스테이지 빌드란?

**공학적 정의:**
멀티스테이지 빌드는 단일 Dockerfile 내에서 복수의 FROM 명령을 사용하여 빌드 타임 의존성(컴파일러, SDK, 빌드 도구 체인)과 런타임 의존성(실행 바이너리, 런타임 라이브러리)을 분리하는 Docker 이미지 최적화 기법이다. 빌드 스테이지에서 생성된 아티팩트만 COPY --from 지시어로 최종 스테이지에 복사함으로써, 최종 이미지에는 공격 표면(attack surface)을 줄이고 이미지 레이어 크기를 최소화한다.

**핵심 원리:**
- 1단계(builder): 소스 코드 컴파일, 의존성 설치 등 빌드 작업 수행
- 2단계(runtime): 빌드 결과물만 복사하여 경량 베이스 이미지 위에서 실행
- 빌드 도구, 소스 코드, 중간 산출물이 최종 이미지에 포함되지 않음

### 2.2 Go 애플리케이션 멀티스테이지 빌드

```dockerfile
# ===== Stage 1: 빌드 환경 =====
FROM golang:1.21-alpine AS builder
# golang:1.21-alpine: Go 컴파일러가 포함된 이미지 (~300MB)
# AS builder: 이 스테이지에 "builder"라는 이름을 부여

WORKDIR /app
# 작업 디렉토리 설정. 없으면 자동 생성
# 이후 모든 명령은 이 디렉토리 기준으로 실행

COPY go.mod go.sum ./
# go.mod, go.sum만 먼저 복사 (의존성 정보 파일)
# 이렇게 하면 의존성이 바뀌지 않는 한 캐시가 유지됨

RUN go mod download
# 의존성 다운로드. go.mod/go.sum이 바뀌지 않으면 캐시 사용

COPY . .
# 나머지 소스 코드 전체 복사

RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server .
# CGO_ENABLED=0: C 라이브러리 의존성 제거 (정적 바이너리 생성)
# GOOS=linux: Linux용으로 빌드
# -o /app/server: 출력 바이너리 경로
# 결과: 단일 실행 파일 (~10MB)

# ===== Stage 2: 런타임 환경 =====
FROM alpine:3.18
# alpine:3.18: 초경량 Linux 이미지 (~5MB)
# 빌드 도구가 전혀 없는 깨끗한 환경

RUN apk --no-cache add ca-certificates
# HTTPS 통신을 위한 CA 인증서만 설치

COPY --from=builder /app/server /usr/local/bin/server
# builder 스테이지에서 빌드된 바이너리만 복사
# --from=builder: "builder"라는 이름의 스테이지에서 파일을 가져옴

RUN adduser -D -u 1000 appuser
# 비루트 사용자 생성 (보안 모범 사례)
# -D: 비밀번호 없이 생성, -u 1000: UID 지정

USER appuser
# 이후 모든 명령과 컨테이너 실행을 appuser로 수행

EXPOSE 8080
# 문서화용: 이 컨테이너가 8080 포트를 사용함을 명시

ENTRYPOINT ["server"]
# 컨테이너 시작 시 실행할 명령
```

### 2.3 Node.js 멀티스테이지 빌드

```dockerfile
# Stage 1: 의존성 설치 및 빌드
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production
# npm ci: package-lock.json 기반으로 정확한 버전 설치
# --only=production: devDependencies 제외
COPY . .
RUN npm run build

# Stage 2: 런타임
FROM node:20-alpine
WORKDIR /app
RUN adduser -D -u 1000 nodeuser
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER nodeuser
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### 2.4 Python 멀티스테이지 빌드

```dockerfile
# Stage 1: 빌드
FROM python:3.11-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt
# --prefix=/install: 특정 디렉토리에 패키지 설치 (나중에 복사하기 쉽게)

# Stage 2: 런타임
FROM python:3.11-slim
WORKDIR /app
COPY --from=builder /install /usr/local
# 설치된 Python 패키지만 복사
COPY . .
RUN useradd -m -u 1000 appuser
USER appuser
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 2.5 이미지 크기 최적화 전략 비교

| 전략 | 설명 | 크기 절감 | 예시 |
|------|------|----------|------|
| 경량 베이스 이미지 | alpine, distroless, scratch 사용 | 80-95% | `FROM alpine:3.18` |
| RUN 명령 체이닝 | 레이어 수 감소 | 10-30% | `RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*` |
| .dockerignore | 빌드 컨텍스트에서 불필요 파일 제외 | 빌드 속도 향상 | `.git`, `node_modules`, `*.md`, `.env` |
| 비루트 사용자 | 보안 강화 (크기 무관) | - | `USER 1000` |
| 멀티스테이지 | 빌드 도구 제외 | 50-90% | `COPY --from=builder` |

---

## 3. 복습 체크리스트

- [ ] Pod YAML의 `apiVersion`, `kind`, `metadata`, `spec` 각 필드를 설명할 수 있다
- [ ] 멀티스테이지 빌드에서 `COPY --from=builder`의 역할을 설명할 수 있다
- [ ] .dockerignore에 포함해야 하는 대표적인 항목을 나열할 수 있다
- [ ] Pod 생성 흐름(API Server -> Scheduler -> Kubelet -> Container Runtime)을 설명할 수 있다

---

## tart-infra 실습

### 실습 환경 설정

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
kubectl get pods -n demo
```

### 실습 1: dev 클러스터의 Pod 구조 분석

dev 클러스터에서 실행 중인 nginx Pod의 YAML을 분석한다.

```bash
# nginx Pod 확인
kubectl get pods -n demo -l app=nginx

# Pod YAML 상세 조회
kubectl get pod -n demo -l app=nginx -o yaml | head -60
```

**예상 출력:**
```
NAME                     READY   STATUS    RESTARTS   AGE
nginx-xxxxxxxxx-xxxxx    1/1     Running   0          xxd
```

**동작 원리:** `kubectl get pod -o yaml`로 출력되는 YAML에는 사용자가 작성한 spec 외에 kubelet이 채운 status 필드, scheduler가 채운 nodeName, 그리고 API Server가 추가한 metadata(uid, creationTimestamp, resourceVersion)가 포함된다. 이 필드들을 구분할 수 있어야 한다.

### 실습 2: Pod 생성과 리소스 명세 작성

demo 네임스페이스에 테스트 Pod를 생성하고 삭제한다.

```bash
# dry-run으로 YAML 생성
kubectl run ckad-test --image=nginx:1.25 --port=80 \
  -n demo --dry-run=client -o yaml

# 실제 생성
kubectl run ckad-test --image=nginx:1.25 --port=80 -n demo

# 상태 확인
kubectl get pod ckad-test -n demo -o wide

# Pod 내부 접속 테스트
kubectl exec ckad-test -n demo -- curl -s localhost:80 | head -5

# 정리
kubectl delete pod ckad-test -n demo
```

**예상 출력 (curl):**
```html
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
</head>
```

**동작 원리:** `kubectl run`은 내부적으로 Pod 매니페스트를 생성하여 API Server에 POST 요청을 보낸다. `--dry-run=client`는 API Server에 요청을 보내지 않고 클라이언트 측에서 YAML만 생성한다. CKAD 시험에서 YAML을 빠르게 생성하는 핵심 기법이다.

### 실습 3: 기존 서비스의 Pod-Service 연결 확인

```bash
# demo 네임스페이스의 Service와 Endpoints 확인
kubectl get svc -n demo
kubectl get endpoints -n demo

# nginx 서비스의 NodePort로 외부 접근 테스트
curl -s http://localhost:30080 | head -5
```

**동작 원리:** Service는 label selector로 Pod를 선택하고, Endpoints 컨트롤러가 매칭되는 Pod IP를 Endpoints 리소스에 등록한다. NodePort(30080)는 모든 노드에서 해당 포트로 들어오는 트래픽을 Service로 전달한다.
