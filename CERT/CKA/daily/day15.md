# CKA Day 15: Storage - PV, PVC, StorageClass & 볼륨 타입

> CKA 도메인: **Storage (10%)** | 예상 소요 시간: 3시간

---

## 학습 목표

- [ ] PV, PVC, StorageClass의 관계와 바인딩 조건을 완벽히 이해한다
- [ ] hostPath, emptyDir, configMap/secret 볼륨 타입을 숙지한다
- [ ] Dynamic Provisioning과 volumeBindingMode를 이해한다
- [ ] PV 라이프사이클(Available → Bound → Released)을 파악한다
- [ ] subPath, readOnly, volumeMode 등 세부 옵션을 안다
- [ ] 시험 패턴 12개 이상을 시간 내에 해결한다

---

## 1. 스토리지란 무엇인가?

### 1.1 스토리지 추상화 아키텍처

> **PV/PVC = 스토리지 리소스의 프로비저닝-소비 분리 모델**
>
> PV(PersistentVolume)는 클러스터 수준의 스토리지 리소스 오브젝트로, 실제 백엔드 스토리지(NFS, iSCSI, CSI 볼륨 등)의 용량, 접근 모드(RWO/RWX/ROX), Reclaim Policy를 선언한다.
>
> PVC(PersistentVolumeClaim)는 네임스페이스 수준의 스토리지 요청 오브젝트로, 필요한 용량과 접근 모드를 명시한다. PV Controller가 PVC 요구사항과 일치하는 PV를 바인딩(Bound)한다.
>
> StorageClass는 Dynamic Provisioning을 위한 프로비저너(CSI driver) 및 파라미터를 정의한다. PVC 생성 시 StorageClass를 지정하면 프로비저너가 자동으로 백엔드 볼륨을 생성하고 PV 오브젝트를 생성하여 바인딩한다.
>
> Pod는 spec.volumes에서 PVC를 참조하고, volumeMounts로 컨테이너 파일시스템에 마운트하여 영속 스토리지에 접근한다.

### 1.2 스토리지 리소스 관계

```
                Static Provisioning (수동)
                ┌──────────────────────┐
관리자 ────→    │  PV (클러스터 수준)  │ ←── PVC (네임스페이스 수준) ←── Pod
                │  5Gi, RWO, hostPath  │     3Gi, RWO 요청
                └──────────────────────┘
                        ↑
                        │ 자동 생성 (Dynamic Provisioning)
                        │
                ┌──────────────────────┐
                │  StorageClass        │
                │  provisioner 정의    │
                │  reclaimPolicy       │
                │  volumeBindingMode   │
                └──────────────────────┘

핵심 관계:
- PV: 실제 스토리지 리소스 (네임스페이스에 속하지 않는다!)
- PVC: 사용자의 스토리지 요청 (네임스페이스에 속한다)
- StorageClass: PV 자동 생성 방법 정의
- Pod: PVC를 마운트하여 스토리지 사용
```

---

## 2. PersistentVolume (PV) 완벽 분석

### 2.1 PV 전체 YAML (한 줄씩 설명)

```yaml
apiVersion: v1                       # PV는 핵심 API 그룹(v1)에 속한다
kind: PersistentVolume               # 리소스 종류: PersistentVolume
metadata:
  name: my-pv                        # PV 이름 (네임스페이스 없음! 클러스터 수준)
  labels:                            # PV에 레이블 추가 (PVC selector로 매칭 가능)
    type: local
    environment: dev
spec:
  capacity:
    storage: 10Gi                    # PV의 총 용량 (필수!)
  accessModes:                       # 접근 모드 (필수!)
  - ReadWriteOnce                    # RWO: 단일 노드에서 읽기/쓰기
  persistentVolumeReclaimPolicy: Retain  # PVC 삭제 시 PV 처리 방법
                                          # Retain: PV 보존 (수동 처리)
                                          # Delete: PV와 데이터 함께 삭제
  storageClassName: manual           # StorageClass 이름 (PVC와 매칭 기준)
                                     # 빈 문자열("")이면 어떤 SC에도 속하지 않음
  volumeMode: Filesystem             # Filesystem(기본) 또는 Block
  mountOptions:                      # 마운트 옵션 (선택사항)
  - hard
  - nfsvers=4.1
  hostPath:                          # 볼륨 타입: hostPath (노드의 로컬 디렉터리)
    path: /mnt/data                  # 노드의 디렉터리 경로
    type: DirectoryOrCreate          # 디렉터리가 없으면 자동 생성
```

### 2.2 Access Modes (접근 모드)

| 모드 | 약어 | 설명 | 사용 사례 |
|---|---|---|---|
| **ReadWriteOnce** | RWO | 단일 노드에서 읽기/쓰기 | 일반 데이터베이스 |
| **ReadOnlyMany** | ROX | 여러 노드에서 읽기 전용 | 공유 설정 파일 |
| **ReadWriteMany** | RWX | 여러 노드에서 읽기/쓰기 | NFS, 공유 스토리지 |
| **ReadWriteOncePod** | RWOP | 단일 Pod에서만 읽기/쓰기 (v1.22+) | 중요 데이터 독점 접근 |

```
주의:
- hostPath는 RWO만 지원한다 (로컬 디스크이므로)
- NFS는 RWO, ROX, RWX 모두 지원한다
- 클라우드 디스크(EBS, PD)는 보통 RWO만 지원한다
- RWO는 "하나의 노드"를 의미한다 (하나의 Pod가 아님!)
  → 같은 노드의 여러 Pod는 RWO 볼륨을 동시에 마운트할 수 있다
```

### 2.3 Reclaim Policy (회수 정책)

```
PVC가 삭제되면 PV는 어떻게 되는가?

1. Retain (보존)
   - PV와 데이터가 보존된다
   - PV 상태: Released (다른 PVC에 바인딩할 수 없음)
   - 관리자가 수동으로 PV를 정리하거나 재사용해야 한다
   - 데이터 보호가 중요한 프로덕션 환경에서 사용

2. Delete (삭제)
   - PV와 연결된 스토리지가 함께 삭제된다
   - Dynamic Provisioning의 기본 정책
   - 임시 데이터나 재생성 가능한 데이터에 사용

3. Recycle (재활용) — 더 이상 사용하지 않음 (deprecated)
   - rm -rf /volume/* 실행 후 PV를 Available로 복귀
   - Dynamic Provisioning으로 대체됨

프로덕션 권장:
- 중요 데이터: Retain
- 임시 데이터: Delete
```

### 2.4 PV 라이프사이클

```
PV 상태 흐름:

Available ──→ Bound ──→ Released ──→ (Retain 시 수동 처리)
   │            │           │
   │ PVC 바인딩  │ PVC 삭제  │ Delete 정책이면
   │            │           │ 자동 삭제
   ▼            ▼           ▼
"사용 가능"   "사용 중"   "해제됨"

Released → Available로 되돌리기:
  kubectl edit pv <name>
  spec.claimRef 필드를 삭제한다 → PV가 다시 Available 상태로

Failed:
  PV가 자동 회수에 실패한 상태
```

### 2.5 hostPath 타입 종류

```yaml
# hostPath의 type 필드
hostPath:
  path: /mnt/data
  type: DirectoryOrCreate    # 디렉터리가 없으면 생성 (0755 권한)
  # type: Directory          # 디렉터리가 반드시 존재해야 함
  # type: FileOrCreate       # 파일이 없으면 생성
  # type: File               # 파일이 반드시 존재해야 함
  # type: Socket             # 유닉스 소켓이 존재해야 함
  # type: CharDevice         # 문자 디바이스가 존재해야 함
  # type: BlockDevice        # 블록 디바이스가 존재해야 함
  # type: ""                 # 아무 확인도 하지 않음 (기본값)
```

---

## 3. PersistentVolumeClaim (PVC)

### 3.1 PVC 전체 YAML (한 줄씩 설명)

```yaml
apiVersion: v1                        # PVC도 핵심 API 그룹(v1)
kind: PersistentVolumeClaim           # 리소스 종류
metadata:
  name: my-pvc                        # PVC 이름
  namespace: demo                     # PVC가 속할 네임스페이스 (PV와 달리!)
spec:
  accessModes:                        # 요청하는 접근 모드
  - ReadWriteOnce                     # PV의 accessModes와 일치해야 바인딩
  resources:
    requests:
      storage: 5Gi                    # 요청하는 최소 용량
                                      # PV의 capacity ≥ 이 값이어야 바인딩
  storageClassName: manual            # PV의 storageClassName과 일치해야 바인딩
                                      # 빈 문자열(""):  SC 없는 PV에만 바인딩
                                      # 생략: 기본 SC 사용 (Dynamic Provisioning)
  selector:                           # 특정 PV를 지정하여 바인딩 (선택사항)
    matchLabels:
      type: local                     # PV의 labels와 일치
    matchExpressions:
    - key: environment
      operator: In
      values:
      - dev
      - staging
  volumeName: my-pv                   # 특정 PV 이름으로 바인딩 (선택사항)
  volumeMode: Filesystem              # PV의 volumeMode와 일치해야 함
```

### 3.2 PV-PVC 바인딩 조건 (시험 핵심!)

```
PVC가 PV에 바인딩되려면 다음 4가지 조건을 모두 만족해야 한다:

1. Access Mode 일치
   PVC: ReadWriteOnce  → PV도 ReadWriteOnce를 포함해야 함

2. Capacity ≥ PVC 요청량
   PVC: 5Gi 요청      → PV는 5Gi 이상이어야 함 (10Gi PV에 5Gi PVC 가능)

3. StorageClass 일치
   PVC: manual         → PV도 storageClassName: manual이어야 함
   PVC: "" (빈문자열)  → PV도 storageClassName이 없어야 함
   PVC: 생략           → 기본 StorageClass 사용 (Dynamic Provisioning)

4. Selector 일치 (지정된 경우)
   PVC: selector.matchLabels: type=local → PV에 type=local 레이블 필요

바인딩 실패 시 PVC는 Pending 상태로 유지된다.
```

### 3.3 바인딩 문제 진단

```bash
# PVC가 Pending인 원인 찾기

# 1. PVC 상태 확인
kubectl get pvc <name>
# STATUS: Pending

# 2. PVC 이벤트 확인
kubectl describe pvc <name>
# Events에 바인딩 실패 원인이 표시됨
# 예: "no persistent volumes available for this claim"

# 3. PV 목록 확인
kubectl get pv
# storageClassName, capacity, accessModes, STATUS 비교

# 4. 일반적인 원인:
# - storageClassName 불일치
# - accessModes 불일치
# - PV capacity가 PVC 요청량보다 작음
# - 모든 PV가 이미 Bound 상태
# - WaitForFirstConsumer인데 아직 Pod가 없음
```

---

## 4. StorageClass와 Dynamic Provisioning

### 4.1 StorageClass 전체 YAML (한 줄씩 설명)

```yaml
apiVersion: storage.k8s.io/v1         # StorageClass API 그룹
kind: StorageClass                     # 리소스 종류
metadata:
  name: fast                           # StorageClass 이름
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
    # ↑ 기본 StorageClass로 설정. PVC에서 SC를 지정하지 않으면 이것을 사용
provisioner: rancher.io/local-path     # 프로비저너 (어떤 방식으로 PV를 생성할지)
                                       # tart-infra: rancher.io/local-path
                                       # AWS: kubernetes.io/aws-ebs
                                       # GCP: kubernetes.io/gce-pd
                                       # Azure: kubernetes.io/azure-disk
reclaimPolicy: Delete                  # PVC 삭제 시 PV 처리 (Delete 또는 Retain)
volumeBindingMode: WaitForFirstConsumer # PV 프로비저닝 시점
                                        # Immediate: PVC 생성 즉시 PV 생성
                                        # WaitForFirstConsumer: Pod가 사용할 때 생성
allowVolumeExpansion: true             # PVC 용량 확장 허용 여부
parameters:                            # 프로비저너별 파라미터
  type: gp3                            # AWS EBS 볼륨 타입 예시
  iopsPerGB: "50"                      # IOPS 설정 예시
```

### 4.2 volumeBindingMode 비교

```
Immediate (즉시):
  PVC 생성 → 즉시 PV 프로비저닝 → Pod 스케줄링
  문제: 특정 노드에 PV가 생성되면 Pod가 그 노드에만 스케줄링됨

WaitForFirstConsumer (첫 소비자 대기):
  PVC 생성 → Pending 상태 → Pod 생성 → Pod의 스케줄링 노드에 PV 생성
  장점: Pod의 노드 선택을 고려하여 PV를 적절한 노드에 생성

tart-infra의 local-path StorageClass:
  volumeBindingMode: WaitForFirstConsumer
  → PVC만 생성하면 Pending, Pod가 사용해야 Bound로 변경
```

### 4.3 기본 StorageClass

```bash
# 기본 StorageClass 확인
kubectl get storageclass
# 이름 옆에 (default) 표시

# 기본 StorageClass 설정
kubectl patch storageclass <name> -p \
  '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'

# 기본 StorageClass 해제
kubectl patch storageclass <name> -p \
  '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"false"}}}'
```

---

## 5. 볼륨 타입 완벽 정리

### 5.1 볼륨 타입 비교표

| 볼륨 타입 | 수명 | 사용 사례 | PV 필요 |
|---|---|---|---|
| **emptyDir** | Pod 수명과 같음 | 컨테이너 간 임시 데이터 공유 | 아니오 |
| **hostPath** | 노드 수명과 같음 | 노드 로그 접근, 테스트용 | PV로 사용 가능 |
| **configMap** | ConfigMap 수명 | 설정 파일 주입 | 아니오 |
| **secret** | Secret 수명 | 인증 정보 주입 | 아니오 |
| **PVC** | PV 수명 | 영구 데이터 저장 | 예 |
| **nfs** | NFS 서버 수명 | 공유 스토리지 | PV로 사용 가능 |
| **projected** | Pod 수명 | 여러 볼륨을 하나로 결합 | 아니오 |
| **downwardAPI** | Pod 수명 | Pod 메타데이터 접근 | 아니오 |

### 5.2 emptyDir (임시 볼륨)

> **emptyDir**: Pod 생성 시 노드의 로컬 디스크(또는 tmpfs)에 빈 디렉터리를 할당하는 임시 볼륨이다. Pod 내 모든 컨테이너가 동일 경로를 마운트하여 IPC나 캐시 공유 용도로 사용하며, Pod 삭제 시 데이터가 함께 제거된다. `medium: Memory` 설정 시 tmpfs(RAM-backed filesystem)로 동작하여 디스크 I/O 없이 고속 접근이 가능하다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: emptydir-pod
spec:
  containers:
  - name: writer                     # 데이터를 쓰는 컨테이너
    image: busybox:1.36
    command: ["sh", "-c", "while true; do date >> /shared/log.txt; sleep 5; done"]
    volumeMounts:
    - name: shared-data              # 볼륨 이름 (아래 volumes와 매칭)
      mountPath: /shared             # 컨테이너 내 마운트 경로
  - name: reader                     # 데이터를 읽는 컨테이너
    image: busybox:1.36
    command: ["sh", "-c", "tail -f /shared/log.txt"]
    volumeMounts:
    - name: shared-data
      mountPath: /shared
      readOnly: true                 # 읽기 전용으로 마운트
  volumes:
  - name: shared-data                # 볼륨 정의
    emptyDir: {}                     # 빈 디렉터리 (디스크 사용)
    # emptyDir:
    #   medium: Memory               # tmpfs 사용 (RAM 기반, 더 빠름)
    #   sizeLimit: 100Mi             # 최대 용량 제한
```

```
emptyDir 특징:
- Pod가 생성될 때 빈 디렉터리로 시작
- Pod가 삭제되면 데이터도 삭제됨
- 같은 Pod의 여러 컨테이너가 공유 가능
- medium: Memory → RAM 기반 (빠르지만 Pod 메모리 제한에 포함)
- 사용 사례: 사이드카 패턴, 임시 캐시, 컨테이너 간 데이터 전달
```

### 5.3 hostPath (노드 로컬 볼륨)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hostpath-pod
spec:
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: host-logs
      mountPath: /var/log/host       # 컨테이너 내 마운트 경로
      readOnly: true                 # 읽기 전용 (안전)
    - name: host-data
      mountPath: /data
  volumes:
  - name: host-logs
    hostPath:
      path: /var/log                 # 노드의 실제 디렉터리
      type: Directory                # 디렉터리가 반드시 존재해야 함
  - name: host-data
    hostPath:
      path: /opt/app-data
      type: DirectoryOrCreate        # 없으면 자동 생성
```

```
hostPath 주의사항:
- Pod가 다른 노드에 스케줄링되면 데이터에 접근할 수 없다
- 보안 위험: 노드의 파일 시스템에 직접 접근
- 프로덕션에서는 권장하지 않음 (시험용/테스트용)
- CKA 시험에서 PV 생성 시 자주 사용됨
```

### 5.4 configMap 볼륨

```yaml
# ConfigMap 생성
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: demo
data:
  app.properties: |            # 파일로 마운트됨
    server.port=8080
    log.level=INFO
  database.url: jdbc:postgresql://db:5432/mydb
---
apiVersion: v1
kind: Pod
metadata:
  name: config-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: config-vol
      mountPath: /etc/config       # ConfigMap 전체가 이 디렉터리에 마운트
    - name: config-single
      mountPath: /etc/app.properties  # 특정 키만 마운트
      subPath: app.properties         # subPath로 특정 키 지정
  volumes:
  - name: config-vol
    configMap:
      name: app-config             # ConfigMap 이름
  - name: config-single
    configMap:
      name: app-config
      items:                       # 특정 키만 마운트 (선택사항)
      - key: app.properties
        path: app.properties       # 마운트될 파일 이름
```

```
configMap 볼륨 특징:
- ConfigMap의 각 key가 파일 이름이 되고, value가 파일 내용이 된다
- /etc/config/app.properties → "server.port=8080\nlog.level=INFO"
- /etc/config/database.url → "jdbc:postgresql://db:5432/mydb"
- ConfigMap 업데이트 시 마운트된 파일도 자동 업데이트 (약간의 지연)
- subPath로 마운트하면 자동 업데이트가 동작하지 않음!
```

### 5.5 secret 볼륨

```yaml
# Secret 생성
apiVersion: v1
kind: Secret
metadata:
  name: db-creds
  namespace: demo
type: Opaque
data:
  username: YWRtaW4=             # base64 인코딩: echo -n 'admin' | base64
  password: c2VjcmV0MTIz         # base64 인코딩: echo -n 'secret123' | base64
---
apiVersion: v1
kind: Pod
metadata:
  name: secret-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: secret-vol
      mountPath: /secrets          # Secret이 마운트되는 경로
      readOnly: true               # 읽기 전용 (보안)
  volumes:
  - name: secret-vol
    secret:
      secretName: db-creds        # Secret 이름
      defaultMode: 0400           # 파일 권한 (읽기 전용)
```

```
secret 볼륨 특징:
- Secret의 data가 base64 디코딩되어 파일로 마운트
- /secrets/username → "admin" (디코딩된 값)
- /secrets/password → "secret123" (디코딩된 값)
- 기본적으로 tmpfs(RAM)에 저장됨
- defaultMode로 파일 권한 설정 가능
```

### 5.6 projected 볼륨

```yaml
# 여러 볼륨 소스를 하나의 디렉터리에 합침
apiVersion: v1
kind: Pod
metadata:
  name: projected-pod
spec:
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: all-in-one
      mountPath: /etc/projected
  volumes:
  - name: all-in-one
    projected:
      sources:
      - configMap:
          name: app-config
          items:
          - key: app.properties
            path: app.properties
      - secret:
          name: db-creds
          items:
          - key: password
            path: db-password
      - downwardAPI:
          items:
          - path: pod-name
            fieldRef:
              fieldPath: metadata.name
      - serviceAccountToken:
          path: token
          expirationSeconds: 3600
```

---

## 6. Pod에서 볼륨 사용하기

### 6.1 PVC 마운트 (기본 패턴)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: data-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: data                   # volumes의 name과 매칭
      mountPath: /app/data         # 컨테이너 내 마운트 경로
      readOnly: false              # 읽기/쓰기 (기본값)
  volumes:
  - name: data                    # 볼륨 이름 (Pod 내에서 고유)
    persistentVolumeClaim:
      claimName: my-pvc           # 사용할 PVC 이름
      readOnly: false             # 읽기/쓰기
```

### 6.2 subPath 사용

```yaml
# subPath: 볼륨의 하위 디렉터리만 마운트
apiVersion: v1
kind: Pod
metadata:
  name: subpath-pod
spec:
  containers:
  - name: app1
    image: nginx
    volumeMounts:
    - name: shared
      mountPath: /app/data
      subPath: app1-data           # 볼륨의 app1-data 하위 디렉터리만 마운트
  - name: app2
    image: nginx
    volumeMounts:
    - name: shared
      mountPath: /app/data
      subPath: app2-data           # 볼륨의 app2-data 하위 디렉터리만 마운트
  volumes:
  - name: shared
    persistentVolumeClaim:
      claimName: shared-pvc

# subPath를 사용하면:
# - 같은 PVC를 여러 컨테이너가 다른 하위 디렉터리로 사용 가능
# - ConfigMap/Secret의 특정 파일만 마운트할 때 유용
# - 기존 디렉터리를 덮어쓰지 않고 특정 파일만 추가 가능
```

### 6.3 ConfigMap을 subPath로 특정 파일만 마운트

```yaml
# /etc/nginx/conf.d/ 디렉터리의 기존 파일을 유지하면서
# custom.conf 파일만 추가하려면 subPath 사용
apiVersion: v1
kind: Pod
metadata:
  name: nginx-custom
spec:
  containers:
  - name: nginx
    image: nginx
    volumeMounts:
    - name: nginx-conf
      mountPath: /etc/nginx/conf.d/custom.conf   # 특정 파일 경로
      subPath: custom.conf                        # ConfigMap의 특정 키
  volumes:
  - name: nginx-conf
    configMap:
      name: nginx-config

# subPath 없이 마운트하면:
# /etc/nginx/conf.d/ 전체가 ConfigMap으로 덮어씌워진다!
# → 기존 default.conf 파일이 사라짐

# subPath로 마운트하면:
# /etc/nginx/conf.d/default.conf → 기존 파일 유지
# /etc/nginx/conf.d/custom.conf  → ConfigMap에서 추가
```

### 6.4 볼륨 권한 설정

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: permission-pod
spec:
  securityContext:
    fsGroup: 1000                  # 마운트된 볼륨의 그룹 ID
    # 마운트된 모든 파일의 그룹이 1000으로 설정됨
  containers:
  - name: app
    image: nginx
    securityContext:
      runAsUser: 1000              # 컨테이너 실행 사용자 ID
      runAsGroup: 1000             # 컨테이너 실행 그룹 ID
    volumeMounts:
    - name: data
      mountPath: /app/data
  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: my-pvc
```

---

## 7. 실전 YAML 예제 모음 (18개)

### 예제 1: Static Provisioning (PV + PVC + Pod)

```yaml
# PV 생성
apiVersion: v1
kind: PersistentVolume
metadata:
  name: static-pv
  labels:
    type: local
spec:
  capacity:
    storage: 5Gi
  accessModes:
  - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /opt/static-data
    type: DirectoryOrCreate
---
# PVC 생성
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: static-pvc
  namespace: demo
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 3Gi
  storageClassName: manual
---
# Pod에서 PVC 사용
apiVersion: v1
kind: Pod
metadata:
  name: static-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: data
      mountPath: /usr/share/nginx/html
  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: static-pvc
```

### 예제 2: Dynamic Provisioning (StorageClass + PVC + Pod)

```yaml
# PVC만 생성하면 StorageClass가 자동으로 PV를 생성
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: dynamic-pvc
  namespace: demo
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 2Gi
  storageClassName: local-path      # tart-infra의 기본 StorageClass
---
apiVersion: v1
kind: Pod
metadata:
  name: dynamic-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: data
      mountPath: /data
  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: dynamic-pvc
```

### 예제 3: emptyDir로 사이드카 패턴

```yaml
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
  - name: log-shipper
    image: busybox:1.36
    command: ["sh", "-c", "tail -f /logs/access.log"]
    volumeMounts:
    - name: logs
      mountPath: /logs
      readOnly: true
  volumes:
  - name: logs
    emptyDir: {}
```

### 예제 4: emptyDir Memory 모드

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: tmpfs-pod
spec:
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: cache
      mountPath: /cache
  volumes:
  - name: cache
    emptyDir:
      medium: Memory              # RAM 기반 (tmpfs)
      sizeLimit: 256Mi            # 최대 256Mi
```

### 예제 5: ConfigMap을 환경변수 + 볼륨으로 동시 사용

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: multi-use-config
  namespace: demo
data:
  APP_ENV: production
  APP_PORT: "8080"
  config.yaml: |
    server:
      port: 8080
      host: 0.0.0.0
    database:
      host: postgres
      port: 5432
---
apiVersion: v1
kind: Pod
metadata:
  name: multi-use-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx
    envFrom:
    - configMapRef:
        name: multi-use-config     # 환경변수로 주입
    volumeMounts:
    - name: config-file
      mountPath: /etc/app/config.yaml
      subPath: config.yaml         # config.yaml 파일만 마운트
  volumes:
  - name: config-file
    configMap:
      name: multi-use-config
```

### 예제 6: Secret을 볼륨으로 마운트 (특정 키만)

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: tls-certs
  namespace: demo
type: kubernetes.io/tls
data:
  tls.crt: LS0tLS1CRUdJTi...       # base64 인코딩된 인증서
  tls.key: LS0tLS1CRUdJTi...       # base64 인코딩된 키
---
apiVersion: v1
kind: Pod
metadata:
  name: tls-pod
  namespace: demo
spec:
  containers:
  - name: nginx
    image: nginx
    volumeMounts:
    - name: tls
      mountPath: /etc/nginx/ssl
      readOnly: true
  volumes:
  - name: tls
    secret:
      secretName: tls-certs
      defaultMode: 0400            # 읽기 전용 권한
```

### 예제 7: 여러 볼륨을 하나의 Pod에서 사용

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: multi-volume-pod
  namespace: demo
spec:
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: config
      mountPath: /etc/config
      readOnly: true
    - name: secrets
      mountPath: /etc/secrets
      readOnly: true
    - name: data
      mountPath: /app/data
    - name: cache
      mountPath: /tmp/cache
    - name: host-logs
      mountPath: /var/log/host
      readOnly: true
  volumes:
  - name: config
    configMap:
      name: app-config
  - name: secrets
    secret:
      secretName: app-secrets
  - name: data
    persistentVolumeClaim:
      claimName: app-data-pvc
  - name: cache
    emptyDir:
      sizeLimit: 100Mi
  - name: host-logs
    hostPath:
      path: /var/log
      type: Directory
```

### 예제 8: PV를 레이블 selector로 바인딩

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: labeled-pv
  labels:
    app: database
    env: production
spec:
  capacity:
    storage: 20Gi
  accessModes:
  - ReadWriteOnce
  storageClassName: ""             # SC 없이 직접 바인딩
  hostPath:
    path: /data/db
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: labeled-pvc
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  storageClassName: ""
  selector:
    matchLabels:
      app: database
      env: production              # PV의 레이블과 일치해야 바인딩
```

### 예제 9: PVC 용량 확장

```yaml
# StorageClass에 allowVolumeExpansion: true가 설정되어 있어야 함
# 기존 PVC의 용량을 늘릴 수 있다 (줄이는 것은 불가)
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: expandable-pvc
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi                # 기존 5Gi에서 10Gi로 확장
  storageClassName: local-path

# kubectl edit pvc expandable-pvc
# spec.resources.requests.storage를 더 큰 값으로 변경
```

### 예제 10: StatefulSet + VolumeClaimTemplate

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: demo
spec:
  serviceName: postgres-headless
  replicas: 3
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:15
        ports:
        - containerPort: 5432
        env:
        - name: POSTGRES_PASSWORD
          value: password
        - name: PGDATA
          value: /var/lib/postgresql/data/pgdata
        volumeMounts:
        - name: pgdata
          mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:              # 각 Pod마다 별도의 PVC가 자동 생성
  - metadata:
      name: pgdata
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: local-path
      resources:
        requests:
          storage: 5Gi
# 결과:
# pgdata-postgres-0 (PVC) → postgres-0 Pod
# pgdata-postgres-1 (PVC) → postgres-1 Pod
# pgdata-postgres-2 (PVC) → postgres-2 Pod
```

### 예제 11: ReadOnlyMany PV (NFS 예시)

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: nfs-pv
spec:
  capacity:
    storage: 100Gi
  accessModes:
  - ReadWriteMany                   # NFS는 RWX 지원
  - ReadOnlyMany
  persistentVolumeReclaimPolicy: Retain
  storageClassName: nfs
  nfs:
    server: 192.168.1.100           # NFS 서버 IP
    path: /exports/shared           # NFS 경로
```

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터 접속 (PostgreSQL, Redis 등 PVC를 사용하는 앱이 배포됨)
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl config use-context dev
```

### 실습 1: PV/PVC 바인딩 상태 확인

```bash
# 클러스터의 PV 목록 확인
kubectl get pv

# demo 네임스페이스의 PVC 목록 확인
kubectl get pvc -n demo
```

**예상 출력:**
```
NAME                    CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM
pvc-xxxx-postgresql     10Gi       RWO            Delete           Bound    demo/data-postgresql-0

NAME                  STATUS   VOLUME              CAPACITY   ACCESS MODES   STORAGECLASS
data-postgresql-0     Bound    pvc-xxxx            10Gi       RWO            local-path
data-redis-0          Bound    pvc-yyyy            5Gi        RWO            local-path
data-rabbitmq-0       Bound    pvc-zzzz            5Gi        RWO            local-path
```

**동작 원리:**
1. PVC가 생성되면 PV Controller가 요구 조건(capacity, accessModes, storageClassName)에 맞는 PV를 찾아 바인딩한다
2. `STATUS: Bound`는 PVC와 PV가 1:1로 연결되어 사용 중임을 의미한다
3. `RECLAIM POLICY: Delete`이면 PVC 삭제 시 PV와 백엔드 볼륨도 함께 삭제된다
4. StatefulSet의 `volumeClaimTemplates`로 생성된 PVC는 Pod 이름에 연동된 이름을 가진다

### 실습 2: Pod의 볼륨 마운트 구조 분석

```bash
# PostgreSQL Pod의 볼륨 마운트 확인
kubectl get pod -n demo -l app=postgresql -o jsonpath='{range .items[0].spec.containers[0].volumeMounts[*]}{.name}{"\t"}{.mountPath}{"\n"}{end}'

# Pod 내부에서 마운트된 볼륨의 데이터 확인
kubectl exec -n demo -it $(kubectl get pod -n demo -l app=postgresql -o name | head -1) -- df -h /var/lib/postgresql/data
```

**예상 출력:**
```
data	/var/lib/postgresql/data

Filesystem      Size  Used Avail Use% Mounted on
/dev/sdX        10G   500M  9.5G   5% /var/lib/postgresql/data
```

**동작 원리:**
1. `volumeMounts`는 PVC로 바인딩된 볼륨을 컨테이너의 특정 경로에 마운트한다
2. PostgreSQL은 `/var/lib/postgresql/data`에 데이터를 영속 저장한다
3. Pod가 재시작되어도 PVC가 같은 PV에 바인딩되어 데이터가 유지된다

### 실습 3: StorageClass 확인

```bash
# 사용 가능한 StorageClass 확인
kubectl get storageclass

# StorageClass 상세 정보
kubectl describe storageclass local-path
```

**예상 출력:**
```
NAME                   PROVISIONER             RECLAIMPOLICY   VOLUMEBINDINGMODE
local-path (default)   rancher.io/local-path   Delete          WaitForFirstConsumer
```

**동작 원리:**
1. `local-path` StorageClass는 노드의 로컬 디스크에 볼륨을 프로비저닝한다
2. `WaitForFirstConsumer`는 PVC를 사용하는 Pod가 스케줄링될 때까지 PV 생성을 지연한다
3. 이를 통해 Pod와 PV가 같은 노드에 위치하도록 보장한다 (로컬 스토리지의 제약)
4. `(default)` 표시는 StorageClass를 지정하지 않은 PVC가 이 클래스를 사용함을 의미한다

