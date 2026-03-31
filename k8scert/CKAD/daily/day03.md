# CKAD Day 3: Volume, Job/CronJob

> CKAD 도메인: Application Design and Build (20%) - Part 2a | 예상 소요 시간: 1시간

---

## 오늘의 학습 목표

- [ ] Pod 내부 볼륨(emptyDir, PVC) 공유 방식을 이해한다
- [ ] Job과 CronJob의 동작 원리와 주요 필드를 숙지한다
- [ ] cron 스케줄 형식을 작성할 수 있다

---

## 1. Volume - Pod 내 데이터 공유

### 1.1 emptyDir 볼륨

**등장 배경:**
컨테이너의 파일시스템은 기본적으로 컨테이너 레이어에 기록되며, 컨테이너가 재시작되면 모든 데이터가 사라진다. 또한 같은 Pod 내 여러 컨테이너가 파일을 공유할 방법이 없다. emptyDir은 이 두 문제를 해결하는 가장 단순한 볼륨 유형이다. Pod 수준에서 디렉토리를 생성하므로 컨테이너 재시작에는 살아남지만, Pod 삭제 시에는 함께 소멸한다.

**공학적 정의:**
emptyDir은 Pod 생성 시 노드의 로컬 디스크(또는 tmpfs)에 빈 디렉토리를 생성하는 임시 볼륨이다. Pod 내 여러 컨테이너가 동일 볼륨을 마운트하여 파일시스템을 통해 데이터를 공유하며, Pod가 삭제되면 볼륨 데이터도 함께 소멸한다. medium 필드를 "Memory"로 설정하면 tmpfs(RAM 디스크)를 사용하여 I/O 성능이 향상되지만 메모리 사용량이 증가한다.

**내부 동작 원리 심화:**
emptyDir은 노드의 `/var/lib/kubelet/pods/<pod-uid>/volumes/kubernetes.io~empty-dir/<volume-name>/` 경로에 물리적으로 생성된다. `medium: Memory`를 사용하면 tmpfs로 마운트되며, sizeLimit를 설정하지 않으면 노드 메모리의 50%까지 사용 가능하다. sizeLimit를 초과하면 kubelet이 Pod를 evict한다. emptyDir의 디스크 사용량은 kubelet의 eviction manager가 모니터링한다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: emptydir-demo
spec:
  containers:
    - name: writer
      image: busybox:1.36
      command: ["sh", "-c", "echo 'shared data' > /data/message && sleep 3600"]
      volumeMounts:
        - name: shared-vol
          mountPath: /data
    - name: reader
      image: busybox:1.36
      command: ["sh", "-c", "cat /data/message && sleep 3600"]
      volumeMounts:
        - name: shared-vol
          mountPath: /data
          readOnly: true
  volumes:
    - name: shared-vol
      emptyDir: {}               # Pod 생명주기와 동일한 임시 볼륨
      # emptyDir:
      #   medium: Memory         # RAM 디스크 사용 (빠르지만 메모리 사용)
      #   sizeLimit: 100Mi       # 크기 제한
```

### 1.2 PersistentVolumeClaim (PVC)

**등장 배경:**
emptyDir은 Pod 삭제 시 데이터가 소멸하므로 DB, 파일 스토리지 등 영속적 데이터를 저장할 수 없다. 초기에는 Pod YAML에 NFS, iSCSI 등 스토리지 유형을 직접 명시했는데, 이는 인프라 세부사항이 앱 매니페스트에 노출되는 문제가 있었다. PV/PVC 추상화는 스토리지 프로비저닝(PV, StorageClass)과 스토리지 사용(PVC)을 분리하여 관심사의 분리를 달성한다.

**공학적 정의:**
PVC는 사용자가 스토리지를 요청하는 선언적 API 오브젝트로, StorageClass를 통해 PV(PersistentVolume)를 동적 프로비저닝하거나 기존 PV에 바인딩된다. Pod가 삭제되어도 PVC에 바인딩된 PV의 데이터는 유지되며, reclaimPolicy(Retain, Delete)에 따라 PVC 삭제 시 데이터 처리가 결정된다.

**내부 동작 원리 심화:**
PVC가 생성되면 PV Controller가 매칭되는 PV를 찾거나, StorageClass의 provisioner를 호출하여 새 PV를 동적 생성한다. 바인딩이 완료되면 PVC status가 Bound로 변경된다. Pod가 PVC를 참조하면 kubelet이 CSI 드라이버를 통해 노드에 볼륨을 attach하고 mount한다. accessMode RWO는 단일 노드에서만 읽기/쓰기가 가능하므로, 다른 노드의 Pod가 같은 PVC를 사용하려 하면 스케줄링이 실패한다.

```yaml
# PVC 생성
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data
  namespace: demo
spec:
  accessModes:
    - ReadWriteOnce              # RWO: 단일 노드에서 읽기/쓰기
                                 # ReadWriteMany(RWX): 여러 노드에서 읽기/쓰기
                                 # ReadOnlyMany(ROX): 여러 노드에서 읽기 전용
  storageClassName: standard     # StorageClass 이름
  resources:
    requests:
      storage: 1Gi               # 요청 용량

---
# Pod에서 PVC 사용
apiVersion: v1
kind: Pod
metadata:
  name: pvc-pod
spec:
  containers:
    - name: app
      image: nginx:1.25
      volumeMounts:
        - name: data-vol
          mountPath: /data
  volumes:
    - name: data-vol
      persistentVolumeClaim:
        claimName: app-data      # PVC 이름 참조
```

---

## 2. Job (잡) - 일회성 작업 실행

### 2.1 Job이란?

**등장 배경:**
Deployment/ReplicaSet은 "항상 N개의 Pod가 실행되어야 한다"는 장수(long-running) 워크로드를 위한 것이다. 하지만 백업, 데이터 처리, 마이그레이션 같은 일회성 작업은 완료 후 Pod가 종료되어야 한다. restartPolicy: Always인 Deployment에 일회성 작업을 넣으면 무한 재시작된다. Job은 "작업 완료"를 목표로 하는 워크로드 컨트롤러로, 성공적으로 종료되면 Pod를 더 이상 재시작하지 않는다.

**공학적 정의:**
Job은 batch/v1 API 그룹의 워크로드 컨트롤러로, 하나 이상의 Pod를 생성하여 지정된 작업이 성공적으로 완료(exit code 0)될 때까지 실행을 관리한다. completions 필드로 필요한 성공 완료 수를, parallelism 필드로 동시 실행 Pod 수를, backoffLimit 필드로 실패 재시도 횟수를, activeDeadlineSeconds로 전체 실행 시간 제한을 설정한다.

**내부 동작 원리 심화:**
Job Controller는 `completions`와 현재 성공 Pod 수를 비교하여 부족하면 새 Pod를 생성한다. 실패한 Pod의 재시도 간격은 지수 백오프(10s, 20s, 40s, ... 최대 6분)로 증가한다. `backoffLimit`는 연속 실패 횟수가 아니라 누적 실패 횟수이다. `restartPolicy: OnFailure`를 사용하면 같은 Pod 내에서 컨테이너를 재시작하고, `Never`를 사용하면 새 Pod를 생성한다.

### 2.2 Job YAML 상세

```yaml
apiVersion: batch/v1             # Job은 batch API 그룹
kind: Job
metadata:
  name: backup-job
  namespace: demo
spec:
  completions: 1                 # 필요한 성공 완료 수 (기본값: 1)
  parallelism: 1                 # 동시 실행 Pod 수 (기본값: 1)
  backoffLimit: 3                # 실패 시 재시도 횟수 (기본값: 6)
  activeDeadlineSeconds: 120     # 최대 실행 시간 (초과 시 Job 종료)
  ttlSecondsAfterFinished: 300   # 완료 후 자동 삭제까지 시간 (초)

  template:                      # Pod 템플릿
    spec:
      restartPolicy: Never       # Never 또는 OnFailure
                                 # Always는 Job에서 사용 불가!
      containers:
        - name: backup
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              echo "Backup started at $(date)"
              # 실제 백업 작업 수행
              echo "Backup completed!"
```

### 2.3 Job 실행 패턴

```
=== 단일 실행 (기본) ===
completions: 1, parallelism: 1
실행: [Pod-1] -> 완료

=== 다중 순차 실행 ===
completions: 3, parallelism: 1
실행: [Pod-1] -> [Pod-2] -> [Pod-3] -> 완료

=== 다중 병렬 실행 ===
completions: 3, parallelism: 3
실행: [Pod-1] [Pod-2] [Pod-3] -> 동시 완료

=== 병렬 큐 ===
completions: 5, parallelism: 2
실행: [Pod-1] [Pod-2] -> [Pod-3] [Pod-4] -> [Pod-5] -> 완료
```

```bash
# Job 빠른 생성
kubectl create job backup-job --image=busybox:1.36 -- sh -c "echo backup done"
```

검증:
```text
job.batch/backup-job created
```

```bash
# Job 상태 확인
kubectl get jobs
```

검증:
```text
NAME         STATUS     COMPLETIONS   DURATION   AGE
backup-job   Complete   1/1           3s         10s
```

```bash
# Job의 Pod 로그 확인
kubectl logs job/backup-job
```

검증:
```text
backup done
```

---

## 3. CronJob (크론잡) - 스케줄 기반 반복 작업

### 3.1 CronJob이란?

**등장 배경:**
Job은 일회성 작업만 처리한다. 로그 정리, 주기적 백업, 상태 점검 등 반복 작업을 위해서는 외부 cron 스케줄러나 별도의 오케스트레이션 도구가 필요했다. CronJob은 쿠버네티스 네이티브로 스케줄링 기능을 제공하여, 외부 의존성 없이 클러스터 내부에서 반복 작업을 관리한다.

**공학적 정의:**
CronJob은 batch/v1 API 그룹의 스케줄 기반 Job 컨트롤러로, UNIX cron 형식의 schedule 필드에 따라 주기적으로 Job 오브젝트를 생성한다. concurrencyPolicy(Allow/Forbid/Replace)로 동시 실행을 제어하고, successfulJobsHistoryLimit/failedJobsHistoryLimit로 완료된 Job 보관 수를 관리한다.

**내부 동작 원리 심화:**
CronJob Controller는 약 10초 간격으로 schedule을 확인하고, 실행 시점이 도래하면 Job 오브젝트를 생성한다. `startingDeadlineSeconds`가 설정되어 있으면, 스케줄 시점 이후 해당 시간 내에만 Job 생성을 시도한다. 만약 100회 이상 연속으로 실행이 누락되면 CronJob Controller가 에러를 기록하고 더 이상 스케줄하지 않는다. `concurrencyPolicy: Forbid`는 이전 Job이 아직 실행 중이면 새 Job 생성을 건너뛴다.

### 3.2 CronJob YAML 상세

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-backup
  namespace: demo
spec:
  schedule: "0 2 * * *"         # cron 형식: 분 시 일 월 요일
                                 # "0 2 * * *" = 매일 새벽 2시
                                 # "*/5 * * * *" = 5분마다
                                 # "0 */6 * * *" = 6시간마다
                                 # "30 3 * * 1" = 매주 월요일 3:30

  concurrencyPolicy: Forbid      # 동시 실행 정책
                                 # Allow: 동시 실행 허용 (기본값)
                                 # Forbid: 이전 Job 실행 중이면 새 Job 스킵
                                 # Replace: 이전 Job을 종료하고 새 Job 시작

  successfulJobsHistoryLimit: 3  # 성공 Job 보관 수 (기본: 3)
  failedJobsHistoryLimit: 1      # 실패 Job 보관 수 (기본: 1)

  startingDeadlineSeconds: 200   # 스케줄 시간을 놓쳤을 때 시작 허용 시간

  suspend: false                 # true로 설정하면 일시 중지

  jobTemplate:                   # Job 템플릿
    spec:
      activeDeadlineSeconds: 120
      backoffLimit: 2
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: backup
              image: busybox:1.36
              command: ["sh", "-c", "echo 'Backup at $(date)' && sleep 10"]
```

### 3.3 Cron 스케줄 형식

```
┌───────────── 분 (0 - 59)
│ ┌───────────── 시 (0 - 23)
│ │ ┌───────────── 일 (1 - 31)
│ │ │ ┌───────────── 월 (1 - 12)
│ │ │ │ ┌───────────── 요일 (0 - 6, 0=일요일)
│ │ │ │ │
* * * * *

예시:
"*/5 * * * *"     매 5분마다
"0 * * * *"       매 시간 정각
"0 2 * * *"       매일 새벽 2시
"0 0 * * 0"       매주 일요일 자정
"0 0 1 * *"       매월 1일 자정
"30 3 * * 1-5"    평일 3:30
```

```bash
# CronJob 빠른 생성
kubectl create cronjob daily-backup --image=busybox:1.36 \
  --schedule="0 2 * * *" -- sh -c "echo backup"
```

검증:
```text
cronjob.batch/daily-backup created
```

```bash
# CronJob 상태 확인
kubectl get cronjobs
```

검증:
```text
NAME           SCHEDULE      SUSPEND   ACTIVE   LAST SCHEDULE   AGE
daily-backup   0 2 * * *     False     0        <none>          10s
```

```bash
# CronJob이 생성한 Job 확인 (스케줄 시점 이후)
kubectl get jobs -l job-name
```

---

## 4. 시험 출제 패턴과 팁

### 4.1 시험 팁

```bash
# Pod YAML 빠른 생성 (dry-run)
kubectl run my-pod --image=nginx:1.25 --port=80 --dry-run=client -o yaml > pod.yaml

# Job 빠른 생성
kubectl create job my-job --image=busybox:1.36 -- echo "hello"

# CronJob 빠른 생성
kubectl create cronjob my-cron --image=busybox:1.36 --schedule="*/5 * * * *" -- echo "hello"

# 필드 구조 확인
kubectl explain job.spec
kubectl explain cronjob.spec
kubectl explain pod.spec.volumes.emptyDir
kubectl explain pod.spec.volumes.persistentVolumeClaim
```

---

## 5. 트러블슈팅

### 5.1 PVC가 Pending 상태에 머무는 경우

```bash
kubectl get pvc -n <namespace>
kubectl describe pvc <pvc-name> -n <namespace>
```

검증 (Pending 상태):
```text
NAME       STATUS    VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS   AGE
app-data   Pending                                      standard       30s

Events:
  Warning  ProvisioningFailed  5s  persistentvolume-controller  storageclass.storage.k8s.io "standard" not found
```

주요 원인:
- **StorageClass 미존재**: `kubectl get sc`로 사용 가능한 StorageClass를 확인한다.
- **용량 부족**: 요청한 storage가 가용 PV보다 크다.
- **accessModes 불일치**: 기존 PV가 요청한 accessMode를 지원하지 않는다.

### 5.2 Job이 Failed 상태인 경우

```bash
kubectl describe job <job-name>
kubectl get pods -l job-name=<job-name>
kubectl logs <pod-name>
```

검증:
```text
NAME         STATUS   COMPLETIONS   DURATION   AGE
my-job       Failed   0/1           60s        65s

Pods Statuses:  0 Active / 0 Succeeded / 3 Failed
```

주요 원인:
- **backoffLimit 초과**: Pod가 반복 실패하여 재시도 한도에 도달했다.
- **activeDeadlineSeconds 초과**: Job이 시간 제한을 초과했다. Events에 "DeadlineExceeded"가 표시된다.
- **restartPolicy 설정 오류**: Job에 `restartPolicy: Always`를 사용하면 API Server가 거부한다.

### 5.3 CronJob이 실행되지 않는 경우

```bash
kubectl get cronjob <name> -o jsonpath='{.spec.suspend}'
kubectl describe cronjob <name> | grep -A5 "Events:"
```

주요 원인:
- **suspend: true**: CronJob이 일시 중지 상태이다.
- **startingDeadlineSeconds 초과**: 스케줄 시점을 너무 오래 놓쳤다.
- **concurrencyPolicy: Forbid + 이전 Job 실행 중**: 이전 Job이 완료되지 않아 새 Job이 생성되지 않는다.

---

## 6. 복습 체크리스트

- [ ] emptyDir과 PVC의 차이를 설명할 수 있다
- [ ] emptyDir의 medium: Memory 옵션과 sizeLimit을 이해한다
- [ ] PVC의 accessModes (RWO, RWX, ROX)를 구분할 수 있다
- [ ] Job의 completions, parallelism, backoffLimit 필드를 설명할 수 있다
- [ ] Job의 restartPolicy가 Never 또는 OnFailure만 가능한 이유를 안다
- [ ] CronJob의 schedule 형식(분 시 일 월 요일)을 작성할 수 있다
- [ ] CronJob의 concurrencyPolicy (Allow, Forbid, Replace)를 구분할 수 있다
- [ ] `kubectl create job`, `kubectl create cronjob` 명령을 사용할 수 있다

---

## tart-infra 실습

### 실습 환경 설정

```bash
# dev 클러스터에 접속
export KUBECONFIG=~/sideproejct/tart-infra/kubeconfig/dev.yaml
kubectl get nodes
```

검증:
```text
NAME         STATUS   ROLES                  AGE   VERSION
dev-node-1   Ready    control-plane,master   xxd   v1.xx.x
```

### 실습 1: Volume 공유 패턴 확인

```bash
# demo 네임스페이스에서 멀티 컨테이너 Pod 확인
kubectl get pods -n demo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .spec.containers[*]}{.name}{" "}{end}{"\n"}{end}'
```

**동작 원리:** emptyDir 볼륨의 생명주기:
1. Pod 생성 시 노드의 `/var/lib/kubelet/pods/<pod-uid>/volumes/kubernetes.io~empty-dir/` 경로에 디렉토리가 생성된다
2. Pod 내 모든 컨테이너가 동일 볼륨을 마운트하여 데이터를 공유한다
3. Pod가 삭제되면 해당 디렉토리와 데이터도 함께 삭제된다
4. `medium: Memory`를 사용하면 tmpfs에 저장되어 I/O가 빠르지만 메모리 사용량이 증가한다

### 실습 2: Job/CronJob 상태 확인

```bash
# 기존 Job 확인
kubectl get jobs -A 2>/dev/null | head -10
```

검증:
```text
NAMESPACE   NAME         STATUS     COMPLETIONS   DURATION   AGE
demo        pg-check     Complete   1/1           3s         xxd
```

```bash
# CronJob 확인
kubectl get cronjobs -A 2>/dev/null | head -10
```

검증:
```text
NAMESPACE   NAME        SCHEDULE      SUSPEND   ACTIVE   LAST SCHEDULE   AGE
demo        svc-check   */1 * * * *   False     0        30s             xxd
```

**동작 원리:** Job Controller의 동작:
1. Job Controller는 `completions` 수만큼의 Pod가 성공적으로 종료(exit 0)될 때까지 Pod를 생성한다
2. `parallelism`에 따라 동시에 실행되는 Pod 수를 제한한다
3. Pod가 실패하면 `backoffLimit`까지 재시도하고, 초과하면 Job을 Failed로 표시한다
4. CronJob Controller는 `schedule`에 따라 주기적으로 Job 오브젝트를 생성한다
