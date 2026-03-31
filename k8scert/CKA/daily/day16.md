# CKA Day 16: Storage 실전 YAML & 시험 문제

> CKA 도메인: Storage (10%) 실전 | 예상 소요 시간: 2시간

---

### 예제 12: downwardAPI 볼륨

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: downward-pod
  labels:
    app: test
spec:
  containers:
  - name: app
    image: busybox
    command: ["sh", "-c", "cat /etc/podinfo/labels && sleep 3600"]
    volumeMounts:
    - name: podinfo
      mountPath: /etc/podinfo
  volumes:
  - name: podinfo
    downwardAPI:
      items:
      - path: labels
        fieldRef:
          fieldPath: metadata.labels
      - path: name
        fieldRef:
          fieldPath: metadata.name
      - path: namespace
        fieldRef:
          fieldPath: metadata.namespace
      - path: cpu-request
        resourceFieldRef:
          containerName: app
          resource: requests.cpu
```

### 예제 13: initContainer에서 볼륨 초기화

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: init-volume-pod
spec:
  initContainers:
  - name: init
    image: busybox:1.36
    command: ["sh", "-c", "echo 'initialized' > /data/init.flag"]
    volumeMounts:
    - name: app-data
      mountPath: /data
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: app-data
      mountPath: /app/data
  volumes:
  - name: app-data
    emptyDir: {}
```

### 예제 14: hostPath로 Docker 소켓 마운트

```yaml
# Docker/containerd 소켓을 마운트하여 호스트의 컨테이너 런타임 접근
apiVersion: v1
kind: Pod
metadata:
  name: docker-socket-pod
spec:
  containers:
  - name: docker-cli
    image: docker:24-cli
    command: ["sleep", "3600"]
    volumeMounts:
    - name: docker-sock
      mountPath: /var/run/docker.sock
  volumes:
  - name: docker-sock
    hostPath:
      path: /var/run/docker.sock
      type: Socket
```

### 예제 15: PV를 volumeName으로 직접 지정

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: specific-pv
spec:
  capacity:
    storage: 10Gi
  accessModes:
  - ReadWriteOnce
  storageClassName: ""
  hostPath:
    path: /data/specific
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: specific-pvc
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
  storageClassName: ""
  volumeName: specific-pv           # 이 특정 PV에 바인딩
```

### 예제 16: StorageClass 정의 (local-path)

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-path
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: rancher.io/local-path
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
```

### 예제 17: Retain 정책 PV의 재사용

```bash
# Released 상태의 PV를 다시 Available로 만들기
kubectl get pv my-pv
# STATUS: Released

# claimRef 삭제
kubectl patch pv my-pv --type json -p '[{"op":"remove","path":"/spec/claimRef"}]'

kubectl get pv my-pv
# STATUS: Available (다시 바인딩 가능)
```

### 예제 18: kubectl 명령으로 빠른 PVC 관련 조회

```bash
# PV/PVC 조회
kubectl get pv                           # 모든 PV (클러스터 수준)
kubectl get pvc -A                       # 모든 네임스페이스의 PVC
kubectl get pvc -n demo                  # 특정 네임스페이스의 PVC
kubectl describe pv <name>              # PV 상세
kubectl describe pvc <name> -n <ns>     # PVC 상세

# StorageClass 조회
kubectl get storageclass                 # 모든 StorageClass
kubectl describe storageclass <name>     # SC 상세

# PV-PVC 관계 확인
kubectl get pv -o custom-columns='NAME:.metadata.name,CAPACITY:.spec.capacity.storage,ACCESS:.spec.accessModes[0],STATUS:.status.phase,CLAIM:.spec.claimRef.name,SC:.spec.storageClassName'

# PVC 상태 확인
kubectl get pvc -n demo -o custom-columns='NAME:.metadata.name,STATUS:.status.phase,VOLUME:.spec.volumeName,CAPACITY:.status.capacity.storage,SC:.spec.storageClassName'
```

---

## 8. 시험에서 이 주제가 어떻게 출제되는가?

### 출제 패턴 분석

```
CKA 시험의 Storage 관련 출제:
Storage 도메인 = 전체의 10%

주요 출제 유형:
1. PV + PVC 생성 및 바인딩 — 가장 빈출!
2. PVC를 사용하는 Pod 생성 — 빈출
3. emptyDir 볼륨 (Multi-Container Pod) — 빈출
4. ConfigMap/Secret 볼륨 마운트 — 빈출
5. StorageClass 확인/이해 — 가끔 출제
6. PVC Pending 문제 해결 — 트러블슈팅 연계

핵심:
- PV와 PVC의 바인딩 조건 4가지를 정확히 이해
- Pod에서 PVC를 마운트하는 YAML 구조 암기
- emptyDir로 Multi-Container Pod 구성 가능
- StorageClass의 volumeBindingMode(WaitForFirstConsumer) 이해
```

---

## 9. 시험 대비 연습 문제 (12문제)

### 문제 1. PV와 PVC 생성 [7%]

**컨텍스트:** `kubectl config use-context staging`

다음 PV와 PVC를 생성하라:
- PV: 이름 `exam-pv`, 용량 2Gi, accessMode RWO, hostPath `/opt/exam-data`, storageClassName `exam`
- PVC: 이름 `exam-pvc`, 요청 1Gi, accessMode RWO, storageClassName `exam`

<details>
<summary>풀이</summary>

```bash
kubectl config use-context staging

# PV 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolume
metadata:
  name: exam-pv
spec:
  capacity:
    storage: 2Gi               # PVC 요청(1Gi)보다 크거나 같아야 함
  accessModes:
  - ReadWriteOnce              # PVC와 일치
  persistentVolumeReclaimPolicy: Retain
  storageClassName: exam       # PVC와 일치
  hostPath:
    path: /opt/exam-data
    type: DirectoryOrCreate
EOF

# PVC 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: exam-pvc
spec:
  accessModes:
  - ReadWriteOnce              # PV와 일치
  resources:
    requests:
      storage: 1Gi             # PV capacity(2Gi) 이하
  storageClassName: exam       # PV와 일치
EOF

# 바인딩 확인
kubectl get pv exam-pv
kubectl get pvc exam-pvc
```

**검증 기대 출력:**

```text
# kubectl get pv exam-pv
NAME      CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM              STORAGECLASS   AGE
exam-pv   2Gi        RWO            Retain           Bound    default/exam-pvc   exam           5s

# kubectl get pvc exam-pvc
NAME       STATUS   VOLUME    CAPACITY   ACCESS MODES   STORAGECLASS   AGE
exam-pvc   Bound    exam-pv   2Gi        RWO            exam           5s
```

```bash
# 정리
kubectl delete pvc exam-pvc
kubectl delete pv exam-pv
```

**바인딩 확인 포인트:**
- accessModes 일치 (둘 다 RWO)
- capacity(2Gi) >= request(1Gi)
- storageClassName 일치 (둘 다 exam)

**트러블슈팅:** PVC가 Pending 상태로 남아 있으면 `kubectl describe pvc exam-pvc`의 Events를 확인한다. "no persistent volumes available"이면 바인딩 조건 4가지(accessModes, capacity, storageClassName, selector)를 하나씩 대조한다.

</details>

---

### 문제 2. PVC를 사용하는 Pod 생성 [4%]

**컨텍스트:** `kubectl config use-context dev`

`demo` 네임스페이스에 다음 Pod를 생성하라:
- 이름: `data-pod`
- 이미지: `nginx`
- PVC `app-data-pvc`(1Gi, RWO, StorageClass: local-path)를 `/usr/share/nginx/html`에 마운트

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# PVC 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data-pvc
  namespace: demo
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: local-path
EOF

# Pod 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: data-pod
  namespace: demo
spec:
  containers:
  - name: nginx
    image: nginx
    volumeMounts:
    - name: web-data               # volumes의 name과 매칭
      mountPath: /usr/share/nginx/html
  volumes:
  - name: web-data
    persistentVolumeClaim:
      claimName: app-data-pvc      # PVC 이름
EOF

# 확인
kubectl get pod data-pod -n demo
kubectl get pvc app-data-pvc -n demo
```

**검증 기대 출력:**

```text
# kubectl get pod data-pod -n demo
NAME       READY   STATUS    RESTARTS   AGE
data-pod   1/1     Running   0          10s

# kubectl get pvc app-data-pvc -n demo
NAME           STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS   AGE
app-data-pvc   Bound    pvc-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx   1Gi        RWO            local-path     15s
```

**내부 동작 원리:** `storageClassName: local-path`를 지정하면 Dynamic Provisioning이 작동한다. `local-path` StorageClass는 `volumeBindingMode: WaitForFirstConsumer`이므로, PVC만 생성하면 Pending 상태로 유지된다. Pod가 생성되어 스케줄링이 결정된 후에야 해당 노드에 PV가 자동 생성되고 바인딩된다.

```bash
# 정리
kubectl delete pod data-pod -n demo
kubectl delete pvc app-data-pvc -n demo
```

</details>

---

### 문제 3. emptyDir 볼륨으로 Multi-Container Pod [4%]

**컨텍스트:** `kubectl config use-context dev`

두 개의 컨테이너가 emptyDir 볼륨을 공유하는 Pod를 생성하라:
- Pod 이름: `sidecar-pod`, 네임스페이스: `demo`
- 컨테이너 1: `main` (nginx), 볼륨을 `/var/log/nginx`에 마운트
- 컨테이너 2: `sidecar` (busybox:1.36), 볼륨을 `/logs`에 읽기 전용 마운트
  - 명령: `tail -f /logs/access.log`

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: sidecar-pod
  namespace: demo
spec:
  containers:
  - name: main
    image: nginx
    volumeMounts:
    - name: logs
      mountPath: /var/log/nginx
  - name: sidecar
    image: busybox:1.36
    command: ["sh", "-c", "tail -f /logs/access.log"]
    volumeMounts:
    - name: logs
      mountPath: /logs
      readOnly: true               # 읽기 전용
  volumes:
  - name: logs
    emptyDir: {}                   # Pod와 수명이 같은 임시 볼륨
EOF

# 확인
kubectl get pod sidecar-pod -n demo
kubectl logs sidecar-pod -c sidecar -n demo

# 정리
kubectl delete pod sidecar-pod -n demo
```

</details>

---

### 문제 4. ConfigMap을 볼륨으로 마운트 [4%]

**컨텍스트:** `kubectl config use-context dev`

1. `demo` 네임스페이스에 `nginx-config` ConfigMap 생성 (key: `default.conf`, value: nginx 설정)
2. 이 ConfigMap을 Pod의 `/etc/nginx/conf.d/`에 마운트하라

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# ConfigMap 생성
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-config
  namespace: demo
data:
  default.conf: |
    server {
        listen 80;
        server_name localhost;
        location / {
            root /usr/share/nginx/html;
            index index.html;
        }
    }
EOF

# Pod 생성 — ConfigMap을 볼륨으로 마운트
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: nginx-custom
  namespace: demo
spec:
  containers:
  - name: nginx
    image: nginx
    volumeMounts:
    - name: nginx-conf
      mountPath: /etc/nginx/conf.d     # ConfigMap이 마운트될 디렉터리
  volumes:
  - name: nginx-conf
    configMap:
      name: nginx-config               # ConfigMap 이름
EOF

# 확인
kubectl exec nginx-custom -n demo -- cat /etc/nginx/conf.d/default.conf
```

**검증 기대 출력:**

```text
server {
    listen 80;
    server_name localhost;
    location / {
        root /usr/share/nginx/html;
        index index.html;
    }
}
```

**내부 동작 원리:** ConfigMap 볼륨 마운트 시, ConfigMap의 각 key가 마운트 디렉터리 내 파일 이름이 되고, value가 파일 내용이 된다. kubelet이 ConfigMap 변경을 감지하면 마운트된 파일도 자동으로 업데이트된다(단, subPath 사용 시에는 자동 업데이트되지 않는다).

```bash
# 정리
kubectl delete pod nginx-custom -n demo
kubectl delete configmap nginx-config -n demo
```

</details>

---

### 문제 5. Secret을 볼륨으로 마운트 [4%]

**컨텍스트:** `kubectl config use-context dev`

1. Secret `db-credentials` 생성: username=admin, password=secret123
2. Pod `secret-test`에서 이 Secret을 `/etc/db-creds`에 읽기 전용으로 마운트하라

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# Secret 생성
kubectl create secret generic db-credentials \
  --from-literal=username=admin \
  --from-literal=password=secret123 \
  -n demo

# Pod 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: secret-test
  namespace: demo
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "cat /etc/db-creds/username && echo '' && cat /etc/db-creds/password && sleep 3600"]
    volumeMounts:
    - name: db-creds
      mountPath: /etc/db-creds
      readOnly: true
  volumes:
  - name: db-creds
    secret:
      secretName: db-credentials
      defaultMode: 0400               # 읽기 전용 권한
EOF

# 확인
kubectl exec secret-test -n demo -- cat /etc/db-creds/username
kubectl exec secret-test -n demo -- cat /etc/db-creds/password
```

**검증 기대 출력:**

```text
admin
secret123
```

**내부 동작 원리:** Secret은 etcd에 base64 인코딩되어 저장된다. kubelet이 Secret을 볼륨으로 마운트할 때 tmpfs(RAM 기반 파일시스템)에 디코딩된 값을 기록한다. `defaultMode: 0400`은 파일 권한을 읽기 전용(owner만)으로 설정한다. Secret이 업데이트되면 kubelet이 약 1분 내로 마운트된 파일도 갱신한다(subPath 사용 시 제외).

```bash
# 정리
kubectl delete pod secret-test -n demo
kubectl delete secret db-credentials -n demo
```

</details>

---

### 문제 6. StorageClass 확인 및 PVC 문제 해결 [7%]

**컨텍스트:** `kubectl config use-context platform`

`monitoring` 네임스페이스의 PVC 상태를 확인하고 다음 질문에 답하라:
1. PVC 이름과 용량을 `/tmp/pvc-info.txt`에 저장하라
2. 해당 PVC가 사용하는 StorageClass의 provisioner 이름을 확인하라

<details>
<summary>풀이</summary>

```bash
kubectl config use-context platform

# 1. PVC 정보 확인 및 저장
kubectl get pvc -n monitoring \
  -o custom-columns='NAME:.metadata.name,CAPACITY:.status.capacity.storage,STORAGECLASS:.spec.storageClassName' \
  > /tmp/pvc-info.txt

cat /tmp/pvc-info.txt

# 2. StorageClass provisioner 확인
SC_NAME=$(kubectl get pvc -n monitoring -o jsonpath='{.items[0].spec.storageClassName}')
echo "" >> /tmp/pvc-info.txt
echo "StorageClass: $SC_NAME" >> /tmp/pvc-info.txt
kubectl get storageclass $SC_NAME -o jsonpath='Provisioner: {.provisioner}' >> /tmp/pvc-info.txt
echo "" >> /tmp/pvc-info.txt

cat /tmp/pvc-info.txt
```

</details>

---

### 문제 7. PV-PVC 바인딩 실패 문제 해결 [7%]

**컨텍스트:** `kubectl config use-context staging`

PVC `pending-pvc`가 Pending 상태이다. 원인을 찾고 바인딩이 성공하도록 수정하라.

<details>
<summary>풀이</summary>

```bash
kubectl config use-context staging

# 문제 시뮬레이션
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolume
metadata:
  name: test-pv
spec:
  capacity:
    storage: 5Gi
  accessModes:
  - ReadWriteOnce
  storageClassName: fast                # SC: fast
  hostPath:
    path: /data/test
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: pending-pvc
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 3Gi
  storageClassName: slow                # SC: slow → 불일치!
EOF

# === 진단 ===

# 1. PVC 상태 확인
kubectl get pvc pending-pvc
# STATUS: Pending

# 2. PVC 이벤트 확인
kubectl describe pvc pending-pvc
# Events: no persistent volumes available for this claim

# 3. PV 확인
kubectl get pv test-pv
# STORAGECLASS: fast

# 4. 비교
# PVC storageClassName: slow ≠ PV storageClassName: fast

# 5. 수정: PVC의 storageClassName을 fast로 변경
# PVC의 storageClassName은 수정할 수 없으므로 재생성
kubectl delete pvc pending-pvc
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: pending-pvc
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 3Gi
  storageClassName: fast               # PV와 일치하도록 수정
EOF

# 6. 검증
kubectl get pvc pending-pvc
# STATUS: Bound

kubectl get pv test-pv
# STATUS: Bound, CLAIM: default/pending-pvc

# 정리
kubectl delete pvc pending-pvc
kubectl delete pv test-pv
```

**진단 순서:**
1. `kubectl describe pvc` → 이벤트 확인
2. PVC의 storageClassName, accessModes, storage 요청량 확인
3. PV의 storageClassName, accessModes, capacity 확인
4. 불일치 항목 수정

</details>

---

### 문제 8. 여러 볼륨 타입을 사용하는 Pod [7%]

**컨텍스트:** `kubectl config use-context dev`

다음 Pod를 생성하라:
- 이름: `multi-vol-pod`, 네임스페이스: `demo`
- 이미지: `nginx`
- ConfigMap `app-settings` (APP_ENV=production)를 `/etc/config`에 마운트
- Secret `app-secret` (api-key=my-secret-key)를 `/etc/secrets`에 읽기 전용 마운트
- emptyDir를 `/tmp/cache`에 마운트

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# ConfigMap 생성
kubectl create configmap app-settings \
  --from-literal=APP_ENV=production -n demo

# Secret 생성
kubectl create secret generic app-secret \
  --from-literal=api-key=my-secret-key -n demo

# Pod 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: multi-vol-pod
  namespace: demo
spec:
  containers:
  - name: nginx
    image: nginx
    volumeMounts:
    - name: config
      mountPath: /etc/config
    - name: secrets
      mountPath: /etc/secrets
      readOnly: true
    - name: cache
      mountPath: /tmp/cache
  volumes:
  - name: config
    configMap:
      name: app-settings
  - name: secrets
    secret:
      secretName: app-secret
  - name: cache
    emptyDir: {}
EOF

# 검증
kubectl exec multi-vol-pod -n demo -- cat /etc/config/APP_ENV
# production
kubectl exec multi-vol-pod -n demo -- cat /etc/secrets/api-key
# my-secret-key
kubectl exec multi-vol-pod -n demo -- ls /tmp/cache
# (빈 디렉터리)

# 정리
kubectl delete pod multi-vol-pod -n demo
kubectl delete configmap app-settings -n demo
kubectl delete secret app-secret -n demo
```

</details>

---

### 문제 9. hostPath PV + Retain 정책 [4%]

**컨텍스트:** `kubectl config use-context staging`

Retain 정책의 PV를 생성하고, PVC 삭제 후 PV 상태를 확인하라:
- PV: `retain-pv`, 3Gi, RWO, hostPath `/opt/retain-data`
- PVC: `retain-pvc`, 1Gi, RWO

<details>
<summary>풀이</summary>

```bash
kubectl config use-context staging

# PV 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolume
metadata:
  name: retain-pv
spec:
  capacity:
    storage: 3Gi
  accessModes:
  - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain   # Retain 정책
  storageClassName: retain-class
  hostPath:
    path: /opt/retain-data
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: retain-pvc
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: retain-class
EOF

# 확인
kubectl get pv retain-pv
kubectl get pvc retain-pvc
# 둘 다 Bound

# PVC 삭제
kubectl delete pvc retain-pvc

# PV 상태 확인
kubectl get pv retain-pv
# STATUS: Released (Retain 정책이므로 PV가 보존됨)

# PV 재사용을 위해 claimRef 제거
kubectl patch pv retain-pv --type json \
  -p '[{"op":"remove","path":"/spec/claimRef"}]'

kubectl get pv retain-pv
# STATUS: Available (다시 바인딩 가능)

# 정리
kubectl delete pv retain-pv
```

</details>

---

### 문제 10. ConfigMap을 subPath로 특정 파일만 마운트 [4%]

**컨텍스트:** `kubectl config use-context dev`

nginx Pod에서 `/etc/nginx/conf.d/` 디렉터리의 기존 파일을 유지하면서 ConfigMap의 `custom.conf` 파일만 추가하라.

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# ConfigMap 생성
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: custom-nginx-conf
  namespace: demo
data:
  custom.conf: |
    server {
        listen 8080;
        server_name custom.local;
        location / {
            return 200 'Custom server\n';
        }
    }
EOF

# Pod 생성 — subPath로 특정 파일만 마운트
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: nginx-subpath
  namespace: demo
spec:
  containers:
  - name: nginx
    image: nginx
    volumeMounts:
    - name: custom-conf
      mountPath: /etc/nginx/conf.d/custom.conf
      subPath: custom.conf              # ConfigMap의 특정 키만 마운트
  volumes:
  - name: custom-conf
    configMap:
      name: custom-nginx-conf
EOF

# 확인: 기존 default.conf도 유지되고 custom.conf도 추가됨
kubectl exec nginx-subpath -n demo -- ls /etc/nginx/conf.d/
# custom.conf  default.conf

# 정리
kubectl delete pod nginx-subpath -n demo
kubectl delete configmap custom-nginx-conf -n demo
```

**핵심:** subPath 없이 마운트하면 디렉터리 전체가 덮어씌워진다. subPath를 사용하면 특정 파일만 추가된다.

</details>

---

### 문제 11. Dynamic Provisioning 테스트 [7%]

**컨텍스트:** `kubectl config use-context dev`

Dynamic Provisioning으로 PVC를 생성하고 Pod에서 데이터를 쓴 후 확인하라:
1. PVC `dynamic-test-pvc` (1Gi, RWO, StorageClass: local-path)
2. Pod `dynamic-test-pod`에서 PVC를 `/data`에 마운트
3. Pod 내에서 `/data/test.txt`에 "Hello Dynamic PV" 저장
4. 파일 내용을 확인하라

<details>
<summary>풀이</summary>

```bash
kubectl config use-context dev

# PVC 생성 (StorageClass가 자동으로 PV 생성)
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: dynamic-test-pvc
  namespace: demo
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: local-path
EOF

# PVC 상태 확인 (WaitForFirstConsumer이므로 Pending)
kubectl get pvc dynamic-test-pvc -n demo
# STATUS: Pending

# Pod 생성
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: dynamic-test-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "echo 'Hello Dynamic PV' > /data/test.txt && sleep 3600"]
    volumeMounts:
    - name: data
      mountPath: /data
  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: dynamic-test-pvc
EOF

# Pod가 Running이 되면 PVC도 Bound로 변경됨
kubectl get pvc dynamic-test-pvc -n demo
# STATUS: Bound

# 자동 생성된 PV 확인
kubectl get pv | grep dynamic-test-pvc

# 데이터 확인
kubectl exec dynamic-test-pod -n demo -- cat /data/test.txt
# Hello Dynamic PV

# 정리
kubectl delete pod dynamic-test-pod -n demo
kubectl delete pvc dynamic-test-pvc -n demo
```

</details>

---

### 문제 12. PV/PVC 정보 수집 [4%]

**컨텍스트:** `kubectl config use-context platform`

다음 정보를 `/tmp/storage-info.txt`에 저장하라:
1. 클러스터의 기본 StorageClass 이름과 provisioner
2. `monitoring` 네임스페이스의 모든 PVC 이름, 상태, 용량

<details>
<summary>풀이</summary>

```bash
kubectl config use-context platform

# 1. 기본 StorageClass 정보
echo "=== Default StorageClass ===" > /tmp/storage-info.txt
kubectl get storageclass -o custom-columns='NAME:.metadata.name,PROVISIONER:.provisioner,DEFAULT:.metadata.annotations.storageclass\.kubernetes\.io/is-default-class' >> /tmp/storage-info.txt
echo "" >> /tmp/storage-info.txt

# 2. monitoring PVC 정보
echo "=== Monitoring PVCs ===" >> /tmp/storage-info.txt
kubectl get pvc -n monitoring \
  -o custom-columns='NAME:.metadata.name,STATUS:.status.phase,CAPACITY:.status.capacity.storage' \
  >> /tmp/storage-info.txt

cat /tmp/storage-info.txt
```

</details>

---

## 10. 복습 체크리스트

### 개념 확인

- [ ] PV-PVC 바인딩의 4가지 조건(accessMode, capacity, storageClassName, selector)을 설명할 수 있는가?
- [ ] RWO, ROX, RWX, RWOP의 차이를 아는가?
- [ ] Retain과 Delete Reclaim Policy의 차이를 이해하는가?
- [ ] WaitForFirstConsumer volumeBindingMode의 동작을 설명할 수 있는가?
- [ ] emptyDir, hostPath, configMap, secret 볼륨의 차이를 설명할 수 있는가?
- [ ] subPath의 용도를 아는가?
- [ ] PV는 클러스터 수준, PVC는 네임스페이스 수준임을 기억하는가?
- [ ] Released PV를 Available로 되돌리는 방법을 아는가?

### kubectl 명령어 확인

- [ ] `kubectl get pv` / `kubectl get pvc -n <ns>`
- [ ] `kubectl describe pv <name>` / `kubectl describe pvc <name>`
- [ ] `kubectl get storageclass`
- [ ] `kubectl create configmap <name> --from-literal=key=value`
- [ ] `kubectl create secret generic <name> --from-literal=key=value`

### 시험 핵심 팁

1. **PV/PVC 바인딩 실패** — storageClassName, accessModes, capacity 순서로 확인
2. **Dynamic Provisioning** — storageClassName을 지정하면 PV가 자동 생성
3. **ConfigMap 볼륨** — 파일 이름 = ConfigMap의 key, 파일 내용 = value
4. **subPath** — 기존 디렉터리를 유지하면서 특정 파일만 추가할 때
5. **emptyDir** — Multi-Container Pod에서 컨테이너 간 데이터 공유
6. **hostPath 타입** — DirectoryOrCreate를 사용하면 디렉터리가 없어도 생성됨

---

## 내일 예고

**Day 17: Troubleshooting** — CKA에서 가장 높은 비중(30%)을 차지하는 트러블슈팅 도메인을 집중 실습한다.

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속 (PostgreSQL, Redis 등 스토리지를 사용하는 앱)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

### 실습 1: PV/PVC 현황 확인

```bash
# PersistentVolume 확인
kubectl get pv

# demo 네임스페이스의 PersistentVolumeClaim 확인
kubectl get pvc -n demo
```

**예상 출력:**
```
NAME                STATUS   VOLUME       CAPACITY   ACCESS MODES   STORAGECLASS   AGE
postgres-data-pvc   Bound    postgres-pv  5Gi        RWO            local-path     5d
```

**동작 원리:** PV/PVC 바인딩 과정:
1. PV(PersistentVolume)는 클러스터 관리자가 생성한 실제 스토리지 리소스이다
2. PVC(PersistentVolumeClaim)는 개발자가 요청한 스토리지 명세이다
3. PV Controller가 PVC의 요구사항(capacity, accessModes, storageClassName)과 일치하는 PV를 찾아 바인딩한다
4. STATUS가 `Bound`이면 PV와 PVC가 성공적으로 연결된 것이다

```bash
# PV 상세 정보 확인
kubectl describe pv postgres-pv 2>/dev/null || kubectl get pv -o yaml
```

### 실습 2: Pod의 Volume Mount 확인

```bash
# PostgreSQL Pod의 볼륨 마운트 확인
kubectl get pod -n demo -l app=postgres -o jsonpath='{.items[0].spec.volumes[*].name}' && echo ""
kubectl get pod -n demo -l app=postgres -o jsonpath='{.items[0].spec.containers[0].volumeMounts[*].mountPath}' && echo ""
```

**예상 출력:**
```
postgres-data
/var/lib/postgresql/data
```

**동작 원리:** Volume Mount 흐름:
1. Pod spec의 `volumes` 필드가 PVC를 참조한다
2. `volumeMounts` 필드가 컨테이너 내부 경로(`/var/lib/postgresql/data`)에 볼륨을 마운트한다
3. kubelet이 PV의 실제 스토리지를 노드에 마운트하고, 컨테이너에 바인드 마운트한다
4. Pod가 삭제되어도 PVC/PV의 데이터는 유지된다 (persistentVolumeReclaimPolicy에 따라)

### 실습 3: ConfigMap 볼륨 마운트 확인

```bash
# demo 네임스페이스의 ConfigMap 목록
kubectl get configmap -n demo

# ConfigMap을 사용하는 Pod 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .spec.volumes[*]}{.configMap.name}{" "}{end}{"\n"}{end}'
```

**동작 원리:** ConfigMap을 볼륨으로 마운트하면:
1. ConfigMap의 각 key가 파일 이름이 되고, value가 파일 내용이 된다
2. ConfigMap이 업데이트되면 마운트된 파일도 자동으로 갱신된다 (약 1분 소요)
3. 단, 환경 변수로 주입한 ConfigMap은 Pod 재시작 전까지 갱신되지 않는다
4. `subPath`로 마운트하면 자동 갱신이 동작하지 않는다

### 실습 4: emptyDir 활용 사례 확인

```bash
# Istio sidecar가 주입된 httpbin Pod의 볼륨 확인
kubectl get pod -n demo -l app=httpbin,version=v1 -o jsonpath='{range .items[0].spec.volumes[*]}{.name}{"\t"}{.emptyDir}{"\n"}{end}'
```

**동작 원리:** emptyDir의 용도:
1. Istio sidecar(envoy)와 앱 컨테이너가 emptyDir을 통해 데이터를 공유한다
2. emptyDir은 Pod가 생성될 때 빈 디렉터리로 시작된다
3. 같은 Pod의 모든 컨테이너가 이 디렉터리에 읽기/쓰기 가능하다
4. Pod가 삭제되면 emptyDir의 데이터도 함께 삭제된다
5. `medium: Memory`를 설정하면 tmpfs(RAM)를 사용하여 더 빠른 I/O를 제공한다

### 실습 5: StorageClass 확인

```bash
# StorageClass 목록
kubectl get storageclass
```

**동작 원리:** StorageClass의 역할:
1. StorageClass는 Dynamic Provisioning을 위한 "스토리지 클래스" 정의이다
2. PVC에 storageClassName을 지정하면 해당 프로비저너가 자동으로 PV를 생성한다
3. tart-infra에서는 hostPath/local 기반 스토리지를 사용한다 (클라우드 프로비저너 없음)
4. 클라우드 환경에서는 AWS EBS, GCP PD 등이 StorageClass 프로비저너로 동작한다
