# KCNA 실전 예제 모음

> 이 문서는 KCNA 시험 준비를 위한 실전 YAML 예제와 kubectl 명령어를 종합적으로 정리한 것이다.

---

## 1. Pod

### 1.1 기본 Pod YAML

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx-pod
  labels:
    app: nginx
    env: dev
  annotations:
    description: "기본 Nginx Pod 예제"
spec:
  containers:
  - name: nginx
    image: nginx:1.25
    ports:
    - containerPort: 80
    resources:
      requests:
        cpu: "100m"
        memory: "128Mi"
      limits:
        cpu: "250m"
        memory: "256Mi"
    livenessProbe:
      httpGet:
        path: /
        port: 80
      initialDelaySeconds: 10
      periodSeconds: 5
    readinessProbe:
      httpGet:
        path: /
        port: 80
      initialDelaySeconds: 5
      periodSeconds: 3
  restartPolicy: Always
```

### 1.2 멀티컨테이너 Pod (Sidecar 패턴)

아래 예제는 메인 애플리케이션 컨테이너와 로그를 수집하는 사이드카 컨테이너를 함께 실행하는 Pod이다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: multi-container-pod
  labels:
    app: web-with-logging
spec:
  containers:
  # 메인 애플리케이션 컨테이너
  - name: app
    image: nginx:1.25
    ports:
    - containerPort: 80
    volumeMounts:
    - name: shared-logs
      mountPath: /var/log/nginx

  # 사이드카: 로그 수집 컨테이너
  - name: log-collector
    image: busybox:1.36
    command: ["sh", "-c", "tail -f /var/log/nginx/access.log"]
    volumeMounts:
    - name: shared-logs
      mountPath: /var/log/nginx

  volumes:
  - name: shared-logs
    emptyDir: {}
```

### 1.3 Init Container가 포함된 Pod

Init Container는 앱 컨테이너가 시작되기 전에 순차적으로 실행 완료되어야 하는 컨테이너이다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: init-container-pod
spec:
  initContainers:
  - name: init-db-check
    image: busybox:1.36
    command: ['sh', '-c', 'until nslookup my-database-service; do echo "DB 서비스 대기 중..."; sleep 2; done']
  - name: init-config
    image: busybox:1.36
    command: ['sh', '-c', 'echo "설정 초기화 완료" > /work-dir/config.txt']
    volumeMounts:
    - name: config-volume
      mountPath: /work-dir

  containers:
  - name: app
    image: nginx:1.25
    ports:
    - containerPort: 80
    volumeMounts:
    - name: config-volume
      mountPath: /usr/share/nginx/html

  volumes:
  - name: config-volume
    emptyDir: {}
```

---

## 2. Deployment

### 2.1 기본 Deployment YAML

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
  labels:
    app: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1          # 추가로 생성 가능한 Pod 수
      maxUnavailable: 0    # 사용 불가능한 Pod 수 (0이면 무중단)
  template:
    metadata:
      labels:
        app: nginx
        version: v1
    spec:
      containers:
      - name: nginx
        image: nginx:1.25
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            cpu: "500m"
            memory: "256Mi"
        env:
        - name: NGINX_ENV
          value: "production"
```

### 2.2 Recreate 전략 Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-recreate
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  strategy:
    type: Recreate    # 기존 Pod를 모두 종료 후 새 Pod 생성
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
      - name: myapp
        image: myapp:2.0
        ports:
        - containerPort: 8080
```

---

## 3. Service

### 3.1 ClusterIP Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-clusterip
spec:
  type: ClusterIP      # 기본값이므로 생략 가능
  selector:
    app: nginx
  ports:
  - protocol: TCP
    port: 80            # 서비스 포트 (클러스터 내부에서 접근하는 포트)
    targetPort: 80      # Pod의 컨테이너 포트
```

- 클러스터 내부에서 `nginx-clusterip:80` 또는 `nginx-clusterip.default.svc.cluster.local:80`으로 접근 가능하다.

### 3.2 NodePort Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-nodeport
spec:
  type: NodePort
  selector:
    app: nginx
  ports:
  - protocol: TCP
    port: 80            # 서비스 포트
    targetPort: 80      # Pod의 컨테이너 포트
    nodePort: 30080     # 노드의 외부 포트 (30000-32767, 생략 시 자동 할당)
```

- 외부에서 `<노드IP>:30080`으로 접근 가능하다.

### 3.3 LoadBalancer Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-loadbalancer
spec:
  type: LoadBalancer
  selector:
    app: nginx
  ports:
  - protocol: TCP
    port: 80
    targetPort: 80
  externalTrafficPolicy: Local  # 클라이언트 소스 IP 보존
```

### 3.4 ExternalName Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: external-db
spec:
  type: ExternalName
  externalName: database.example.com    # 외부 DNS 이름
```

- 클러스터 내부에서 `external-db`로 접근하면 `database.example.com`으로 CNAME 리다이렉션된다.

### 3.5 Headless Service (StatefulSet용)

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-headless
spec:
  clusterIP: None       # Headless Service
  selector:
    app: nginx
  ports:
  - port: 80
    targetPort: 80
```

---

## 4. ConfigMap

### 4.1 kubectl로 ConfigMap 생성

```bash
# 리터럴 값으로 생성
kubectl create configmap app-config \
  --from-literal=DB_HOST=mysql-service \
  --from-literal=DB_PORT=3306 \
  --from-literal=LOG_LEVEL=info

# 파일로 생성
kubectl create configmap nginx-config \
  --from-file=nginx.conf

# 디렉토리의 모든 파일로 생성
kubectl create configmap app-configs \
  --from-file=config/

# ConfigMap 조회
kubectl get configmap app-config -o yaml
kubectl describe configmap app-config
```

### 4.2 YAML로 ConfigMap 정의

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  DB_HOST: "mysql-service"
  DB_PORT: "3306"
  LOG_LEVEL: "info"
  app.properties: |
    server.port=8080
    spring.datasource.url=jdbc:mysql://mysql-service:3306/mydb
    logging.level.root=INFO
```

### 4.3 Pod에서 ConfigMap을 환경 변수로 사용

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-config-env
spec:
  containers:
  - name: app
    image: myapp:1.0
    env:
    # 개별 키를 환경 변수로 매핑
    - name: DATABASE_HOST
      valueFrom:
        configMapKeyRef:
          name: app-config
          key: DB_HOST
    - name: DATABASE_PORT
      valueFrom:
        configMapKeyRef:
          name: app-config
          key: DB_PORT
    # ConfigMap의 모든 키를 환경 변수로 한번에 로드
    envFrom:
    - configMapRef:
        name: app-config
```

### 4.4 Pod에서 ConfigMap을 볼륨으로 마운트

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-config-volume
spec:
  containers:
  - name: app
    image: myapp:1.0
    volumeMounts:
    - name: config-volume
      mountPath: /etc/config    # 이 디렉토리에 ConfigMap의 각 키가 파일로 생성된다
      readOnly: true
  volumes:
  - name: config-volume
    configMap:
      name: app-config
      items:                    # 특정 키만 마운트 (생략 시 모든 키 마운트)
      - key: app.properties
        path: application.properties   # 파일명 지정
```

---

## 5. Secret

### 5.1 kubectl로 Secret 생성

```bash
# 리터럴 값으로 생성
kubectl create secret generic db-credentials \
  --from-literal=username=admin \
  --from-literal=password='S3cur3P@ss!'

# 파일로 생성
kubectl create secret generic tls-certs \
  --from-file=tls.crt=server.crt \
  --from-file=tls.key=server.key

# Docker 레지스트리 인증 Secret 생성
kubectl create secret docker-registry my-registry-secret \
  --docker-server=registry.example.com \
  --docker-username=user \
  --docker-password=password \
  --docker-email=user@example.com

# Secret 조회
kubectl get secret db-credentials -o yaml
# Base64 디코딩
kubectl get secret db-credentials -o jsonpath='{.data.password}' | base64 -d
```

### 5.2 YAML로 Secret 정의

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
type: Opaque
data:
  # 값은 Base64로 인코딩해야 한다
  # echo -n 'admin' | base64 => YWRtaW4=
  username: YWRtaW4=
  # echo -n 'S3cur3P@ss!' | base64 => UzNjdXIzUEBzcyE=
  password: UzNjdXIzUEBzcyE=
---
# stringData를 사용하면 평문으로 작성 가능 (K8s가 자동으로 Base64 인코딩)
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials-plain
type: Opaque
stringData:
  username: admin
  password: "S3cur3P@ss!"
```

### 5.3 Pod에서 Secret 사용

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-secret
spec:
  containers:
  - name: app
    image: myapp:1.0
    # 환경 변수로 Secret 사용
    env:
    - name: DB_USERNAME
      valueFrom:
        secretKeyRef:
          name: db-credentials
          key: username
    - name: DB_PASSWORD
      valueFrom:
        secretKeyRef:
          name: db-credentials
          key: password
    # 볼륨으로 Secret 마운트
    volumeMounts:
    - name: secret-volume
      mountPath: /etc/secrets
      readOnly: true
  # Docker 레지스트리 Secret 사용
  imagePullSecrets:
  - name: my-registry-secret
  volumes:
  - name: secret-volume
    secret:
      secretName: db-credentials
      defaultMode: 0400    # 파일 권한 설정
```

---

## 6. PersistentVolume & PersistentVolumeClaim

### 6.1 PersistentVolume (PV)

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: my-pv
  labels:
    type: local
spec:
  capacity:
    storage: 10Gi
  accessModes:
  - ReadWriteOnce              # 하나의 노드에서 읽기/쓰기
  persistentVolumeReclaimPolicy: Retain   # PVC 삭제 시 PV 보존
  storageClassName: manual
  hostPath:
    path: /data/my-pv          # 노드의 로컬 경로 (테스트 용도)
---
# NFS PV 예제
apiVersion: v1
kind: PersistentVolume
metadata:
  name: nfs-pv
spec:
  capacity:
    storage: 50Gi
  accessModes:
  - ReadWriteMany              # 여러 노드에서 읽기/쓰기
  persistentVolumeReclaimPolicy: Retain
  storageClassName: nfs
  nfs:
    server: 192.168.1.100
    path: /exports/data
```

### 6.2 PersistentVolumeClaim (PVC)

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi             # 요청 용량 (PV의 용량 이하)
  storageClassName: manual     # PV의 storageClassName과 일치해야 한다
```

### 6.3 Pod에서 PVC 사용

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-pvc
spec:
  containers:
  - name: app
    image: myapp:1.0
    volumeMounts:
    - name: data-volume
      mountPath: /app/data
  volumes:
  - name: data-volume
    persistentVolumeClaim:
      claimName: my-pvc
```

### 6.4 StorageClass (동적 프로비저닝)

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: kubernetes.io/aws-ebs   # AWS EBS 프로비저너
parameters:
  type: gp3
  fsType: ext4
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer   # Pod 스케줄링 시 바인딩
allowVolumeExpansion: true                # 볼륨 확장 허용
---
# 동적 프로비저닝을 사용하는 PVC
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: dynamic-pvc
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
  storageClassName: fast-ssd    # StorageClass를 지정하면 PV가 자동 생성된다
```

---

## 7. StatefulSet

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
spec:
  serviceName: mysql-headless    # Headless Service 이름
  replicas: 3
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      containers:
      - name: mysql
        image: mysql:8.0
        ports:
        - containerPort: 3306
        env:
        - name: MYSQL_ROOT_PASSWORD
          valueFrom:
            secretKeyRef:
              name: mysql-secret
              key: root-password
        volumeMounts:
        - name: data
          mountPath: /var/lib/mysql
  volumeClaimTemplates:          # 각 Pod에 독립적인 PVC가 생성된다
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: fast-ssd
      resources:
        requests:
          storage: 10Gi
```

- Pod 이름은 `mysql-0`, `mysql-1`, `mysql-2` 순서로 고정된다.
- 각 Pod에 `data-mysql-0`, `data-mysql-1`, `data-mysql-2`라는 PVC가 생성된다.
- DNS: `mysql-0.mysql-headless.default.svc.cluster.local`로 개별 Pod에 접근 가능하다.

---

## 8. DaemonSet

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd
  namespace: kube-system
  labels:
    app: fluentd
spec:
  selector:
    matchLabels:
      app: fluentd
  template:
    metadata:
      labels:
        app: fluentd
    spec:
      tolerations:
      - key: node-role.kubernetes.io/control-plane
        effect: NoSchedule       # 마스터 노드에도 배포 허용
      containers:
      - name: fluentd
        image: fluentd:v1.16
        resources:
          limits:
            cpu: "200m"
            memory: "200Mi"
          requests:
            cpu: "100m"
            memory: "100Mi"
        volumeMounts:
        - name: varlog
          mountPath: /var/log
        - name: containers
          mountPath: /var/lib/docker/containers
          readOnly: true
      volumes:
      - name: varlog
        hostPath:
          path: /var/log
      - name: containers
        hostPath:
          path: /var/lib/docker/containers
```

---

## 9. Job & CronJob

### 9.1 Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: data-migration
spec:
  completions: 5          # 5개 Pod가 성공적으로 완료되어야 한다
  parallelism: 2           # 동시에 2개 Pod를 실행한다
  backoffLimit: 3          # 최대 3번 재시도한다
  activeDeadlineSeconds: 600  # 최대 10분 실행
  template:
    spec:
      containers:
      - name: migration
        image: myapp:migrate
        command: ["python", "migrate.py"]
        env:
        - name: DB_HOST
          value: "mysql-service"
      restartPolicy: Never    # Job에서는 Never 또는 OnFailure만 허용된다
```

### 9.2 CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-backup
spec:
  schedule: "0 2 * * *"         # 매일 새벽 2시에 실행
  concurrencyPolicy: Forbid     # 이전 Job이 실행 중이면 건너뛴다
  successfulJobsHistoryLimit: 3 # 성공한 Job 이력 3개 유지
  failedJobsHistoryLimit: 1     # 실패한 Job 이력 1개 유지
  startingDeadlineSeconds: 300  # 스케줄 후 5분 내에 시작 못하면 건너뛴다
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: myapp:backup
            command: ["/bin/sh", "-c", "pg_dump mydb > /backup/dump_$(date +%Y%m%d).sql"]
            volumeMounts:
            - name: backup-storage
              mountPath: /backup
          volumes:
          - name: backup-storage
            persistentVolumeClaim:
              claimName: backup-pvc
          restartPolicy: OnFailure
```

---

## 10. HPA (Horizontal Pod Autoscaler)

### 10.1 kubectl로 HPA 생성

```bash
# CPU 사용률 70%를 기준으로 자동 스케일링 (최소 2, 최대 10)
kubectl autoscale deployment nginx-deployment \
  --min=2 \
  --max=10 \
  --cpu-percent=70

# HPA 상태 확인
kubectl get hpa
kubectl describe hpa nginx-deployment
```

### 10.2 HPA YAML (v2 API)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nginx-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-deployment
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70    # 평균 CPU 사용률 70%
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80    # 평균 메모리 사용률 80%
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # 스케일다운 안정화 기간 (5분)
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60              # 1분마다 최대 10% 축소
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
      - type: Percent
        value: 100
        periodSeconds: 15              # 15초마다 최대 100% 확장
```

> HPA가 동작하려면 Pod에 `resources.requests`가 설정되어 있어야 하고, `metrics-server`가 설치되어 있어야 한다.

---

## 11. Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - app.example.com
    secretName: tls-secret
  rules:
  - host: app.example.com
    http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: api-service
            port:
              number: 8080
      - path: /
        pathType: Prefix
        backend:
          service:
            name: frontend-service
            port:
              number: 80
```

---

## 12. NetworkPolicy

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: default
spec:
  podSelector:
    matchLabels:
      app: backend         # 이 정책이 적용되는 Pod
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: frontend    # frontend Pod에서만 수신 허용
    ports:
    - protocol: TCP
      port: 8080
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: database    # database Pod로만 송신 허용
    ports:
    - protocol: TCP
      port: 3306
```

---

## 13. RBAC

```yaml
# Role: 네임스페이스 내 권한 정의
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: dev
  name: pod-reader
rules:
- apiGroups: [""]         # "" = core API group
  resources: ["pods"]
  verbs: ["get", "watch", "list"]
- apiGroups: [""]
  resources: ["pods/log"]
  verbs: ["get"]
---
# RoleBinding: Role을 사용자에게 바인딩
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods
  namespace: dev
subjects:
- kind: User
  name: developer1
  apiGroup: rbac.authorization.k8s.io
- kind: ServiceAccount
  name: ci-bot
  namespace: dev
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

---

## 14. ResourceQuota & LimitRange

```yaml
# ResourceQuota: 네임스페이스의 전체 리소스 한도
apiVersion: v1
kind: ResourceQuota
metadata:
  name: dev-quota
  namespace: dev
spec:
  hard:
    requests.cpu: "4"
    requests.memory: "8Gi"
    limits.cpu: "8"
    limits.memory: "16Gi"
    pods: "20"
    services: "10"
    persistentvolumeclaims: "5"
---
# LimitRange: 개별 Pod/Container의 기본값과 범위 설정
apiVersion: v1
kind: LimitRange
metadata:
  name: dev-limits
  namespace: dev
spec:
  limits:
  - type: Container
    default:              # limits 기본값
      cpu: "500m"
      memory: "256Mi"
    defaultRequest:       # requests 기본값
      cpu: "100m"
      memory: "128Mi"
    min:
      cpu: "50m"
      memory: "64Mi"
    max:
      cpu: "2"
      memory: "2Gi"
```

---

## 15. Helm

### 15.1 Helm 기본 구조

```
mychart/
  Chart.yaml          # Chart 메타데이터
  values.yaml         # 기본 설정 값
  charts/             # 의존성 차트
  templates/          # K8s 매니페스트 템플릿
    deployment.yaml
    service.yaml
    ingress.yaml
    hpa.yaml
    serviceaccount.yaml
    _helpers.tpl      # 템플릿 헬퍼 함수
    NOTES.txt         # 설치 후 출력할 안내 메시지
    tests/            # 테스트 템플릿
      test-connection.yaml
```

### 15.2 Chart.yaml 예제

```yaml
apiVersion: v2
name: myapp
description: My Application Helm Chart
type: application
version: 0.1.0        # Chart 버전
appVersion: "1.0.0"   # 애플리케이션 버전
dependencies:
- name: mysql
  version: "9.0.0"
  repository: "https://charts.bitnami.com/bitnami"
  condition: mysql.enabled
```

### 15.3 values.yaml 예제

```yaml
replicaCount: 3

image:
  repository: myapp
  tag: "1.0.0"
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 80

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70

mysql:
  enabled: true
```

### 15.4 templates/deployment.yaml 예제

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "myapp.fullname" . }}
  labels:
    {{- include "myapp.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "myapp.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "myapp.selectorLabels" . | nindent 8 }}
    spec:
      containers:
      - name: {{ .Chart.Name }}
        image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
        imagePullPolicy: {{ .Values.image.pullPolicy }}
        ports:
        - containerPort: 80
        resources:
          {{- toYaml .Values.resources | nindent 12 }}
```

### 15.5 Helm 주요 명령어

```bash
# 레포지토리 관리
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
helm repo list
helm search repo nginx
helm search hub wordpress        # Artifact Hub에서 검색

# Chart 설치
helm install my-release bitnami/nginx
helm install my-release bitnami/nginx --namespace web --create-namespace
helm install my-release bitnami/nginx -f custom-values.yaml
helm install my-release bitnami/nginx --set replicaCount=3,service.type=NodePort

# 설치된 릴리스 관리
helm list                         # 설치된 릴리스 목록
helm list --all-namespaces       # 모든 네임스페이스의 릴리스

# 업그레이드
helm upgrade my-release bitnami/nginx --set replicaCount=5
helm upgrade my-release bitnami/nginx -f new-values.yaml
helm upgrade --install my-release bitnami/nginx   # 없으면 설치, 있으면 업그레이드

# 롤백
helm rollback my-release 1       # 리비전 1로 롤백
helm history my-release          # 릴리스 이력 조회

# 삭제
helm uninstall my-release
helm uninstall my-release --keep-history   # 이력 보존

# 디버깅/확인
helm template my-release bitnami/nginx     # 렌더링된 매니페스트 확인 (설치 없이)
helm get values my-release                 # 현재 설정 값 확인
helm get manifest my-release               # 실제 적용된 매니페스트 확인
helm show values bitnami/nginx             # Chart의 기본 values.yaml 확인
helm show chart bitnami/nginx              # Chart 정보 확인

# Chart 생성
helm create mychart                        # 새 Chart 스캐폴딩 생성
helm package mychart                       # Chart를 .tgz로 패키징
helm lint mychart                          # Chart 유효성 검사
```

---

## 16. Kustomize

### 16.1 기본 구조

```
kustomize-example/
  base/
    kustomization.yaml
    deployment.yaml
    service.yaml
  overlays/
    dev/
      kustomization.yaml
      replica-patch.yaml
    prod/
      kustomization.yaml
      replica-patch.yaml
```

### 16.2 base/kustomization.yaml

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
- deployment.yaml
- service.yaml

commonLabels:
  app: myapp
```

### 16.3 overlays/prod/kustomization.yaml

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
- ../../base

namePrefix: prod-
nameSuffix: -v1

commonLabels:
  env: production

patches:
- path: replica-patch.yaml

images:
- name: myapp
  newTag: "2.0.0"

configMapGenerator:
- name: app-config
  literals:
  - LOG_LEVEL=warn
  - DB_HOST=prod-mysql
```

### 16.4 Kustomize 명령어

```bash
# 빌드 (렌더링된 매니페스트 확인)
kubectl kustomize overlays/prod/
kustomize build overlays/prod/

# 적용
kubectl apply -k overlays/prod/

# 삭제
kubectl delete -k overlays/prod/
```

---

## 17. kubectl 명령어 종합 정리

### 17.1 리소스 생성/관리

```bash
# Pod 생성 (명령적 방식)
kubectl run nginx --image=nginx:1.25
kubectl run nginx --image=nginx:1.25 --port=80
kubectl run nginx --image=nginx:1.25 --dry-run=client -o yaml > pod.yaml  # YAML 생성만

# Deployment 생성 (명령적 방식)
kubectl create deployment nginx-deploy --image=nginx:1.25 --replicas=3

# Service 생성 (명령적 방식)
kubectl expose deployment nginx-deploy --port=80 --target-port=80 --type=ClusterIP
kubectl expose deployment nginx-deploy --port=80 --type=NodePort

# 선언적 방식 (권장)
kubectl apply -f deployment.yaml
kubectl apply -f ./manifests/                  # 디렉토리의 모든 YAML 적용
kubectl apply -f https://example.com/app.yaml  # URL에서 적용
```

### 17.2 리소스 조회

```bash
# 기본 조회
kubectl get pods
kubectl get pods -o wide                        # 노드, IP 등 추가 정보
kubectl get pods -o yaml                        # YAML 형식
kubectl get pods -o json                        # JSON 형식
kubectl get pods --all-namespaces               # 모든 네임스페이스 (-A 약어)
kubectl get pods -n kube-system                 # 특정 네임스페이스
kubectl get pods -l app=nginx                   # 라벨 셀렉터
kubectl get pods -l 'env in (dev,staging)'      # 집합 기반 셀렉터
kubectl get pods --field-selector status.phase=Running  # 필드 셀렉터
kubectl get pods --sort-by=.metadata.creationTimestamp  # 정렬
kubectl get pods -w                             # 변경 사항 실시간 감시

# 여러 리소스 동시 조회
kubectl get pods,svc,deploy
kubectl get all                                 # 주요 리소스 모두 조회

# 상세 정보
kubectl describe pod nginx-pod
kubectl describe node worker-1
kubectl describe deployment nginx-deploy

# 커스텀 컬럼 출력
kubectl get pods -o custom-columns='NAME:.metadata.name,STATUS:.status.phase,NODE:.spec.nodeName'

# jsonpath로 특정 값 추출
kubectl get pod nginx -o jsonpath='{.status.podIP}'
kubectl get nodes -o jsonpath='{.items[*].status.addresses[?(@.type=="InternalIP")].address}'
```

### 17.3 스케일링 & 롤아웃

```bash
# 스케일링
kubectl scale deployment nginx-deploy --replicas=5

# 롤아웃 관련
kubectl rollout status deployment nginx-deploy
kubectl rollout history deployment nginx-deploy
kubectl rollout history deployment nginx-deploy --revision=2   # 특정 리비전 상세
kubectl rollout undo deployment nginx-deploy                    # 이전 버전으로 롤백
kubectl rollout undo deployment nginx-deploy --to-revision=1   # 특정 리비전으로 롤백
kubectl rollout pause deployment nginx-deploy                   # 롤아웃 일시중지
kubectl rollout resume deployment nginx-deploy                  # 롤아웃 재개
kubectl rollout restart deployment nginx-deploy                 # 재시작 (이미지 변경 없이 Pod 재생성)

# 이미지 업데이트
kubectl set image deployment/nginx-deploy nginx=nginx:1.26
```

### 17.4 디버깅

```bash
# 로그 확인
kubectl logs nginx-pod
kubectl logs nginx-pod -c sidecar-container     # 특정 컨테이너 로그
kubectl logs nginx-pod -f                        # 실시간 로그 스트리밍
kubectl logs nginx-pod --previous                # 이전 컨테이너 로그 (재시작된 경우)
kubectl logs nginx-pod --since=1h                # 최근 1시간 로그
kubectl logs nginx-pod --tail=100                # 마지막 100줄
kubectl logs -l app=nginx --all-containers       # 라벨로 여러 Pod 로그

# 컨테이너 내부 명령 실행
kubectl exec nginx-pod -- ls /etc/nginx
kubectl exec -it nginx-pod -- /bin/bash          # 인터랙티브 쉘
kubectl exec -it nginx-pod -c sidecar -- /bin/sh # 특정 컨테이너 쉘

# 포트 포워딩
kubectl port-forward pod/nginx-pod 8080:80
kubectl port-forward svc/nginx-service 8080:80
kubectl port-forward deployment/nginx-deploy 8080:80

# 리소스 사용량 확인 (metrics-server 필요)
kubectl top nodes
kubectl top pods
kubectl top pods --containers                    # 컨테이너별 사용량
kubectl top pods --sort-by=cpu
kubectl top pods --sort-by=memory

# 이벤트 확인
kubectl get events --sort-by='.lastTimestamp'
kubectl get events -n kube-system

# 리소스 문서 조회
kubectl explain pod
kubectl explain pod.spec
kubectl explain pod.spec.containers
kubectl explain pod.spec.containers.resources
kubectl explain deployment.spec.strategy
```

### 17.5 삭제

```bash
kubectl delete pod nginx-pod
kubectl delete pod nginx-pod --grace-period=0 --force   # 강제 삭제
kubectl delete -f deployment.yaml
kubectl delete deployment nginx-deploy
kubectl delete pods -l app=nginx                          # 라벨로 삭제
kubectl delete all -l app=nginx                           # 관련 리소스 모두 삭제
kubectl delete namespace dev                              # 네임스페이스와 내부 리소스 모두 삭제
```

### 17.6 기타 유용한 명령어

```bash
# 라벨 관리
kubectl label pod nginx-pod env=production
kubectl label pod nginx-pod env-                          # 라벨 제거 (키 뒤에 - 추가)
kubectl label pod nginx-pod env=staging --overwrite       # 라벨 변경

# 어노테이션 관리
kubectl annotate pod nginx-pod description="test pod"
kubectl annotate pod nginx-pod description-               # 어노테이션 제거

# Taint & Toleration
kubectl taint nodes node1 key=value:NoSchedule            # Taint 추가
kubectl taint nodes node1 key=value:NoSchedule-           # Taint 제거

# 노드 관리
kubectl cordon node1                                       # 스케줄링 불가 설정
kubectl uncordon node1                                     # 스케줄링 가능 복원
kubectl drain node1 --ignore-daemonsets --delete-emptydir-data  # Pod 퇴거

# 컨텍스트/클러스터 관리
kubectl config view
kubectl config get-contexts
kubectl config use-context my-cluster
kubectl config set-context --current --namespace=dev       # 기본 네임스페이스 변경

# API 리소스 정보
kubectl api-resources                                      # 사용 가능한 API 리소스
kubectl api-versions                                       # 사용 가능한 API 버전

# 리소스 수정
kubectl edit deployment nginx-deploy                       # 에디터에서 직접 수정
kubectl patch deployment nginx-deploy -p '{"spec":{"replicas":5}}'  # 패치
```

---

## 부록: YAML 작성 팁

1. **들여쓰기**: YAML은 탭이 아닌 스페이스(보통 2칸)를 사용해야 한다.
2. **`---`**: 하나의 파일에 여러 리소스를 정의할 때 구분자로 사용한다.
3. **`dry-run`**: 실제 적용 전에 `--dry-run=client -o yaml`로 YAML을 생성하고 확인하는 것이 좋다.
4. **`kubectl explain`**: 각 필드의 의미와 사용법을 빠르게 확인할 수 있다.
5. **`kubectl diff`**: `kubectl diff -f deployment.yaml`로 현재 상태와 변경될 내용의 차이를 확인할 수 있다.
