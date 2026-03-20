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

**공학적 정의:**
emptyDir은 Pod 생성 시 노드의 로컬 디스크(또는 tmpfs)에 빈 디렉토리를 생성하는 임시 볼륨이다. Pod 내 여러 컨테이너가 동일 볼륨을 마운트하여 파일시스템을 통해 데이터를 공유하며, Pod가 삭제되면 볼륨 데이터도 함께 소멸한다. medium 필드를 "Memory"로 설정하면 tmpfs(RAM 디스크)를 사용하여 I/O 성능이 향상되지만 메모리 사용량이 증가한다.

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

**공학적 정의:**
PVC는 사용자가 스토리지를 요청하는 선언적 API 오브젝트로, StorageClass를 통해 PV(PersistentVolume)를 동적 프로비저닝하거나 기존 PV에 바인딩된다. Pod가 삭제되어도 PVC에 바인딩된 PV의 데이터는 유지되며, reclaimPolicy(Retain, Delete)에 따라 PVC 삭제 시 데이터 처리가 결정된다.

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

**공학적 정의:**
Job은 batch/v1 API 그룹의 워크로드 컨트롤러로, 하나 이상의 Pod를 생성하여 지정된 작업이 성공적으로 완료(exit code 0)될 때까지 실행을 관리한다. completions 필드로 필요한 성공 완료 수를, parallelism 필드로 동시 실행 Pod 수를, backoffLimit 필드로 실패 재시도 횟수를, activeDeadlineSeconds로 전체 실행 시간 제한을 설정한다.

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

# Job 상태 확인
kubectl get jobs -n demo
kubectl describe job backup-job -n demo

# Job의 Pod 로그 확인
kubectl logs job/backup-job -n demo
```

---

## 3. CronJob (크론잡) - 스케줄 기반 반복 작업

### 3.1 CronJob이란?

**공학적 정의:**
CronJob은 batch/v1 API 그룹의 스케줄 기반 Job 컨트롤러로, UNIX cron 형식의 schedule 필드에 따라 주기적으로 Job 오브젝트를 생성한다. concurrencyPolicy(Allow/Forbid/Replace)로 동시 실행을 제어하고, successfulJobsHistoryLimit/failedJobsHistoryLimit로 완료된 Job 보관 수를 관리한다.

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

# CronJob 상태 확인
kubectl get cronjobs -n demo
kubectl describe cronjob daily-backup -n demo

# CronJob이 생성한 Job 확인
kubectl get jobs -l job-name -n demo
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

## 5. 복습 체크리스트

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

# CronJob 확인
kubectl get cronjobs -A 2>/dev/null | head -10
```

**동작 원리:** Job Controller의 동작:
1. Job Controller는 `completions` 수만큼의 Pod가 성공적으로 종료(exit 0)될 때까지 Pod를 생성한다
2. `parallelism`에 따라 동시에 실행되는 Pod 수를 제한한다
3. Pod가 실패하면 `backoffLimit`까지 재시도하고, 초과하면 Job을 Failed로 표시한다
4. CronJob Controller는 `schedule`에 따라 주기적으로 Job 오브젝트를 생성한다
