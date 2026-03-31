# CKAD Day 14: ConfigMap/Secret 패턴과 실전 문제

> CKAD 도메인: Application Environment, Configuration and Security (25%) - Part 1b | 예상 소요 시간: 1시간

---

## 오늘의 학습 목표

- [ ] Immutable ConfigMap/Secret의 개념과 사용법을 이해한다
- [ ] ConfigMap/Secret 활용 패턴(nginx 설정, Spring Boot, Projected Volume)을 숙지한다
- [ ] ConfigMap/Secret 관련 실전 문제를 풀 수 있다
- [ ] 자주 하는 실수와 주의사항을 숙지한다

---

## 1. Immutable ConfigMap & Secret

### 1.1 등장 배경

```
[Immutable ConfigMap/Secret이 추가된 이유]

기존 방식의 한계:
1. 운영자가 실수로 ConfigMap을 수정하면 모든 참조 Pod에 영향을 준다
2. kubelet은 모든 ConfigMap의 변경을 주기적으로(~60초) watch하며,
   대규모 클러스터(수천 개의 ConfigMap)에서 API Server에 상당한 부하를 준다
3. 변경 이력을 추적하기 어렵다

Immutable ConfigMap/Secret은 Kubernetes 1.21에서 GA 되었다.
- immutable: true로 설정하면 수정이 차단된다
- kubelet이 watch를 중단하여 API Server 부하를 줄인다
- 변경하려면 새 리소스를 생성해야 하므로 변경 이력이 자연스럽게 남는다
```

### 1.2 Immutable이란?

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  DB_HOST: postgres
  LOG_LEVEL: info
immutable: true                # 불변 설정 -> 수정 불가
```

**Immutable의 장점:**
```
1. 성능 향상
   - kubelet이 변경 감시를 하지 않음 -> API Server 부하 감소
   - 대규모 클러스터에서 유의미한 차이

2. 실수 방지
   - 운영 환경에서 설정이 의도치 않게 변경되는 것을 방지
   - 변경하려면 새 ConfigMap 생성 후 Pod 재배포 필요

3. 감사(Audit) 용이
   - 변경 이력이 새 리소스 생성으로 남음
```

**주의**: immutable: true 설정 후에는 data 필드 수정이 불가하다. 변경하려면 ConfigMap을 삭제하고 다시 생성해야 한다.

```bash
# 수정 시도 -> 에러
kubectl edit configmap app-config
# error: configmaps "app-config" is immutable

# 삭제 후 재생성
kubectl delete configmap app-config
kubectl create configmap app-config --from-literal=DB_HOST=new-postgres
```

---

## 2. ConfigMap & Secret 활용 패턴

### 2.1 패턴 1: ConfigMap + Secret 조합

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: web-app
spec:
  containers:
    - name: app
      image: myapp:v1.0
      env:
        # ConfigMap에서 비밀이 아닌 설정
        - name: DB_HOST
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: DB_HOST
        - name: LOG_LEVEL
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: LOG_LEVEL
        # Secret에서 민감 데이터
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: password
        - name: API_KEY
          valueFrom:
            secretKeyRef:
              name: api-secret
              key: key
```

### 2.2 패턴 2: nginx 설정 관리

```yaml
# ConfigMap으로 nginx.conf 관리
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-config
data:
  default.conf: |
    server {
        listen 80;
        server_name app.example.com;

        location / {
            proxy_pass http://backend:8080;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        location /health {
            return 200 'ok';
            add_header Content-Type text/plain;
        }
    }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-proxy
spec:
  replicas: 2
  selector:
    matchLabels:
      app: nginx-proxy
  template:
    metadata:
      labels:
        app: nginx-proxy
      annotations:
        # ConfigMap 변경 시 자동 롤링 업데이트 트리거
        configHash: "{{ .Values.configHash }}"
    spec:
      containers:
        - name: nginx
          image: nginx:1.25
          ports:
            - containerPort: 80
          volumeMounts:
            - name: config
              mountPath: /etc/nginx/conf.d
              readOnly: true
          livenessProbe:
            httpGet:
              path: /health
              port: 80
      volumes:
        - name: config
          configMap:
            name: nginx-config
```

### 2.3 패턴 3: Spring Boot 설정

```yaml
# application.yaml을 ConfigMap으로 관리
apiVersion: v1
kind: ConfigMap
metadata:
  name: spring-config
data:
  application.yaml: |
    server:
      port: 8080
    spring:
      datasource:
        url: jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}
        username: ${DB_USERNAME}
        password: ${DB_PASSWORD}
      jpa:
        hibernate:
          ddl-auto: update
    logging:
      level:
        root: INFO
        com.example: DEBUG
---
apiVersion: v1
kind: Secret
metadata:
  name: spring-secrets
type: Opaque
stringData:
  DB_USERNAME: app_user
  DB_PASSWORD: SecurePass123!
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: spring-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: spring-app
  template:
    metadata:
      labels:
        app: spring-app
    spec:
      containers:
        - name: app
          image: spring-app:v1.0
          ports:
            - containerPort: 8080
          env:
            - name: DB_HOST
              valueFrom:
                configMapKeyRef:
                  name: db-config
                  key: host
            - name: DB_PORT
              valueFrom:
                configMapKeyRef:
                  name: db-config
                  key: port
            - name: DB_NAME
              valueFrom:
                configMapKeyRef:
                  name: db-config
                  key: name
          envFrom:
            - secretRef:
                name: spring-secrets
          volumeMounts:
            - name: config
              mountPath: /app/config
              readOnly: true
      volumes:
        - name: config
          configMap:
            name: spring-config
```

### 2.4 패턴 4: Projected Volume (여러 소스 통합)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: projected-pod
spec:
  containers:
    - name: app
      image: nginx:1.25
      volumeMounts:
        - name: all-config
          mountPath: /etc/config
          readOnly: true
  volumes:
    - name: all-config
      projected:                      # 여러 소스를 하나의 디렉토리에 마운트
        sources:
          - configMap:
              name: app-config
              items:
                - key: app.conf
                  path: app.conf
          - secret:
              name: app-secret
              items:
                - key: credentials
                  path: credentials
          - serviceAccountToken:       # SA 토큰도 함께 마운트 가능
              path: token
              expirationSeconds: 3600
              audience: api
```

검증:
```bash
kubectl apply -f projected-pod.yaml
kubectl exec projected-pod -- ls /etc/config/
```

기대 출력:
```text
app.conf
credentials
token
```

```bash
# ServiceAccount 토큰 만료 시간 확인
kubectl exec projected-pod -- cat /etc/config/token | cut -d'.' -f2 | base64 -d 2>/dev/null | python3 -m json.tool | grep exp
```

**내부 동작 원리:** Projected Volume은 여러 볼륨 소스(ConfigMap, Secret, ServiceAccount Token, Downward API)를 하나의 디렉토리에 통합 마운트한다. kubelet이 각 소스의 데이터를 수집하여 단일 볼륨으로 구성한다. ServiceAccount Token은 TokenRequest API를 통해 발급되며, expirationSeconds에 따라 만료 전에 kubelet이 자동으로 갱신한다.

---

## 3. 실전 시험 문제 (12문제)

### 문제 1. ConfigMap 생성 (--from-literal)

다음 조건의 ConfigMap을 생성하라.

- 이름: `app-config`, 네임스페이스: `exam`
- DB_HOST=postgres, DB_PORT=5432, LOG_LEVEL=debug

<details><summary>풀이</summary>

```bash
kubectl create namespace exam
kubectl create configmap app-config \
  --from-literal=DB_HOST=postgres \
  --from-literal=DB_PORT=5432 \
  --from-literal=LOG_LEVEL=debug \
  -n exam
```

검증:
```bash
kubectl get configmap app-config -n exam -o yaml | grep -A 5 "^data:"
```

기대 출력:
```text
data:
  DB_HOST: postgres
  DB_PORT: "5432"
  LOG_LEVEL: debug
```

</details>

---

### 문제 2. ConfigMap 생성 (--from-file)

`/tmp/app.properties` 파일을 생성하고, 이를 ConfigMap으로 만들어라.

```
server.port=8080
server.host=0.0.0.0
app.name=myapp
```

<details><summary>풀이</summary>

```bash
cat > /tmp/app.properties << EOF
server.port=8080
server.host=0.0.0.0
app.name=myapp
EOF

kubectl create configmap app-properties \
  --from-file=/tmp/app.properties -n exam

# 확인
kubectl describe configmap app-properties -n exam
```

</details>

---

### 문제 3. ConfigMap을 환경 변수로 사용

`app-config` ConfigMap의 DB_HOST와 DB_PORT를 환경 변수로 사용하는 Pod를 생성하라.

- Pod 이름: `db-client`, 이미지: `busybox:1.36`, 명령: `env && sleep 3600`

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: db-client
  namespace: exam
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "env && sleep 3600"]
      env:
        - name: DB_HOST
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: DB_HOST
        - name: DB_PORT
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: DB_PORT
```

```bash
kubectl logs db-client -n exam | grep DB_
```

기대 출력:
```text
DB_HOST=postgres
DB_PORT=5432
```

</details>

---

### 문제 4. ConfigMap을 envFrom으로 사용

`app-config` 전체를 환경 변수로 주입하는 Pod를 생성하라.

- Pod 이름: `env-pod`, 이미지: `busybox:1.36`

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: env-pod
  namespace: exam
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "env | sort && sleep 3600"]
      envFrom:
        - configMapRef:
            name: app-config
```

```bash
kubectl logs env-pod -n exam | grep -E "DB_|LOG_"
```

기대 출력:
```text
DB_HOST=postgres
DB_PORT=5432
LOG_LEVEL=debug
```

</details>

---

### 문제 5. ConfigMap을 볼륨으로 마운트

`app-properties` ConfigMap을 `/etc/config` 디렉토리에 마운트하는 Pod를 생성하라.

- Pod 이름: `config-vol`, 이미지: `nginx:1.25`

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: config-vol
  namespace: exam
spec:
  containers:
    - name: nginx
      image: nginx:1.25
      volumeMounts:
        - name: config
          mountPath: /etc/config
          readOnly: true
  volumes:
    - name: config
      configMap:
        name: app-properties
```

```bash
kubectl exec config-vol -n exam -- ls /etc/config/
```

기대 출력:
```text
app.properties
```

```bash
kubectl exec config-vol -n exam -- cat /etc/config/app.properties
```

기대 출력:
```text
server.port=8080
server.host=0.0.0.0
app.name=myapp
```

</details>

---

### 문제 6. Secret 생성

다음 조건의 Secret을 생성하라.

- 이름: `db-creds`, 네임스페이스: `exam`
- username=admin, password=P@ssw0rd123

<details><summary>풀이</summary>

```bash
kubectl create secret generic db-creds \
  --from-literal=username=admin \
  --from-literal=password='P@ssw0rd123' \
  -n exam
```

검증:
```bash
kubectl get secret db-creds -n exam -o jsonpath='{.data.username}' | base64 -d; echo
```

기대 출력:
```text
admin
```

```bash
kubectl get secret db-creds -n exam -o jsonpath='{.data.password}' | base64 -d; echo
```

기대 출력:
```text
P@ssw0rd123
```

</details>

---

### 문제 7. Secret을 환경 변수로 사용

`db-creds` Secret의 username과 password를 환경 변수로 사용하는 Pod를 생성하라.

- Pod 이름: `secret-env`, 이미지: `busybox:1.36`

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secret-env
  namespace: exam
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo User=$DB_USER Pass=$DB_PASS && sleep 3600"]
      env:
        - name: DB_USER
          valueFrom:
            secretKeyRef:
              name: db-creds
              key: username
        - name: DB_PASS
          valueFrom:
            secretKeyRef:
              name: db-creds
              key: password
```

```bash
kubectl logs secret-env -n exam
```

기대 출력:
```text
User=admin Pass=P@ssw0rd123
```

</details>

---

### 문제 8. Secret을 볼륨으로 마운트

`db-creds` Secret을 `/etc/secrets` 디렉토리에 읽기 전용으로 마운트하고, 파일 권한을 0400으로 설정하라.

- Pod 이름: `secret-vol`, 이미지: `busybox:1.36`

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secret-vol
  namespace: exam
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "ls -la /etc/secrets/ && sleep 3600"]
      volumeMounts:
        - name: secret-volume
          mountPath: /etc/secrets
          readOnly: true
  volumes:
    - name: secret-volume
      secret:
        secretName: db-creds
        defaultMode: 0400
```

```bash
kubectl exec secret-vol -n exam -- ls -la /etc/secrets/
```

기대 출력:
```text
total 0
lrwxrwxrwx    1 root     root    15 ... password -> ..data/password
lrwxrwxrwx    1 root     root    15 ... username -> ..data/username
```

```bash
kubectl exec secret-vol -n exam -- cat /etc/secrets/username
```

기대 출력:
```text
admin
```

```bash
# 파일 권한 확인 (defaultMode: 0400)
kubectl exec secret-vol -n exam -- stat -c '%a' /etc/secrets/..data/username
```

기대 출력:
```text
400
```

</details>

---

### 문제 9. Docker Registry Secret

프라이빗 레지스트리 `registry.example.com`에 접근하기 위한 Secret을 생성하고, Pod에서 사용하라.

- Secret 이름: `reg-cred`
- 사용자: `deployer`, 비밀번호: `deploy123`

<details><summary>풀이</summary>

```bash
kubectl create secret docker-registry reg-cred \
  --docker-server=registry.example.com \
  --docker-username=deployer \
  --docker-password=deploy123 \
  -n exam
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: private-app
  namespace: exam
spec:
  containers:
    - name: app
      image: registry.example.com/myapp:v1.0
  imagePullSecrets:
    - name: reg-cred
```

</details>

---

### 문제 10. ConfigMap + Secret 조합

ConfigMap `app-config`와 Secret `db-creds`를 모두 사용하는 Pod를 생성하라.

- Pod 이름: `combo-pod`, 이미지: `busybox:1.36`
- ConfigMap은 envFrom으로, Secret은 개별 env로 사용

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: combo-pod
  namespace: exam
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "env | sort && sleep 3600"]
      envFrom:
        - configMapRef:
            name: app-config
      env:
        - name: DB_USER
          valueFrom:
            secretKeyRef:
              name: db-creds
              key: username
        - name: DB_PASS
          valueFrom:
            secretKeyRef:
              name: db-creds
              key: password
```

```bash
kubectl logs combo-pod -n exam | grep -E "DB_|LOG_"
```

기대 출력:
```text
DB_HOST=postgres
DB_PASS=P@ssw0rd123
DB_PORT=5432
DB_USER=admin
LOG_LEVEL=debug
```

</details>

---

### 문제 11. Immutable ConfigMap

불변 ConfigMap을 생성하라.

- 이름: `static-config`, 값: APP_MODE=production

<details><summary>풀이</summary>

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: static-config
  namespace: exam
data:
  APP_MODE: production
immutable: true
```

```bash
kubectl apply -f static-config.yaml -n exam
```

검증:
```bash
kubectl get configmap static-config -n exam -o jsonpath='{.immutable}'
```

기대 출력:
```text
true
```

```bash
# 수정 시도 -> 실패
kubectl edit configmap static-config -n exam
```

기대 출력:
```text
error: configmaps "static-config" is immutable
```

</details>

---

### 문제 12. Secret 값 디코딩

Secret `db-creds`의 password를 디코딩하여 `/tmp/db-password.txt`에 저장하라.

<details><summary>풀이</summary>

```bash
kubectl get secret db-creds -n exam \
  -o jsonpath='{.data.password}' | base64 -d > /tmp/db-password.txt

cat /tmp/db-password.txt
```

기대 출력:
```text
P@ssw0rd123
```

</details>

---

## 4. 트러블슈팅

### 장애 시나리오 1: ConfigMap 업데이트 후 앱에 반영되지 않음

```bash
# 증상: ConfigMap을 수정했지만 앱이 이전 설정으로 동작
kubectl edit configmap app-config
# data.LOG_LEVEL을 info -> debug로 변경

# 디버깅: 환경변수 방식인지 볼륨 방식인지 확인
kubectl get pod app-pod -o yaml | grep -A 5 "envFrom\|configMapKeyRef\|configMap:"

# 원인별 해결:
# 1. env/envFrom 방식 -> Pod 재시작 필요 (환경변수는 컨테이너 시작 시 한 번만 주입)
kubectl rollout restart deployment/app-deploy

# 2. volume 마운트 (일반) -> 최대 60초 후 자동 반영, 앱이 파일 변경을 watch하지 않으면 재시작 필요

# 3. subPath 마운트 -> Pod 재시작 필요 (자동 갱신 불가)
```

### 장애 시나리오 2: Projected Volume에서 권한 에러

```bash
# 증상: 앱이 /etc/config/credentials 파일을 읽지 못함
kubectl logs projected-pod
# Permission denied: /etc/config/credentials

# 디버깅
kubectl exec projected-pod -- ls -la /etc/config/
kubectl exec projected-pod -- id    # 앱이 실행되는 UID 확인

# 해결: defaultMode로 파일 권한을 조정
# projected volume의 각 source에 mode를 지정할 수 있다
```

### 장애 시나리오 3: Immutable ConfigMap 변경 불가

```bash
# 증상: 설정을 변경해야 하는데 immutable: true로 막혀 있음
kubectl edit configmap static-config
# error: configmaps "static-config" is immutable

# 해결: 새 이름의 ConfigMap 생성 후 Pod spec 업데이트
kubectl create configmap static-config-v2 --from-literal=APP_MODE=staging
# Deployment의 ConfigMap 참조를 static-config-v2로 변경
kubectl set env deployment/app-deploy --from=configmap/static-config-v2

# 또는: 삭제 후 재생성 (Pod에 일시적으로 영향)
kubectl delete configmap static-config
kubectl create configmap static-config --from-literal=APP_MODE=staging
```

---

## 5. 자주 하는 실수와 주의사항

### 실수 1: Secret의 data에 평문 입력

```yaml
# 잘못된 예: data에 평문 입력 -> 에러 또는 잘못된 값
apiVersion: v1
kind: Secret
data:
  password: mypassword       # Base64가 아님! 에러 발생

# 올바른 예 1: data에 Base64 인코딩 값
data:
  password: bXlwYXNzd29yZA==  # echo -n 'mypassword' | base64

# 올바른 예 2: stringData에 평문
stringData:
  password: mypassword        # 자동 Base64 인코딩
```

### 실수 2: ConfigMap/Secret 이름 오타

```yaml
# Pod에서 존재하지 않는 ConfigMap 참조 -> Pod 시작 실패
env:
  - name: DB_HOST
    valueFrom:
      configMapKeyRef:
        name: app-confg       # 오타! 'app-config'여야 함
        key: DB_HOST
# Error: configmaps "app-confg" not found

# 해결: optional: true 설정 (없어도 Pod 시작 가능)
env:
  - name: DB_HOST
    valueFrom:
      configMapKeyRef:
        name: app-config
        key: DB_HOST
        optional: true         # ConfigMap이 없어도 Pod 시작
```

### 실수 3: subPath 사용 시 자동 갱신 기대

```yaml
# subPath로 마운트하면 ConfigMap 업데이트가 반영되지 않음!
volumeMounts:
  - name: config
    mountPath: /etc/nginx/conf.d/custom.conf
    subPath: custom.conf       # 자동 갱신 안 됨

# 해결: 디렉토리 전체 마운트 (자동 갱신) 또는 Pod 재시작
volumeMounts:
  - name: config
    mountPath: /etc/nginx/custom-conf.d  # 별도 디렉토리에 마운트
```

### 실수 4: Base64 인코딩 시 줄바꿈 포함

```bash
# 잘못된 예: echo는 기본적으로 줄바꿈(\n) 추가
echo 'admin' | base64
# YWRtaW4K          <- 마지막에 \n 포함!

# 올바른 예: echo -n으로 줄바꿈 제거
echo -n 'admin' | base64
# YWRtaW4=          <- 정확한 인코딩
```

---

## 6. kubectl 참고 명령

```bash
# ConfigMap 관련
kubectl create configmap <name> --from-literal=key=value
kubectl create configmap <name> --from-file=file.conf
kubectl create configmap <name> --from-env-file=app.env
kubectl get configmap <name> -o yaml
kubectl describe configmap <name>
kubectl edit configmap <name>
kubectl delete configmap <name>

# Secret 관련
kubectl create secret generic <name> --from-literal=key=value
kubectl create secret docker-registry <name> --docker-server=... --docker-username=... --docker-password=...
kubectl create secret tls <name> --cert=cert.pem --key=key.pem
kubectl get secret <name> -o yaml
kubectl get secret <name> -o jsonpath='{.data.key}' | base64 -d
kubectl describe secret <name>
kubectl delete secret <name>
```

---

## 7. 복습 체크리스트

- [ ] Immutable ConfigMap/Secret의 장점과 제한을 안다
- [ ] ConfigMap + Secret 조합 패턴을 사용할 수 있다
- [ ] nginx 설정을 ConfigMap으로 관리할 수 있다
- [ ] Projected Volume으로 여러 소스를 통합 마운트할 수 있다
- [ ] Secret의 data(Base64)와 stringData(평문) 차이를 안다
- [ ] `echo -n`으로 Base64 인코딩 시 줄바꿈을 제거해야 하는 이유를 안다
- [ ] ConfigMap/Secret 관련 실전 문제를 시간 내에 풀 수 있다

---

## tart-infra 실습

### 실습 환경 설정

```bash
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: ConfigMap 확인

```bash
# 클러스터의 ConfigMap 확인
kubectl get configmap -n demo
kubectl describe configmap -n demo

# kube-system의 ConfigMap (coredns 등)
kubectl get configmap -n kube-system
kubectl describe configmap coredns -n kube-system
```

### 실습 2: Secret 확인

```bash
# 클러스터의 Secret 확인
kubectl get secret -n demo
kubectl get secret -n demo -o yaml

# Secret 타입 확인
kubectl get secret -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"\t"}{.metadata.name}{"\t"}{.type}{"\n"}{end}' | head -20

# ServiceAccount Token Secret 확인
kubectl get secret -n kube-system | grep service-account
```

### 실습 3: ConfigMap 생성 및 사용 실습

```bash
# ConfigMap 생성
kubectl create configmap test-config \
  --from-literal=ENV=dev \
  --from-literal=DEBUG=true \
  -n demo

# Pod에서 사용
kubectl run test-cm --image=busybox:1.36 -n demo \
  --command -- sh -c "echo \$ENV \$DEBUG && sleep 3600" \
  --overrides='{
    "spec": {
      "containers": [{
        "name": "test-cm",
        "image": "busybox:1.36",
        "command": ["sh","-c","env | grep -E \"ENV|DEBUG\" && sleep 3600"],
        "envFrom": [{"configMapRef": {"name": "test-config"}}]
      }]
    }
  }'

# 로그 확인
kubectl logs test-cm -n demo

# 정리
kubectl delete pod test-cm -n demo
kubectl delete configmap test-config -n demo
```
