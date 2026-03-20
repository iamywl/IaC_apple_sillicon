# CKAD Day 13: ConfigMap과 Secret 기초

> CKAD 도메인: Application Environment, Configuration and Security (25%) - Part 1a | 예상 소요 시간: 1시간

---

## 오늘의 학습 목표

- [ ] ConfigMap의 4가지 생성 방법을 숙지한다
- [ ] ConfigMap의 3가지 사용 방법(env, envFrom, volume)을 이해한다
- [ ] subPath 마운트와 일반 마운트의 차이를 안다
- [ ] ConfigMap 업데이트 동작을 이해한다
- [ ] Secret의 종류와 생성/사용 방법을 숙지한다
- [ ] data vs stringData 차이를 이해한다

---

## 1. ConfigMap (컨피그맵) - 설정 데이터 관리

### 1.1 ConfigMap이란?

**공학적 정의:**
ConfigMap은 쿠버네티스의 API 리소스로, 키-값 쌍의 비밀이 아닌 설정 데이터를 Pod의 컨테이너 이미지와 분리하여 저장한다. etcd에 평문으로 저장되며, 환경 변수(env/envFrom), 볼륨 마운트(volume), 또는 컨테이너 명령 인수로 Pod에 주입할 수 있다. ConfigMap의 최대 크기는 1MiB이다.

```
[ConfigMap의 역할]

이미지 (불변)                    ConfigMap (가변)
┌──────────────┐               ┌──────────────────────┐
│ nginx:1.25   │     +         │ DB_HOST=postgres     │
│ (코드/바이너리)│               │ LOG_LEVEL=info       │
│              │               │ nginx.conf = {...}   │
└──────────────┘               └──────────────────────┘
        │                               │
        └───────────┬───────────────────┘
                    v
            [Pod: 코드 + 설정]
```

### 1.2 ConfigMap 생성 (4가지 방법)

#### 방법 1: --from-literal (키-값 직접 지정)

```bash
kubectl create configmap app-config \
  --from-literal=DB_HOST=postgres \
  --from-literal=DB_PORT=5432 \
  --from-literal=LOG_LEVEL=info
```

```yaml
# 결과 ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  DB_HOST: postgres
  DB_PORT: "5432"        # 숫자도 문자열로 저장
  LOG_LEVEL: info
```

#### 방법 2: --from-file (파일 내용을 값으로)

```bash
# 파일 생성
echo "worker_processes auto;
events { worker_connections 1024; }
http {
    server {
        listen 80;
        location / { root /usr/share/nginx/html; }
    }
}" > nginx.conf

# 파일명이 키, 파일 내용이 값
kubectl create configmap nginx-config --from-file=nginx.conf
# 결과: data.nginx.conf = "worker_processes auto;..."

# 키 이름 지정
kubectl create configmap nginx-config --from-file=config=nginx.conf
# 결과: data.config = "worker_processes auto;..."
```

#### 방법 3: --from-env-file (env 파일)

```bash
# env 파일 생성 (KEY=VALUE 형식)
cat > app.env << EOF
DB_HOST=postgres
DB_PORT=5432
LOG_LEVEL=info
CACHE_TTL=300
EOF

kubectl create configmap app-config --from-env-file=app.env
# 결과: data에 각 줄이 개별 키-값으로 저장
```

#### 방법 4: YAML 매니페스트

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: demo
data:
  # 단순 키-값
  DB_HOST: postgres
  DB_PORT: "5432"
  LOG_LEVEL: info

  # 파일 형태 (멀티라인)
  nginx.conf: |
    worker_processes auto;
    events { worker_connections 1024; }
    http {
        server {
            listen 80;
            location / { root /usr/share/nginx/html; }
        }
    }

  application.yaml: |
    spring:
      datasource:
        url: jdbc:postgresql://postgres:5432/mydb
      jpa:
        hibernate:
          ddl-auto: update
```

### 1.3 ConfigMap 사용 (3가지 방법)

#### 방법 1: env (개별 환경 변수)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-pod
spec:
  containers:
    - name: app
      image: nginx:1.25
      env:
        - name: DATABASE_HOST        # 컨테이너 내 환경 변수 이름
          valueFrom:
            configMapKeyRef:
              name: app-config        # ConfigMap 이름
              key: DB_HOST            # ConfigMap의 키
        - name: DATABASE_PORT
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: DB_PORT
```

#### 방법 2: envFrom (ConfigMap 전체를 환경 변수로)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-pod
spec:
  containers:
    - name: app
      image: nginx:1.25
      envFrom:
        - configMapRef:
            name: app-config          # ConfigMap의 모든 키-값이 환경 변수로
        - configMapRef:
            name: db-config
          prefix: DB_                 # 접두사 추가 (DB_HOST, DB_PORT 등)
```

```bash
# 검증
kubectl exec app-pod -- env | sort
# DB_HOST=postgres
# DB_PORT=5432
# LOG_LEVEL=info
```

#### 방법 3: volume (파일로 마운트)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx-pod
spec:
  containers:
    - name: nginx
      image: nginx:1.25
      volumeMounts:
        - name: config-volume
          mountPath: /etc/nginx/conf.d  # 디렉토리에 마운트
          readOnly: true
  volumes:
    - name: config-volume
      configMap:
        name: nginx-config
        # items로 특정 키만 선택 가능
        items:
          - key: nginx.conf
            path: default.conf        # 마운트될 파일명 변경
```

```bash
# 검증
kubectl exec nginx-pod -- ls /etc/nginx/conf.d/
# default.conf

kubectl exec nginx-pod -- cat /etc/nginx/conf.d/default.conf
# nginx.conf 내용 출력
```

### 1.4 subPath 마운트

```yaml
# 일반 volume 마운트: 기존 디렉토리 내용이 덮어쓰기됨
volumeMounts:
  - name: config-volume
    mountPath: /etc/nginx/conf.d     # conf.d 안의 기존 파일 사라짐!

# subPath 마운트: 기존 파일 유지, 특정 파일만 추가/교체
volumeMounts:
  - name: config-volume
    mountPath: /etc/nginx/conf.d/custom.conf  # 단일 파일 경로
    subPath: nginx.conf                       # ConfigMap의 키
```

**핵심 비교:**

```
[일반 마운트]
/etc/nginx/conf.d/
└── default.conf       <- ConfigMap에서 온 파일만 존재 (기존 파일 사라짐)

[subPath 마운트]
/etc/nginx/conf.d/
├── default.conf       <- 이미지의 원래 파일 (유지됨)
└── custom.conf        <- ConfigMap에서 온 파일 (추가됨)
```

**주의**: subPath로 마운트된 파일은 ConfigMap 업데이트 시 자동 갱신되지 않는다!

### 1.5 ConfigMap 업데이트 동작

```
[ConfigMap 업데이트 시 동작]

1. 환경 변수 (env/envFrom)
   -> Pod 재시작 필요 (자동 갱신 안 됨)
   -> kubectl rollout restart deployment/<name>

2. Volume 마운트 (일반)
   -> 자동 갱신됨 (kubelet sync period: ~60초)
   -> 심볼릭 링크 기반: ..data -> ..2024_01_01_00_00_00.123456789

3. Volume 마운트 (subPath)
   -> 자동 갱신 안 됨! Pod 재시작 필요

4. Immutable ConfigMap
   -> 변경 자체가 불가능 (삭제 후 재생성 필요)
```

```bash
# ConfigMap 수정
kubectl edit configmap app-config

# 또는
kubectl create configmap app-config \
  --from-literal=DB_HOST=new-postgres \
  --from-literal=DB_PORT=5432 \
  --dry-run=client -o yaml | kubectl apply -f -

# Pod 재시작 (환경 변수 갱신용)
kubectl rollout restart deployment/app-deploy
```

---

## 2. Secret (시크릿) - 민감 데이터 관리

### 2.1 Secret이란?

**공학적 정의:**
Secret은 쿠버네티스의 API 리소스로, 패스워드, 토큰, 키 등 민감한 데이터를 Base64 인코딩하여 저장한다. etcd에 저장되며(Encryption at Rest 설정 가능), tmpfs(메모리 기반 파일시스템)에 마운트되어 디스크에 기록되지 않는다. ConfigMap과 구조적으로 유사하지만, 접근 제어(RBAC)를 별도로 적용하여 보안을 강화할 수 있다.

```
[ConfigMap vs Secret]

ConfigMap                          Secret
- 비밀이 아닌 설정 데이터          - 민감한 데이터
- data에 평문 저장                 - data에 Base64 인코딩
- etcd에 평문                      - etcd에 Base64 (암호화 설정 가능)
- 디스크에 마운트 가능              - tmpfs에 마운트 (메모리)
- 최대 1MiB                        - 최대 1MiB
```

### 2.2 Secret 종류

```
[Secret Types]

1. Opaque (기본)                     generic
   - 임의의 키-값 데이터
   - kubectl create secret generic

2. kubernetes.io/dockerconfigjson    docker-registry
   - 도커 레지스트리 인증 정보
   - kubectl create secret docker-registry

3. kubernetes.io/tls                  tls
   - TLS 인증서와 키
   - kubectl create secret tls

4. kubernetes.io/basic-auth          (YAML로 생성)
   - username/password

5. kubernetes.io/ssh-auth            (YAML로 생성)
   - SSH 인증 키

6. kubernetes.io/service-account-token  (자동 생성)
   - ServiceAccount 토큰
```

### 2.3 Secret 생성

#### 방법 1: --from-literal

```bash
kubectl create secret generic db-secret \
  --from-literal=username=admin \
  --from-literal=password='S3cur3P@ss!'
```

#### 방법 2: --from-file

```bash
echo -n 'admin' > username.txt
echo -n 'S3cur3P@ss!' > password.txt

kubectl create secret generic db-secret \
  --from-file=username=username.txt \
  --from-file=password=password.txt

# 파일 정리
rm username.txt password.txt
```

#### 방법 3: YAML 매니페스트 (data - Base64)

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-secret
type: Opaque
data:
  username: YWRtaW4=           # echo -n 'admin' | base64
  password: UzNjdXIzUEBzcyE=  # echo -n 'S3cur3P@ss!' | base64
```

```bash
# Base64 인코딩/디코딩
echo -n 'admin' | base64          # YWRtaW4=
echo 'YWRtaW4=' | base64 -d       # admin
```

#### 방법 4: YAML 매니페스트 (stringData - 평문)

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-secret
type: Opaque
stringData:                        # 평문으로 작성 -> 자동 Base64 인코딩
  username: admin
  password: S3cur3P@ss!
```

**핵심**: `stringData`는 편의를 위한 쓰기 전용 필드이다. 저장 후 `kubectl get secret -o yaml`로 보면 `data` 필드에 Base64로 저장되어 있다.

### 2.4 Secret 사용

#### 환경 변수로 사용

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-pod
spec:
  containers:
    - name: app
      image: nginx:1.25
      env:
        - name: DB_USERNAME
          valueFrom:
            secretKeyRef:              # configMapKeyRef 대신 secretKeyRef
              name: db-secret
              key: username
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: password
      envFrom:
        - secretRef:                   # configMapRef 대신 secretRef
            name: db-secret
```

#### 볼륨으로 마운트

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-pod
spec:
  containers:
    - name: app
      image: nginx:1.25
      volumeMounts:
        - name: secret-volume
          mountPath: /etc/secrets     # 디렉토리에 마운트
          readOnly: true
  volumes:
    - name: secret-volume
      secret:
        secretName: db-secret
        defaultMode: 0400             # 파일 권한 (읽기 전용)
```

```bash
# 검증
kubectl exec app-pod -- ls /etc/secrets/
# username
# password

kubectl exec app-pod -- cat /etc/secrets/username
# admin (Base64 디코딩된 평문)
```

### 2.5 Docker Registry Secret

```bash
# Docker 레지스트리 인증 Secret 생성
kubectl create secret docker-registry regcred \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username=myuser \
  --docker-password=mypass \
  --docker-email=user@example.com
```

```yaml
# Pod에서 사용
apiVersion: v1
kind: Pod
metadata:
  name: private-app
spec:
  containers:
    - name: app
      image: myregistry.com/private-app:v1.0
  imagePullSecrets:                    # 프라이빗 레지스트리 인증
    - name: regcred
```

### 2.6 TLS Secret

```bash
# TLS Secret 생성
kubectl create secret tls tls-secret \
  --cert=server.crt \
  --key=server.key

# Ingress에서 사용
```

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tls-ingress
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - app.example.com
      secretName: tls-secret          # TLS Secret 참조
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web-svc
                port:
                  number: 80
```

---

## 3. Secret 보안 모범 사례

```
[Secret 보안 체크리스트]

1. etcd 암호화 활성화
   - API Server에 --encryption-provider-config 설정
   - EncryptionConfiguration 리소스로 AES-CBC/AES-GCM 암호화

2. RBAC으로 접근 제한
   - Secret에 대한 get/list/watch 권한을 최소한으로 부여
   - Role/ClusterRole에서 resourceNames로 특정 Secret만 허용

3. 외부 Secret 관리 도구 사용
   - HashiCorp Vault, AWS Secrets Manager
   - External Secrets Operator

4. Secret을 Git에 커밋하지 않기
   - .gitignore에 추가
   - Sealed Secrets, SOPS 등 사용

5. 불필요한 Secret 정리
   - 사용하지 않는 Secret 삭제
   - imagePullSecrets은 ServiceAccount에 연결
```

---

## 4. 복습 체크리스트

- [ ] ConfigMap을 4가지 방법(--from-literal, --from-file, --from-env-file, YAML)으로 생성할 수 있다
- [ ] ConfigMap을 3가지 방법(env, envFrom, volume)으로 사용할 수 있다
- [ ] subPath 마운트와 일반 마운트의 차이(기존 파일 보존, 자동 갱신 안 됨)를 안다
- [ ] ConfigMap 업데이트 시 env vs volume의 동작 차이를 안다
- [ ] Secret을 생성(generic, docker-registry, tls)할 수 있다
- [ ] data(Base64)와 stringData(평문)의 차이를 안다
- [ ] Secret을 env와 volume으로 Pod에 주입할 수 있다
- [ ] imagePullSecrets의 사용법을 안다

---

## tart-infra 실습

### 실습 환경 설정

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get pods -n demo
```

### 실습 1: ConfigMap으로 nginx 설정 주입

dev 클러스터의 nginx에 커스텀 설정 파일을 ConfigMap으로 주입한다.

```bash
# ConfigMap 생성 (nginx 설정)
kubectl create configmap nginx-custom-conf -n demo \
  --from-literal=server-name=tart-infra-dev \
  --from-literal=worker-connections=1024

# ConfigMap 확인
kubectl get configmap nginx-custom-conf -n demo -o yaml

# ConfigMap을 환경변수로 사용하는 Pod 생성
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: cm-demo
  namespace: demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ['sh', '-c', 'echo "Server: $SERVER_NAME, Workers: $WORKER_CONN" && sleep 3600']
      envFrom:
        - configMapRef:
            name: nginx-custom-conf
      env:
        - name: SERVER_NAME
          valueFrom:
            configMapKeyRef:
              name: nginx-custom-conf
              key: server-name
        - name: WORKER_CONN
          valueFrom:
            configMapKeyRef:
              name: nginx-custom-conf
              key: worker-connections
EOF

# 환경변수 확인
kubectl logs cm-demo -n demo
```

**예상 출력:**
```
Server: tart-infra-dev, Workers: 1024
```

**동작 원리:** `envFrom`은 ConfigMap의 모든 키를 환경변수로 주입한다(키에 `-`가 있으면 유효하지 않은 변수명이 되어 무시됨). `env.valueFrom`은 개별 키를 원하는 변수명으로 매핑한다. 두 방식의 차이를 이해하는 것이 중요하다.

### 실습 2: Secret 생성과 볼륨 마운트

PostgreSQL 접속 정보를 Secret으로 관리하고 볼륨으로 마운트한다.

```bash
# Secret 생성
kubectl create secret generic db-credentials -n demo \
  --from-literal=username=postgres \
  --from-literal=password=mysecretpw \
  --from-literal=host=postgresql.demo.svc.cluster.local

# Secret 확인 (Base64 인코딩 확인)
kubectl get secret db-credentials -n demo -o jsonpath='{.data.username}' | base64 -d; echo
kubectl get secret db-credentials -n demo -o jsonpath='{.data.password}' | base64 -d; echo

# Secret을 볼륨으로 마운트하는 Pod
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: secret-demo
  namespace: demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ['sh', '-c', 'ls -la /etc/db-creds/ && cat /etc/db-creds/host && echo && sleep 3600']
      volumeMounts:
        - name: db-creds
          mountPath: /etc/db-creds
          readOnly: true
  volumes:
    - name: db-creds
      secret:
        secretName: db-credentials
EOF

kubectl logs secret-demo -n demo
```

**예상 출력:**
```
total 0
lrwxrwxrwx    1 root root    15 ... host -> ..data/host
lrwxrwxrwx    1 root root    15 ... password -> ..data/password
lrwxrwxrwx    1 root root    15 ... username -> ..data/username
postgresql.demo.svc.cluster.local
```

**동작 원리:** Secret을 볼륨으로 마운트하면 각 키가 파일로 생성된다. 실제로는 symlink 구조(`..data` -> `..timestamp` -> 파일)로 되어 있어 Secret 업데이트 시 kubelet이 atomic하게 교체한다. `readOnly: true`로 컨테이너에서 수정을 방지한다.

### 정리

```bash
kubectl delete pod cm-demo secret-demo -n demo
kubectl delete configmap nginx-custom-conf -n demo
kubectl delete secret db-credentials -n demo
```
