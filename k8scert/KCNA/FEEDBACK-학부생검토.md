# KCNA 교재 — 학부 3~4학년 관점 검토 피드백

> 생성: 2026-06-12 · 파일당 1 에이전트 병렬 검토 · 기준 CLAUDE §4④

- 단독합격 **6/15** · 평균 가독성 **3.6/5** · 평균 스토리라인 **3/5**
- 부족분 총 **144** (HIGH 55/MED 59/LOW 30) · HIGH 카테고리: 용어비약 16, 실습재현불가 11, 맥락점프 11, 스토리라인누락 10, 이해난이도 5, 정확성오류 2

| 파일 | 합격 | 가독성 | 스토리 | H/M/L |
|:--|:--:|:--:|:--:|:--:|
| 01-concepts.md | ✅ | 4 | 5 | 0/2/9 |
| 02-examples.md | ❌ | 3 | 3 | 4/3/1 |
| 03-exam-questions.md | ❌ | 4 | 3 | 4/4/2 |
| 04-tart-infra-practice.md | ❌ | 3 | 4 | 4/5/3 |
| 05-supplement.md | ❌ | 4 | 3 | 4/5/1 |
| daily/day01.md | ✅ | 4 | 3 | 4/3/1 |
| daily/day02.md | ❌ | 3 | 2 | 9/5/1 |
| daily/day03.md | ✅ | 4 | 4 | 2/3/2 |
| daily/day04.md | ❌ | 4 | 3 | 7/6/2 |
| daily/day05.md | ❌ | 4 | 3 | 2/5/2 |
| daily/day06.md | ✅ | 3 | 2 | 2/4/1 |
| daily/day07.md | ✅ | 4 | 4 | 2/5/3 |
| daily/day08.md | ❌ | 3 | 2 | 4/4/0 |
| daily/day09.md | ❌ | 3 | 2 | 5/2/1 |
| daily/day10.md | ✅ | 4 | 2 | 2/3/1 |

---

### 01-concepts.md · 가독성 4/5 · 스토리 5/5 · 합격✅

- **🟡 MED** `스토리라인누락` _§1.9 NetworkPolicy 정의_
  - 문제: NetworkPolicy가 왜 필요한지(기존 Flat Network의 보안 위험) 설명은 있으나, '넷플릭스/우버 같은 회사에서 마이크로서비스 환경에서 발생한 보안 사고'같은 구체적 배경 예시 없음. 개념만 추상적
  - 보강: '기존 K8s는 모든 Pod가 기본 허용(Flat Network)이므로, 한 Pod가 침해되면 DB Pod까지 직접 접근 가능했다. 이를 차단하기 위해 NetworkPolicy가 필수이다'는 문제 상황 명시
- **🟡 MED** `맥락점프` _§5.2 CI/CD 배포 전략 / 카나리 배포_
  - 문제: 'Istio, Flagger 등의 도구가 K8s에서 카나리 배포를 자동화한다'고 소개하지만, 이 도구들의 설치·사용법이 문서에 없음. 학생이 실제 구현이 불가능함
  - 보강: 언급하지 않거나, '이는 별도 심화 문서(certification/)에서 다룬다' 링크 추가. 또는 'Deployment만으로는 카나리를 직접 구현하기 어렵고 CanaryDeployment CRD 등이 필요하며, 다음 과정에서 실습한다'고 명시
- **⚪ LOW** `용어비약` _§1.5 Namespace 설명 / 'kube-node-lease' 네임스페이스_
  - 문제: '노드의 하트비트(heartbeat)와 관련된 Lease 오브젝트'라는 설명이 신입 학생에게 Lease 개념이 없으면 추상적임
  - 보강: Lease 오브젝트를 한 문장으로 풀이: 'Lease는 클러스터가 각 노드가 살아있는지 주기적으로 확인하는 신호 저장소로, 약 4KB 메모리만 차지한다'
- **⚪ LOW** `용어비약` _§2.1 namespace(프로세스 격리) / 'UTS namespace'_
  - 문제: 'UTS'가 설명 없이 나옴. 신입 학생이 Hostname/Domain 격리라는 의미를 모를 수 있음
  - 보강: 'UTS(UNIX Timesharing System) namespace: 호스트명과 도메인명 격리'로 확장
- **⚪ LOW** `용어비약` _§2.4 containerd 설명 / 'runc에 위임'_
  - 문제: runc가 이전에 소개되지 않으면 계층 관계가 불명확. 2.4와 2.5의 순서 문제
  - 보강: 순서 재정렬: 2.4 runc(저수준) → 2.5 containerd(고수준 → 이 그림을 참조)로 조정, 또는 2.4에서 '다음 절 2.5에서 runc를 소개한다'고 선행 언급
- **⚪ LOW** `실습재현불가` _§1.3 Service(클러스터 IP) 검증 / DNS nslookup_
  - 문제: 'busybox:1.36 --rm -it' 명령이 기대 출력(Server 10.96.0.10, Address 10.96.45.123)과 맞지 않을 수 있음. 클러스터마다 CoreDNS Pod IP가 다르므로, 학생 환경에서 정확히 이 IP가 나온다고 보장할 수 없음
  - 보강: '기대 출력은 예시이며, 실제로는 kube-system 네임스페이스의 coredns IP가 Server로 표시된다. kubectl get service kube-dns -n kube-system으로 확인하라' 명시
- **⚪ LOW** `맥락점프` _§3.1 CNCF Landscape 표 / 'Observability & Analysis' 항목_
  - 문제: Prometheus/Grafana가 '메트릭/시각화'로만 소개되는데, 이들과 §4.1의 'Three Pillars(메트릭·로그·트레이스)' 사이 연결이 명시 안 됨. 학생이 Prometheus가 메트릭만이고 로그/트레이스는 다른 도구라는 것을 명시적으로 알기 어려움
  - 보강: §3.1 Landscape에 주석: 'Prometheus는 메트릭 수집(§4.1), Loki/Fluentd는 로깅(§4.3), Jaeger는 트레이싱(§4.4)을 담당한다' 추가
- **⚪ LOW** `이해난이도` _§3.4 서비스 메시 / 'Data Plane과 Control Plane'_
  - 문제: 개념 정의는 있으나, 학생이 '사이드카 프록시가 정확히 어디에 위치하는지'를 시각적으로 이해하기 어려움. 텍스트만으로는 부족
  - 보강: Mermaid 다이어그램 추가: Pod[App Container | Envoy Sidecar]가 같은 네트워크 네임스페이스를 공유하는 그림 필수
- **⚪ LOW** `용어비약` _§4.1 메트릭 / 'Pushgateway'_
  - 문제: 'Push 방식도 지원한다(단기 실행 작업에 적합)'는 설명만 있고, '왜 배치 Job에는 Pull이 아닌 Push가 필요한가'를 설명 안 함. 신입이 의도를 모를 수 있음
  - 보강: '배치 Job은 수 초 만에 완료되어 종료되므로, Prometheus의 Pull이 작업을 놓칠 수 있다. 따라서 Job이 실행 중에 메트릭을 Pushgateway에 PUSH한 후 Prometheus가 Pushgateway를 PULL하는 간접 방식을 쓴다' 설명 추가
- **⚪ LOW** `정확성오류` _§2.4 containerd 설명 / 'runc에 위임'_
  - 문제: 정확히는 runc 외에도 다른 OCI runtime(gvisor, kata 등)을 사용할 수 있다는 배경이 빠짐. containerd가 다양한 런타임을 지원한다는 유연성이 강점인데, 이를 강조하지 않음
  - 보강: 'containerd는 OCI 표준을 구현한 어떤 런타임이든 사용 가능하며, 기본은 runc이지만 gVisor나 Kata Containers로 교체할 수 있다' 추가
- **⚪ LOW** `이해난이도` _§5.1 GitOps / Configuration Drift_
  - 문제: '누군가가 kubectl edit으로 직접 변경하면 Git과 불일치'라는 drift 개념이 추상적. 학생이 실제 피해를 못 느낄 수 있음
  - 보강: 시나리오: '프로덕션에서 누군가 수동으로 Pod 수를 5개로 변경했는데, Git에는 3개로 남아 있다. 3주 후 재배포하면 Pod가 3개로 줄어 트래픽 장애가 발생한다' 같은 구체적 예시 추가

### 02-examples.md · 가독성 3/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `용어비약` _전체(§1.3, §6.3, §10.1, §11, §13)_
  - 문제: QoS(Guaranteed/Burstable/BestEffort), apiGroups(""/"apps"), PromQL 문법(rate/increase 함수), Ingress Controller 역할, NetworkPolicy의 implicit deny 원칙 등 핵심 용어가 정의 없이 사용됨. 예: QoS는 부록에서야 설명, apiGroups는 표에 예시만 있고 의미 미설명, PromQL 함수 사용법 없음
  - 보강: ① 모든 K8s 고유 용어 첫 등장 시 '한 문장 정의 + 1~2줄 예시' 추가: 'QoS 클래스는 Pod의 리소스 부족 시 우선순위를 정하는 분류기준으로, requests와 limits 설정 여부에 따라 Guaranteed/Burstable/BestEffort로 나뉜다' / ② apiGroups 표 옆에 주석 추가: '빈 문자열("")은 코어 API 그룹(Pod/Service/PV 등)을 의미하고, "apps"는 Deployment/StatefulSet 등 apps 그룹 리소스를 의미한다' / ③ §18.3 PromQL 섹션에 'rate(메트릭[5m])는 5분 동안의 증가율, increase(메트릭[1h])는 1시간 동안의 절댓값 증가량을 계산한다' 명기
- **🔴 HIGH** `스토리라인누락` _§2.1 Deployment, §3.1 Service, §6.1 PV/PVC, §11.1 Ingress_
  - 문제: 각 섹션의 '등장 배경'은 이전 시대 문제점을 언급하지만, '직전 기술과의 정확한 차이'를 명시하지 않아 학생이 '이게 왜 나아진 건가' 이해하지 못함. 예: Deployment는 '선언적 업데이트'라고만 하고 'ReplicaSet은 고정 Pod 템플릿만 유지하는데 Deployment는 템플릿 변경 시 신구 ReplicaSet을 자동으로 교체한다'는 차이를 안 씀 / Service는 '고정 IP'를 제공한다고 하지만 '동적 Endpoints 갱신'(Pod 추가/삭제 시 자동 반영)이 핵심 개선점인데 미언급 / PV/PVC는 '추상화'만 언급하고 '관리자 vs 개발자 역할 분리'의 실제 이점 미설명 / Ingress는 'LoadBalancer 비용 문제'만 언급하고 'L7 라우팅(URL 경로/호스트 기반)'이라는 기술 차이 미명시
  - 보강: ① Deployment(§2.1): '이전 ReplicaSet은 Pod 템플릿이 변경되면 새 ReplicaSet을 수동으로 관리해야 했지만, Deployment는 이를 자동화해 선언적 업데이트와 롤백을 제공한다. 또한 revisionHistoryLimit으로 이전 ReplicaSet을 자동 보존해 언제든 이전 버전으로 롤백 가능하다' 추가 / ② Service(§3.1): '직전에는 Pod IP를 직접 참조했는데 Pod가 재생성되면 IP가 바뀌어 연결이 끊겼다. Service는 selector로 Pod를 동적으로 추적해 고정 ClusterIP와 DNS 이름(예: nginx-clusterip.default.svc.cluster.local)을 제공해 클라이언트는 IP 변화를 신경 쓸 필요가 없다' 추가 / ③ PV/PVC(§6.1): '기존엔 개발자가 NFS/iSCSI 세부 정보를 Pod spec에 직접 기술했어야 해 운영 부담이 컸다. PV/PVC 모델은 인프라 상세(스토리지 타입)를 PV로 분리해 개발자는 PVC로 용량만 요청하면 관리자가 적절한 PV를 프로비저닝하거나 StorageClass가 자동으로 생성한다' 추가 / ④ Ingress(§11.1): 'LoadBalancer는 서비스마다 외부 IP를 할당해 비용과 관리 복잡도가 증가한다. Ingress는 하나의 L7 로드밸런서에서 HTTP/HTTPS 라우팅 규칙(호스트/경로 기반)으로 여러 Service를 제어해 리소스 효율을 높인다' 추가
- **🔴 HIGH** `이해난이도` _§6(PV/PVC/SC), §10(HPA 메트릭), §13(RBAC apiGroups/verbs)_
  - 문제: ① PV/PVC/StorageClass 관계: 3개 개념이 한꺼번에 나오는데, 바인딩 메커니즘(PVC가 조건에 맞는 PV를 찾는 과정)과 동적 프로비저닝(StorageClass가 없을 때 자동 생성)의 흐름이 불분명. volumeBindingMode 차이(Immediate vs WaitForFirstConsumer)도 '실제로 어떻게 다른가' (Immediate는 Pod 스케줄링 전에 볼륨 생성 → AZ 불일치 가능, WaitForFirstConsumer는 Pod 스케줄링 후 생성 → AZ 일치)가 명시되지 않아 학부생은 '왜 이 설정이 필요한가' 모름 / ② HPA: 공식 제시되지만 '어떤 메트릭이 사용되는가'(CPU Utilization % vs 절댓값 cores)가 혼동됨. 예: §10.3 '70%'라고 하면 Request 대비 비율인데, 이게 명확히 안 됨 / ③ RBAC: apiGroups 개념("" = core, "apps" = Deployment용, "rbac.authorization.k8s.io" = Role용)과 resources(pods, pods/log)의 차이가 예제로만 나와 학부생이 '왜 어떤 건 "" 고 어떤 건 "apps"인가' 못 알아챔
  - 보강: ① PV/PVC/SC 섹션 앞에 흐름도 추가(mermaid): 'PVC 생성 → storageClassName 지정되었나? → [예] StorageClass 찾기 → [조건 맞는 PV 있나?] → [있음] 바인딩 / [없음] 프로비저너가 동적 생성 / [아니오] Pending' / ② volumeBindingMode 주석: 'Immediate(기본): PVC 생성 직후 PV 프로비저닝 (Pod 스케줄링 전) → 스토리지가 Pod 노드과 다른 AZ에 있을 수 있음 / WaitForFirstConsumer: Pod가 스케줄링될 노드 AZ와 같은 곳에 스토리지 생성 → 네트워크 지연 최소화' / ③ HPA 메트릭 섹션에 'CPU Utilization %는 Pod의 requests.cpu 대비 현재 사용률 백분율이다. 예: requests.cpu=100m, 실제 사용=70m이면 70%' 명시 / ④ RBAC apiGroups 표 옆 주석: 'apiGroups: [""](빈 문자열) = 코어 API 그룹으로 Pod/Service/ConfigMap 등 기본 리소스 / ["apps"] = Deployment/StatefulSet/DaemonSet 리소스 / ["rbac.authorization.k8s.io"] = Role/ClusterRole 같은 RBAC 리소스를 의미한다. kubectl api-resources로 각 리소스의 API 그룹을 확인할 수 있다' 추가
- **🔴 HIGH** `실습재현불가` _전체 §1.3~§19 검증 섹션_
  - 문제: CLAUDE.md §4①에서 '모든 명령 실행 결과는 실제 터미널 스크린샷 이미지'를 사용하라고 규정했는데, 이 파일은 모든 출력을 ` ```text ` 코드블록으로 제시. 학부생이 '이게 실제 나오는 건가?'라고 의심할 수 있고, 지어낸 출력과 실제 출력 구분 불가. 예: '```text NAME READY STATUS ... ```'는 실제 `kubectl get pod` 출력 형식이지만, 정확한 너비·정렬·색상을 터미널 스크린샷 없이는 검증 불가. 추가로 namespace 미명시(예제는 default로 가정하지만 명시 없음)와 IP 주소 하드코딩(10.244.1.15, 203.0.113.50)으로 학생 환경과 불일치할 수 있음
  - 보강: ① 각 검증 섹션의 ` ```text ` 블록을 실제 클러스터에서 명령을 실행한 PNG 스크린샷으로 교체. 예: `kubectl get pods -n default`를 실제 터미널(iTerm2/Terminator 등)에서 실행하고 캡처 / ② 모든 kubectl 명령에 명시적 namespace 추가: `kubectl get pod nginx-pod -n default` (예제가 기본 네임스페이스 default를 가정하면 '# (default 네임스페이스)' 주석 추가) / ③ IP 주소 앞에 '(예시)' 주석 또는 '환경마다 다를 수 있음' 명시: '```text NAME ... IP ... NODE nginx-pod ... 10.244.1.15 (예시) ... worker-1 ```'
- **🟡 MED** `맥락점프` _§12(NetworkPolicy)-§13(RBAC) 경계, §15(Helm)-§16(Kustomize) 경계_
  - 문제: 같은 목적(최소 권한, 환경별 관리)을 하는 기술들이 나란히 있는데 차이와 선택 기준이 명시되지 않아 학부생이 '둘 다 뭐 하는 건지 구분이 안 된다'고 느낄 수 있음. NetworkPolicy는 Pod 간 네트워크 통신 제어(L3/L4), RBAC는 사용자의 API 리소스 조작 권한 제어(L7 인증/인가)인데, 이 관계를 명시하지 않음. Helm과 Kustomize는 둘 다 환경별 구성 관리인데, 템플릿 엔진 vs 패치 오버레이라는 철학적 차이와 '언제 어떤 걸 쓰는가' 가이드가 없음
  - 보강: ① NetworkPolicy-RBAC 비교 섹션 추가: '| 기술 | 범위 | 역할 | / | --- | --- | --- | / | NetworkPolicy | Pod 간 네트워크 통신(L3/L4) | 파드 A에서 파드 B로의 네트워크 패킷 흐름 제어 | / | RBAC | 사용자의 API 리소스 조작(L7) | 사용자 X가 Pod를 get/create/delete 할 수 있는가 결정 |' 추가 / ② Helm-Kustomize 비교 섹션: '| 특성 | Helm | Kustomize | / | --- | --- | --- | / | 방식 | 템플릿 엔진(Go templates) | 패치 오버레이 | / | 학습곡선 | 높음 | 낮음 | / | 재사용성 | Chart Hub에서 공개 Chart 활용 | 조직 내 base 재사용 | / | 언제 쓰나 | 복잡한 애플리케이션 배포/버전 관리 | 간단한 환경별 구성(dev/prod) 차이 |' 추가
- **🟡 MED** `구조` _전체 구성(목차 부재, 학습 계획 미포함)_
  - 문제: 파일이 19개 섹션을 포함하는 대형 교재인데, 목차(table of contents)가 없어 학부생이 '지금 어디를 읽고 있는가' 알기 어려움. 또한 '오늘의 학습 목표' (체크리스트) 같은 명시적 구조가 없어 CLAUDE.md §5의 'daily 양식'과 불일치. 예: 각 섹션이 '① 이 주제 배우기 전 선수지식, ② 학습 목표 (체크리스트), ③ 내용, ④ 자가점검' 구조로 명확히 되지 않음
  - 보강: ① 파일 상단에 목차 추가: '## 목차\n- [1. Pod](#1-pod)\n- [2. Deployment](#2-deployment)\n...\n- [19. kubectl 명령어 종합](#19-kubectl)' / ② 각 섹션 시작 전에 '학습 목표' 박스 추가: '> 학습 목표 | 이 섹션에서는 Pod의 생명주기, 라이프사이클 페이즈, 기본 YAML 구조를 이해하고 직접 Pod를 배포/검증할 수 있다 | 도메인: Core API (비중 15%) | 예상 소요 시간: 30분' / ③ 섹션 말미에 '✅ 자가점검' 추가: '다음을 확인해보세요 (정답은 <details> 펼치기) - Pending/Running/Succeeded 상태의 차이는? - livenessProbe와 readinessProbe의 차이는? - emptyDir 볼륨이 Pod 삭제 시 어떻게 되는가?'
- **🟡 MED** `정확성오류` _§3.5 ExternalName 설명_
  - 문제: 'CNAME 리다이렉션'이라는 표현이 기술적으로 다소 부정확. ExternalName Service는 실제 DNS 레벨에서 CNAME을 생성하는 것이 아니라, Kubernetes 내부의 coreDNS가 ExternalName 서비스의 DNS 쿼리에 대해 외부 FQDN을 응답하는 방식. 클라이언트가 `external-db` 를 쿼리하면 coreDNS가 `database.example.com` 으로 응답(CNAME 같은 효과)하지만, 실제 DNS 리소스 레코드는 아님
  - 보강: 'CNAME 리다이렉션'을 '외부 FQDN으로의 DNS 별칭 제공'으로 수정. 자세히: '클러스터 내부에서 external-db로 접근하면 coreDNS가 database.example.com 으로 응답해, 실제 쿼리는 외부 DNS 서버로 전달된다. 이는 DNS 레벨 CNAME과 유사한 효과를 제공하지만, ExternalName Service 자체는 실제 DNS 리소스를 변경하지 않는다'
- **⚪ LOW** `용어비약` _§4 ConfigMap, §5 Secret_
  - 문제: ConfigMap/Secret의 '볼륨 마운트 시 자동 갱신' 기능(kubelet이 주기적으로 갱신)이 언급되지만, 갱신 간격(기본 약 60초)과 갱신이 되지 않는 경우(subPath 마운트)가 footenote 수준으로만 언급. 학부생이 '언제 ConfigMap 변경이 반영되는가'를 명확히 모를 수 있음
  - 보강: §4.5 ConfigMap 볼륨 마운트 섹션에 별도 호명(callout box): '⚠️ 자동 갱신 주의: ConfigMap/Secret을 볼륨으로 마운트한 경우, kubelet이 약 60초 간격으로 변경을 감지해 자동으로 파일을 업데이트한다. 단, subPath를 사용한 마운트(예: mountPath에서 특정 키만 선택)는 자동 갱신이 되지 않으므로 Pod를 재시작해야 한다'

### 03-exam-questions.md · 가독성 4/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `실습재현불가` _모든 문제 검증 섹션_
  - 문제: 기대 출력을 ```text 블록으로만 텍스트 형태로 제시했음. CLAUDE.md 규약 Section 4.1에서 명시한 실제 터미널 화면 PNG 이미지 캡처 요구사항을 100% 위반. 학생이 실제 클러스터에서 명령 실행 결과를 비교/검증할 수 없음.
  - 보강: 각 검증 섹션마다 실제 tart 클러스터에서 명령을 실행하고 터미널 스크린샷을 PNG로 캡처하여 images/ 폴더에 저장 후 ![](images/filename.png) 형태로 삽입. 예: 문제 1의 etcdctl endpoint status 실행 화면, 문제 2의 kubectl get pods -o wide 실행 화면 등. 40개 문제 x 평균 3-5개 스크린샷 = 최소 120-200개 이미지 필요.
- **🔴 HIGH** `용어비약` _문제 1~10 (Kubernetes Fundamentals)_
  - 문제: Raft 합의 알고리즘, Watch API, Protobuf 직렬화, etcd 리더 선출 등의 용어가 문맥 충고 없이 등장. 학부생은 Raft/분산 시스템 개념이 없는 상태에서 읽으면 이해 불가능. 예: 문제 1에서 Raft 합의 알고리즘을 사용하여 데이터 일관성을 보장한다고 했으나, Raft가 무엇인지, 왜 필요한지, 합의가 어떻게 이루어지는지 설명 없음.
  - 보강: 각 용어 첫 등장 시 1-2문장 풀이 추가. Raft = 분산 시스템에서 여러 노드가 동일한 상태에 동의하기 위한 프로토콜로, etcd는 여러 복제본 중 과반수(quorum)가 승인하면 쓰기를 커밋. 또는 용어집 추가.
- **🔴 HIGH** `스토리라인누락` _문제 3 (Pod), 문제 5 (ClusterIP), 문제 8 (PV 접근모드)_
  - 문제: 등장 배경 섹션은 있으나 매우 짧고, 이전 기술과의 한계 비교가 없음. 예: 문제 5(ClusterIP)의 배경에서 Pod가 일시적이라는 것은 언급하나, 직접 Pod IP로 통신하면 어떤 구체적 문제가 생기는지 설명 없음. 문제 8(PV 접근모드)에서도 접근 모드가 왜 필요한지(한계)가 명확하지 않음.
  - 보강: 배경 섹션을 2-3문단으로 확장: (1) 이전 기술 상태 - 구체적 고통 사례(예: Pod IP 변경되면 클라이언트가 어떻게 되는가?) (2) 직전 해결책의 한계(수동으로 /etc/hosts 관리? DNS 캐싱?) (3) 새 기술이 어떻게 극복했나 (4) 트레이드오프.
- **🔴 HIGH** `맥락점프` _문제 7(ConfigMap)과 13(Secret)의 연결, 문제 18(Job restartPolicy)과 일반 Pod의 관계_
  - 문제: ConfigMap과 Secret을 별개 문제로 다루지만, 둘의 차이(기밀성)와 선택 기준이 명시되지 않음. 또한 일반 Pod의 restartPolicy 기본값이 Always인데, 문제 18에서 Job은 Never/OnFailure만 허용한다고 할 때, 왜 Always가 문제인지 설명 없음.
  - 보강: ConfigMap/Secret 설명에 비교 표 추가(사용 사례, 크기, 기밀성). Job의 오답 분석에서 Why Always가 문제인지 명시: Job은 완료 후 종료를 의미하는데, Always면 완료 후에도 계속 재시작되어 Job이 영원히 끝나지 않음.
- **🟡 MED** `정확성오류` _문제 17 (Ingress Controller), 문제 21 (v1.24 dockershim 제거)_
  - 문제: 문제 17에서 Ingress Controller가 클러스터에 설치되어 있어야 한다는 것은 맞으나, 어떤 클러스터 설정에서 기본으로 포함되는지 명확하지 않음. 문제 21의 오답 A에서 Mirantis의 cri-dockerd를 언급했으나, 정답에서는 Docker를 직접 사용할 수 없다고만 했음. 혼동 가능성 있음.
  - 보강: 문제 17에 주석: 대부분의 관리형 K8s(EKS, GKE)는 기본 Ingress Controller를 제공하지 않으며 설치 필요. 문제 21의 정답 표현을 더 정밀하게: 공식 쿠버네티스는 dockershim 제거했지만, Mirantis의 cri-dockerd를 사용하면 Docker 가능(단 공식 지원 아님).
- **🟡 MED** `이해난이도` _문제 19(namespace), 문제 30(Sidecar Proxy), 문제 36(OpenTelemetry)_
  - 문제: 문제 19에서 namespace의 종류(PID, UTS, IPC)를 나열만 했을 뿐, 각 namespace가 어떤 격리를 제공하는지 구체적 예시 없음. 문제 30에서 Sidecar Proxy의 iptables 리다이렉트 메커니즘이 복잡하다고만 설명하고 구체적 동작을 설명하지 않음. 문제 36에서도 OpenTelemetry의 세 컴포넌트(API/SDK/Collector)를 나열만 했음.
  - 보강: 문제 19: 각 namespace마다 1문장 효과 추가 (예: PID = 각 컨테이너가 PID 1로 시작하고 호스트의 다른 프로세스를 보지 못함). 문제 30: iptables 규칙으로 리다이렉트하는 구체적 동작 추가. 문제 36: 세 컴포넌트의 역할을 문장으로 설명.
- **🟡 MED** `정확성오류` _문제 29 (마이크로서비스 장단점), 문제 39 (Helm v3 Tiller)_
  - 문제: 문제 29에서 마이크로서비스의 장점을 B) 서비스별 독립적인 스케일링이 가능하다고 했고, 설명에서 HPA를 통한 서비스별 자동 스케일링을 예로 들었으나, HPA는 Kubernetes 기능이지 마이크로서비스의 고유 특성이 아님. 문제 39에서는 Helm v3에서 Tiller 제거는 맞으나, Helm 사용자 입장에서 v2와 v3의 호환성 문제는 언급하지 않음.
  - 보강: 문제 29: 마이크로서비스의 진정한 장점은 "각 서비스가 독립된 프로세스이므로 일부만 스케일 아웃 가능"이라는 구조적 특성. HPA는 Kubernetes의 메커니즘이지 마이크로서비스 자체가 아님. 문제 39: Helm v2 차트는 v3에서 호환성이 없으므로 마이그레이션 필요라는 주의사항 추가.
- **🟡 MED** `구조` _전체 파일 구성_
  - 문제: 문제 1~40이 순서대로 있으나, 학생이 선수지식 없이 읽기 위한 재배열이 없음. 예: Pod를 이해해야 Deployment를 이해하는데, 현재 배열은 이 순서가 보장되지 않음. 또한 Kubernetes Fundamentals 섹션 내에서도 깊이의 순서(추상 수준)가 명확하지 않음.
  - 보강: 문제를 낮은 추상 수준부터 높은 수준으로 재배열: (1) Container/namespace/cgroups 기초 (2) Pod 최소 단위 (3) Deployment/StatefulSet 상위 리소스 (4) Service/NetworkPolicy 네트워킹 (5) RBAC 보안 (6) Ingress 외부 접근. 또는 각 섹션 시작 시 선수 요구사항 표시.
- **⚪ LOW** `용어비약` _문제 34 (관측성 세 기둥), 문제 37 (Fluentd)_
  - 문제: 관측성의 세 기둥 용어는 좋으나, CNCF의 공식 정의와 대조하는 설명이 없음. 정답에서 먼저 설명하지 않고 오답 분석에서만 설명. Fluentd의 플러그인 기반 아키텍처도 Input-Filter-Output 구조만 언급하고, 실제 K8s 환경에서 어떻게 DaemonSet으로 배포되어 로그를 수집하는지의 흐름 설명 없음.
  - 보강: 정답 첫 문단에 핵심 개념 정의를 앞에 배치. 관측성의 정의: 시스템의 외부 신호(로그, 메트릭, 트레이스)만으로 내부 상태를 추론할 수 있는 능력. Fluentd의 경우 K8s 흐름 추가: DaemonSet이 각 노드에 배포 → /var/log/containers/ 의 로그를 tail → 파싱 → Elasticsearch로 전송.
- **⚪ LOW** `스토리라인누락` _문제 28 (CNCF 성숙도 단계)_
  - 문제: CNCF 성숙도 모델(Sandbox-Incubating-Graduated)을 설명하나, 프로젝트가 왜 이런 단계 시스템이 필요한지(오픈소스 품질 평가 문제)가 명시되지 않음.
  - 보강: 배경: 오픈소스 프로젝트는 성숙도가 천차만별인데, 기업이 프로덕션에 도입할 때 안정성/지원 수준을 판단하기 어려움. CNCF의 3단계 모델은 객관적 기준을 제공.

### 04-tart-infra-practice.md · 가독성 3/5 · 스토리 4/5 · 미달❌

- **🔴 HIGH** `실습재현불가` _전체 파일 — 모든 '검증 — 기대 출력' 섹션_
  - 문제: CLAUDE.md 규약 제4항(실습 출력 — 무조건 스크린샷 이미지) 위반. 명령 실행 결과가 모두 ```text 블록의 텍스트로 제시되어 있음. 학생이 '실제로 이렇게 나온다'는 증거를 볼 수 없음.
  - 보강: 각 검증 섹션마다 실제 tart 클러스터에서 명령을 실행하고 터미널 스크린샷을 PNG로 캡처하여 k8scert/KCNA/images/ 에 저장하고 ![설명](images/파일.png) 형식으로 삽입. 예시: Lab 1.1 Step 2의 'kubectl ... get pods' 출력 → kubectl-get-pods-lab1.png 캡처
- **🔴 HIGH** `용어비약` _Lab 1.1, 라인 414-418, Lab 2.1, 라인 1500-1510, Lab 3.1, 라인 2630-2636_
  - 문제: 다음 용어들이 첫 등장 시 충분히 풀이되지 않음: (1) 'ownerReferences' (라인 1544) — Pod 소유 관계만 설명, garbage collection 메커니즘을 별도 설명해야 함, (2) 'DESIRED/CURRENT/READY' (라인 1501) — ReplicaSet 필드를 설명하나 state machine 시각화 부재, (3) 'pod-template-hash' (라인 1542) — 해시 생성 원리와 Rolling Update 시 역할을 생략, (4) 'nodePort 범위' (라인 2598) — 30000-32767 기본값을 언급하지 않음
  - 보강: 각 용어 첫 등장 시 다음 템플릿 적용: '용어(영문) — 한 줄 정의. [더 자세히] 내부 동작·설계 근거·언제 사용하는지. 예: ownerReferences — Pod의 소유 관계를 기록하는 메타데이터. Garbage Collector가 상위 리소스 삭제 시 이를 따라 cascade delete를 수행하는데, 예를 들어 Deployment 삭제 → ownerReferences 따라 ReplicaSet 삭제 → 각 Pod 삭제 순서로 진행된다.'
- **🔴 HIGH** `맥락점프` _Lab 2.1과 Lab 2.2 전환점 (라인 1443-1681)_
  - 문제: Lab 2.1은 Deployment-ReplicaSet-Pod 계층을 다루고, Lab 2.2는 Pod 상세(labels, QoS, Phase)를 다룸. 그 사이 '왜 갑자기 Pod의 세부 속성을 배우는가'라는 연결고리가 없음. Pod의 라이프사이클(Pending→Running→Succeeded/Failed)이 먼저 설명되어야 함.
  - 보강: Lab 2.1의 마지막에 '확인 문제' 전에 '다음 단계' 섹션 추가: 'Deployment-ReplicaSet-Pod 계층을 확인했습니다. 이제 Pod 내부의 상태(Phase), 리소스 설정(requests/limits), QoS 클래스를 이해해야 합니다. 이를 통해 Pod가 왜 Pending에 머물거나 OOMKilled되는지 진단할 수 있습니다.' 형식으로 미리 설명.
- **🔴 HIGH** `맥락점프` _실습 1(Fundamentals) 끝(라인 4297)과 실습 2(Container Orchestration) 시작(라인 4299) 사이_
  - 문제: 갑자기 '컨테이너 오케스트레이션' 도메인으로 점프. 실습 1에서 배운 아키텍처/스케줄링과 실습 2의 containerd/Self-Healing의 연결이 불분명. 'Fundamentals를 통해 Kubernetes 구조를 배웠으니, 이제 컨테이너 런타임부터 시작하는 이유'를 설명해야 함.
  - 보강: 실습 5 도입부에 다음 추가: '지금까지는 Kubernetes의 구조와 아키텍처를 학습했습니다(실습 1~4). 이제는 컨테이너 런타임·자동 복구·배포 전략 같은 오케스트레이션 기능을 실습합니다. 이는 실제 운영 환경에서 Pod가 어떻게 생성·실행·삭제되는지, 장애 시 어떻게 복구되는지를 이해하기 위함입니다.'
- **🟡 MED** `용어비약` _Lab 1.2, 라인 654-676, CRI 설명_
  - 문제: CRI 계층 다이어그램(그림 3)에서 'High-Level Runtime' vs 'Low-Level Runtime' 구분이 명확하지 않음. 'containerd는 high-level, runc는 low-level'이라는 것을 생략 — OCI Runtime Spec을 언급하지 않음.
  - 보강: 그림 3 아래에 다음 추가: 'containerd는 High-Level Runtime으로 이미지 관리·Pod 샌드박스 생성을 담당하고, runc는 OCI(Open Container Initiative) Runtime Spec을 구현한 Low-Level Runtime으로 실제 cgroup/namespace 기반 컨테이너를 생성합니다. CRI는 두 계층 사이의 인터페이스입니다.'
- **🟡 MED** `이해난이도` _Lab 3.4 (NetworkPolicy), 라인 3000-3206_
  - 문제: Cilium eBPF vs iptables 비교 설명(라인 3024-3029)이 추상적임. '왜 eBPF가 더 빠른가', '어느 단계에서 차이가 나는가' 구체적 설명 부족. XDP/TC hook 용어도 풀이 없음.
  - 보강: 라인 3024-3029 대체: 'Cilium(eBPF 기반): NetworkPolicy 규칙 → eBPF bytecode → Linux 커널(XDP/TC hook) 에서 패킷 처리. 패킷이 userspace를 거치지 않으므로 매우 빠름. Calico(iptables 기반): NetworkPolicy → iptables 규칙 → netfilter hook → 패킷 처리. 모든 패킷이 kernel netfilter를 거치므로 규칙 수가 많아지면 느려짐. XDP(eXpress Data Path): 드라이버 진입 직후 처리, TC(Traffic Control): 네트워킹 스택 내 처리. eBPF는 두 위치 모두 가능하여 더 유연.'
- **🟡 MED** `용어비약` _Lab 4.1, 라인 3219-3349, ConfigMap 마운트 원리_
  - 문제: ConfigMap 볼륨 마운트 시 심볼릭 링크 구조(..data → ..2026_03_30_10_00_00 형식, 라인 3328-3334) 설명이 너무 간단함. '왜 이렇게 복잡한 구조를 사용하는가' 이해 불가.
  - 보강: 라인 3349 아래에 추가: 'ConfigMap 업데이트 시 원자성(Atomicity)을 보장하는 방식입니다. 만약 파일을 직접 덮어쓰면 애플리케이션이 업데이트 중간에 파일을 읽을 때 부분 데이터를 받을 수 있습니다. 대신 새 디렉토리(타임스탐프)를 먼저 생성한 뒤, 심볼릭 링크 ..data를 원자적으로 변경하면, 애플리케이션은 항상 완전한 데이터를 읽을 수 있습니다.'
- **🟡 MED** `정확성오류` _Lab 4.2, 라인 3376-3393, Secret 암호화 설명_
  - 문제: etcd 암호화 설정 확인 명령(라인 3485-3487)이 불안정함. control-plane 노드 IP를 직접 사용하는데, 클러스터가 여러 control-plane을 가진 경우 실패 가능. 또한 API Server manifest 경로(--encryption-provider-config)는 클러스터 구성에 따라 다를 수 있음.
  - 보강: Step 4 명령 대체: '검증 명령어를 다음 중 하나로 사용하세요: (1) API Server 로그에서 직접 확인: kubectl --context=dev logs -n kube-system -l component=kube-apiserver | grep encryption (2) 실제로 Secret을 etcd에서 조회해 암호화 여부 확인(권장하지 않음). tart-infra에서는 기본적으로 etcd 암호화가 설정되어 있지 않으므로, Secret은 base64 인코딩된 평문으로 저장됩니다.'
- **🟡 MED** `스토리라인누락` _Lab 5.2 자동 복구, 라인 3861-4026_
  - 문제: Liveness Probe, Readiness Probe, Startup Probe의 세 가지 Probe 종류 설명이 분산됨. Readiness Probe만 별도 Step으로 설명되고, Startup Probe는 확인 문제 4번에만 언급됨.
  - 보강: Step 2 말미와 Step 3 사이에 Step 2.5 추가: '세 가지 Probe 비교: Liveness Probe(컨테이너 재시작 필요 여부) vs Readiness Probe(트래픽 수신 여부) vs Startup Probe(애플리케이션 시작 완료 대기). Startup Probe는 초기 구동 시간이 오래 걸리는 앱(Java, 초기화 로직 있는 앱)에서 Liveness 재시작을 지연시킵니다.'
- **⚪ LOW** `이해난이도` _Lab 1.4, 라인 1231-1441, kube-scheduler 동작 관찰_
  - 문제: Filtering (필터링) 단계의 플러그인들(NodeResourcesFit, NodeAffinity, TaintToleration, PodTopologySpread)을 나열만 하고, 각각이 어떤 조건을 평가하는지 상세 설명 부족. 실습에서도 리소스 부족 사례만 다름.
  - 보강: Step 1 이후에 '스케줄링 플러그인 상세' 섹션 추가: 각 필터링 플러그인이 어떤 Pod/노드 속성을 검사하는지 표로 정리. 예: NodeResourcesFit = (노드 리소스 >= Pod requests), TaintToleration = (노드의 모든 Taint에 Pod 의 toleration 있는가) 등
- **⚪ LOW** `스토리라인누락` _Lab 6.2 마이크로서비스 토폴로지, 라인 4412-4503_
  - 문제: API Gateway(nginx) 역할을 언급하지만, 실제로 nginx-web이 어떻게 httpbin v1/v2로 트래픽을 분배하는지 설명 없음. 또한 Canary 배포 패턴(v1 2개, v2 1개)이 단지 '레플리카 수 차이'로만 표시됨.
  - 보강: Step 1 이후에 'API Gateway 역할' 섹션 추가: 'nginx-web은 Service의 ClusterIP를 통해 httpbin 요청을 받고, Kubernetes의 라운드 로빈 로드밸런싱에 의해 httpbin 레플리카들로 분배합니다. Canary 배포는 새 버전(v2 1개)을 소수의 트래픽으로 먼저 검증하고, 문제가 없으면 gradually 비율을 높이는 패턴입니다. 이는 httpbin v1의 레플리카를 점차 줄이고 v2를 늘려서 구현합니다.'
- **⚪ LOW** `용어비약` _Lab 7.2, 라인 4784-4863, PromQL 실습_
  - 문제: PromQL 결과를 API로 조회하는 명령(curl 기반)이 복잡하고, 성공/실패 여부를 예측하기 어려움. 학생이 직접 Prometheus Web UI에서 쿼리를 입력하는 것이 더 간단할 것 같음.
  - 보강: PromQL 실습을 두 가지로 분리: (1) 문서에는 간단한 쿼리 예시(echo 로 출력), (2) 실제 실습: 'Prometheus Web UI (http://<platform-ip>:30903/graph)에 다음 쿼리를 입력하고 Execute 버튼을 누르세요:' 형식으로 브라우저 접속 기반 설명으로 전환

### 05-supplement.md · 가독성 4/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `실습재현불가` _Part 2 전체 (라인 818~1185)_
  - 문제: 모든 YAML 검증 명령 출력이 '```text' 텍스트 블록으로 제시되어 있음. CLAUDE.md의 절대규칙(§4①)에 명시된 대로 '실제 터미널 스크린샷 이미지'가 아니라 텍스트로 출력을 기재함. 학생은 '실제로 이렇게 나온다'는 화면 증거를 보지 못하고 주관식 설명만 읽음. 특히 Deployment 롤링 업데이트(§2.2)나 PDB eviction 동작(§1.1 라인 188-190) 같은 복잡한 동작은 실제 화면 캡처가 더욱 필수적.
  - 보강: Part 2의 모든 '검증 - 기대 출력' 블록(약 20곳)을 실제 tart 클러스터(dev/staging)에서 명령을 실행해 터미널 스크린샷 PNG로 캡처하고, 현재 텍스트 블록을 대체할 것. 예: '![Deployment 생성 및 상태 확인](images/02-2-deployment-status.png)' 형식. 스크린샷에는 프롬프트부터 출력 끝까지 포함(CLAUDE.md §4①참조).
- **🔴 HIGH** `용어비약` _Part 1.4 etcd 백업 (라인 719-762)_
  - 문제: 'Raft', '과반수(quorum)', '리비전(revision)', '컴팩션(compact)', 'defrag'같은 용어를 처음 등장할 때 충분히 풀이하지 않음. 특히 'Raft 합의 알고리즘'은 이름만 언급하고 '배경 없는 설명': 과반수가 왜 필요한가? 왜 홀수여야 하는가? 초학자는 '합의 = 투표' 정도의 직관만 얻고, 실제 etcd 동작 원리는 여전히 불명확함.
  - 보강: 'Raft' 첫 등장(라인 670)에 다음 설명 추가: '모든 데이터 쓰기는 대다수의 etcd 노드가 동의해야만 확정된다는 뜻. 예를 들어 etcd 3개 노드 중 최소 2개가 '동의'해야 쓰기가 완료됨. 이렇게 하면 1개 노드가 고장나도 데이터 무결성이 유지된다.' 그리고 '리비전'의 정의(라인 749)를 다시 쓸 때 '매번 쓰기가 일어날 때마다 1씩 증가하는 일련번호로, 스냅샷 시점의 상태를 지칭한다'로 명확히 표현.
- **🔴 HIGH** `맥락점프` _Part 3 문제 1~30 (라인 1196~2470)_
  - 문제: Part 1,2의 예제와 Part 3의 객관식 문제 사이에 명시적 연결이 없음. 예를 들어 PDB 문제(#1, 라인 1199)는 Part 1.1의 내용을 그대로 따지는데, 문제 페이지에서는 '§1.1 참조' 같은 링크가 없어 학생이 관련 개념을 다시 찾아 읽어야 함. 또한 Part 3 자체도 CRD, Admission, etcd 같은 Part 1 주제와 HPA, LimitRange, RBAC 같은 KCNA 기초 개념이 섞여 있는데, 어떤 질문이 이전에 배운 1.1~1.4를 재검증하는 것인지 명확하지 않음.
  - 보강: Part 3 시작 전(라인 1188 근처)에 다음 문장 추가: '다음 문제들은 Part 1, 2의 개념을 검증하며, 관련 섹션이 있으면 (§1.X), (§2.X) 형태로 표기함.' 그 후 문제 헤더(예: '### 문제 1.')에 정답 직후 한 줄로 '(§1.1 Pod Disruption Budget 참조)'를 추가해 역참조 구조 확립.
- **🔴 HIGH** `실습재현불가` _Part 1.1 검증 명령 (라인 125~206)_
  - 문제: PDB 동작 검증(라인 181-190)에서 '`kubectl drain <node-name>` 실행 후 기대 출력'으로 'Cannot evict pod as it would violate the pod\'s disruption budget' 메시지를 예시했으나, 이는 실제 상황에서 언제 나타나는지(3개 replica 중 몇 개가 running일 때 drain이 시작되어야 하는지) 불명확함. 학생이 실제로 이 명령을 수행했을 때 다른 결과(즉시 퇴거됨, 또는 다른 에러)가 나면 혼란스러울 수 있음.
  - 보강: 'PDB가 실제로 동작하는지 테스트' 섹션(라인 181) 전에 준비 단계를 명시: '먼저 `kubectl create deployment web --image=nginx --replicas=3`으로 3개 Pod를 생성하고, `kubectl apply -f web-pdb.yaml` (maxUnavailable: 1)을 적용한 후, dev-worker1 노드에 3개 Pod를 모두 집중시키기 위해 `kubectl cordon dev-worker2`를 실행하라. 그 상태에서 `kubectl drain dev-worker1 --ignore-daemonsets`을 실행하면 위의 메시지가 나타난다.' 이 시퀀스를 명시하고 실제 스크린샷을 붙일 것.
- **🟡 MED** `스토리라인누락` _Part 2.1 Pod with Labels and Annotations (라인 818-987)_
  - 문제: Labels와 Annotations의 개념은 설명되었으나, '언제 Labels를 써야 하고 언제 Annotations를 쓰는가'에 대한 실무 판단 기준이 불명확함. 예를 들어 'owner: team-alpha'는 Annotation인데, 이것을 Label로 하면 안 되는 이유? 리소스 효율성? 검색 성능? 초학자는 단순히 '틀린 필드에 넣으면 안 된다'만 배우고 원리를 모름.
  - 보강: 배경 섹션(라인 822)을 확장해: 'Labels는 API 서버에서 인덱싱되어 빠른 필터링이 가능하므로, Service selector, Pod scheduling affinity, RBAC 정책 등 Kubernetes의 의사결정에 사용된다. 반면 Annotations는 인덱싱되지 않으므로 검색 불가하지만, 임의 크기의 구조화 데이터(JSON, URL)를 저장할 수 있어 도구나 인간을 위한 부가 정보(Prometheus 스크래핑 설정, 소유자 이메일, 배포 타임스탬프)에 적합하다. 따라서 keys가 많거나 values가 크면 Annotations를 사용해야 한다.' 이후 트러블슈팅에 '레이블과 어노테이션을 혼동한 경우'를 추가 예제로 포함.
- **🟡 MED** `이해난이도` _Part 1.2 CRD (라인 228~499)_
  - 문제: CRD의 정의(라인 239)와 실제 동작(라인 244~250)은 설명되었으나, '왜 API 서버가 CRD를 받으면 새로운 REST 엔드포인트를 생성할 수 있는가?'라는 핵심 의문이 다루어지지 않음. 초학자는 'API 서버가 자동으로 해준다'는 수동적 이해만 하고, CRD가 Kubernetes의 어떤 설계 철학(declarative, extensibility)을 체현하는지 놓침.
  - 보강: §1.2 CRD란 무엇인가(라인 238) 뒤에 패러그래프 추가: 'Kubernetes의 핵심 철학은 "모든 상태를 선언적 리소스(YAML)로 표현하고, API 서버를 통해서만 접근한다"이다. 내장 Pod, Service 같은 리소스도 이 원칙을 따르며, CRD는 이 시스템을 확장하여 사용자가 자신의 도메인 개념(Database, Certificate, 게임 캐릭터 등)을 같은 방식으로 정의할 수 있게 한다. API 서버는 CRD가 등록되면 자동으로 `/apis/example.com/v1/databases`라는 REST 엔드포인트를 생성하는데, 이는 CRD 정의의 `group`, `version`, `names.plural` 필드로부터 구성된다.' 이를 통해 CRD가 단순한 '기술'이 아니라 Kubernetes의 설계 패러다임을 구현한 도구임을 이해하도록 함.
- **🟡 MED** `정확성오류` _Part 1.3 Admission Controllers (라인 609~623)_
  - 문제: '기본적으로 활성화되는 Admission Controller 목록은 Kubernetes 버전에 따라 다르다'고 했는데(라인 623), 정확한 기본 활성화 플러그인을 명시하지 않음. 예를 들어 kubeadm으로 설치한 Kubernetes 1.29에서는 정확히 어떤 admission plugins이 기본 활성화되는가? 학생이 검증 명령을 실행해도 다른 결과를 얻을 수 있음.
  - 보강: 라인 623 다음에 다음 내용 추가: '일반적으로 kubeadm 설치된 Kubernetes 1.26+에서는 기본 활성화 플러그인: NamespaceLifecycle, LimitRanger, ServiceAccount, DefaultStorageClass, DefaultTolerationSeconds, ValidatingAdmissionWebhook, MutatingAdmissionWebhook, PersistentVolumeClaimProtection, Priority, StorageObjectInUseProtection, RuntimeClass, CertificateApproval, CertificateCleaning, CertificateSigning, CertificateValidation. 또는 실습 클러스터에서 실제로 확인하려면 `kubectl -n kube-system describe pod kube-apiserver-<master-node>` 후 spec.containers[0].command 에서 `--enable-admission-plugins` 플래그의 값을 확인하라.' 그리고 현재 라인 613~614의 검증 명령 출력 예시를 실제 스크린샷으로 교체.
- **🟡 MED** `이해난이도` _Part 1.1 minAvailable vs maxUnavailable (라인 99~108)_
  - 문제: 표에서 'allowedDisruptions = healthy - minAvailable' 같은 계산식이 주어졌으나, 실제로 '2개 Pod running 상태에서 drain 시작 → 1개 퇴거 가능한가?'라는 시나리오에 이 공식을 어떻게 적용하는지 구체 예시가 없음. 초학자는 공식만 외우고 논리적 이해가 부족함.
  - 보강: 표 아래에 예시 추가(라인 108 이후): '예시: replicas=3, minAvailable=2, 현재 healthy=3인 상태에서 drain 시작. 첫 번째 Pod 퇴거 검증: allowedDisruptions = 3 - 2 = 1 (1개 퇴거 가능) → 첫 번째 Pod 퇴거 시작. 퇴거 후 healthy=2, 다른 노드에서 재시작 대기 중. 두 번째 Pod 퇴거 검증: allowedDisruptions = 2 - 2 = 0 (퇴거 불가) → drain 대기, 재시도. 새 Pod가 running 되어 healthy=3으로 복구 → 다시 allowedDisruptions=1 → 두 번째 Pod 퇴거 가능.' 이 흐름을 mermaid 타이밍 다이어그램과 함께 시각화하면 더 명확함.
- **🟡 MED** `맥락점프` _Part 3 문제 8~10 (kube-proxy, Taint, HPA)_
  - 문제: 이들 문제는 Part 1,2에서 다루어지지 않은 내용(kube-proxy 모드 비교, Taint effect 종류, HPA와 VPA)을 객관식으로만 출제함. 학생은 Part 1,2를 읽은 후 Part 3을 풀려면 갑자기 새로운 주제(kube-proxy iptables/IPVS, tolerationSeconds, VPA)가 나타나 당황할 수 있음.
  - 보강: Part 3 시작 전에 각주: '다음 Part 3의 문제 중 일부(#8, #9, #10, ...)는 Part 1,2에서 다루지 않은 KCNA 기초 개념을 검증합니다. 이 문제들은 별도로 정리한 KCNA 01-concepts.md의 관련 섹션을 참조하십시오.' 또는 각 문제마다 관련 섹션을 명시(예: '(KCNA 01-concepts.md §2.3 Service and kube-proxy 참조)').
- **⚪ LOW** `구조` _Part 2.2 Deployment (라인 1004~1017)_
  - 문제: rollout 과정을 ASCII 텍스트 박스로 그렸는데, 4가지 시점의 Pod 개수 변화(Old RS: 3→3→2→1→0, New RS: 0→1→2→3)는 명확하지만 '언제 새 Pod가 running되는가' 같은 시간 축 정보가 불명확함. 실제로는 새 Pod가 Pending(이미지 pull, 스케줄링) → Running 대기, 그리고 이 시간 동안 old Pod는 아직 drain 중일 수 있다는 동시성을 보여주지 못함.
  - 보강: 현재 ASCII 다이어그램을 mermaid sequenceDiagram으로 재작성. 'kubectl set image'부터 'rollout 완료'까지 시간 축을 포함한 시퀀스 다이어그램. 예: Deployment Controller → ReplicaSet create → kubelet → image pull → Pod running → old Pod grace termination 등의 순서와 병렬성을 표시.

### daily/day01.md · 가독성 4/5 · 스토리 3/5 · 합격✅

- **🔴 HIGH** `용어비약` _1.2.1 Kubernetes 이전 도구(Docker Swarm/Apache Mesos/Cloud Foundry) 비교 섹션_
  - 문제: 각 도구가 처음 등장하는데 1~2줄만 설명. 학생이 이들을 모르면 "제한적", "기능", "성능" 부족의 구체적 의미 불명확. Marathon, 선언적 오브젝트 모델(PSA?) 용어 풀이 없음.
  - 보강: 각 도구별 1문단: 무엇인가(등장 시기) + 주요 한계(왜 안 됐나). 예: "Docker Swarm은 Docker Inc 주도로 Docker 이미지만 지원해 표준이 아님", "Mesos는 1990년대 범용 스케줄러로 컨테이너 전용이 아니라 학습곡선 높음", "Marathon이란 Mesos 위의 프레임워크로... 별도 학습 필요"
- **🔴 HIGH** `스토리라인누락` _1.3 "왜 Kubernetes가 필요한가" → 1.4 "선언적 vs 명령적" 전환_
  - 문제: 1.3에서 수백개 컨테이너 복잡성 문제 제시 후, 1.4에서 갑자기 "선언적 철학"으로 점프. 그 사이 "이 문제를 선언적 방식이 어떻게 해결하나"라는 연결고리 부재.
  - 보강: 1.4 첫 단락: "1.3의 복잡한 운영 문제(Pod 재시작·노드 장애·스케일링)를 자동화하려면 사용자가 '원하는 상태(Desired State)'만 기술하고 시스템이 '현재 상태(Current State)'를 자동 맞추는 선언적 방식이 필수다." 라고 문제-해결 연결"
- **🔴 HIGH** `실습재현불가` _"tart-infra 실습" 섹션 (891줄 이후) 전체_
  - 문제: 모든 실습 명령이 "~/sideproejct/IaC_apple_sillicon/kubeconfig/platform.yaml" 경로·"platform" 클러스터 존재 가정. 이 저장소 없는 학생은 재현 불가능. 실습이 "확인할 것" 수준(화면 보이기)이라 "직접 해보기" 학습 효과 낮음.
  - 보강: 실습을 두 부분 분리: (1) "이론 검증(모든 K8s 클러스터 공통)" — "kube-system ns의 tier=control-plane 라벨 Pod 조회" (미니큐브·실제 클러스터 모두 가능), (2) "[심화] tart 특화 실습(선택)" — kubeadm 구성·클러스터 간 비교, 앞에 "(선택사항: tart 실습 환경 사용자만)" 명시. 둘 다 "실제 명령 실행 + 예상 결과" 형식.
- **🔴 HIGH** `정확성오류` _3.2 etcd "장애 허용" 설명 (417줄): "짝수(4노드)면: 2노드 장애 시 과반수(3) 불가 → 3노드와 동일한 장애 허용"_
  - 문제: "동일한 장애 허용"은 틀린 결론. 4노드는 2노드 장애 → 2 남음 → 과반수(3) 불가이므로 실제로는 1노드 장애만 허용. 표현이 오도함.
  - 보강: "짝수 4노드는 비효율적: 2노드 장애 시 남은 2개로 과반수 3 불가(1노드만 허용). 반면 홀수 3노드는 1노드 장애만 허용하면서 VM 1대 절약. N노드 → 과반수 N/2+1 → 장애허용 (N-과반수) 정리표 추가"
- **🟡 MED** `이해난이도` _2.2 "Control Plane vs Worker Node" 테이블의 "아키텍처 계층" 항목_
  - 문제: "제어부(Control Path) / 데이터부(Data Path)" 용어가 네트워킹 관념인데 K8s 맥락에서 정의 없음. 학부생이 "Path"의 의미를 모를 수 있음.
  - 보강: "아키텍처 계층" → "역할 계층" 으로 표기 변경. 설명: "제어 계층(Decision-making) — 클러스터 상태 관리" / "실행 계층(Execution) — 실제 워크로드 실행". 표 위에 1줄: "K8s는 제어부(누가)와 실행부(어디서)를 분리해 독립적 확장을 가능케 한다."
- **🟡 MED** `스토리라인누락` _3.3 "kube-scheduler" 끝 → 3.4 "kube-controller-manager" 시작_
  - 문제: Scheduler는 "Pod를 배치만 하고 실행하지 않는다"(nodeName 설정)로 끝남. 그러면 누가 "replicas=3 유지", "Pod 죽음→재생성", "노드 장애 대응"을 하는가? 의문이 바로 다음 섹션으로 자연스레 이어져야 하는데 섹션 헤더만 있고 "직전 Scheduler의 한계"를 설명하지 않음.
  - 보강: 3.4 첫 문단: "Scheduler는 단발로 Pod를 배치하는 것만 담당하고, 배치 후 상태 변화(Pod 죽음, 노드 다운, 설정 변경)를 감시하거나 자동 복구하지 않는다. 예를 들어 replicas=3 Deployment에서 Pod 1개가 죽어도 Scheduler는 아무것도 안 한다. 이를 보완하며 '원하는 상태=현재 상태'를 무한 반복하는 것이 Controller Manager이다.", 이후 Reconciliation Loop 다이어그램.
- **🟡 MED** `맥락점프` _3.1 kube-apiserver 요청 처리 흐름 (232~267줄) → 3.2 etcd (374줄)_
  - 문제: API Server가 "etcd에 직접 접근하는 유일한 컴포넌트"라 명시된 후 etcd 섹션에서 "Raft 합의", "과반수", "Leader/Follower" 설명이 있는데, 학생 입장에서 "왜 etcd만 특별한가? 다른 컴포넌트는 왜 접근 안 하나?" 의문이 섹션 사이에서 던져짐.
  - 보강: API Server와 etcd 사이 브릿지 추가 (한 문단): "API Server가 etcd 유일 클라이언트인 이유는 상태 일관성을 보장하기 위함이다. 만약 scheduler나 kubelet이 직접 etcd를 쓴다면 동시 쓰기로 데이터 충돌이 발생할 수 있다. API Server는 인증/인가 검증을 거쳐 etcd 쓰기를 직렬화하므로 보안·일관성을 동시에 확보한다.", 그 후 etcd 섹션.
- **⚪ LOW** `실습재현불가` _"실습 환경 설정" (894줄): export KUBECONFIG 명령_
  - 문제: kubeconfig 파일 존재를 가정. 없거나 경로가 다르면 다음 kubectl 명령들이 모두 "connection refused" 실패. "선행 조건" 명시 부재.
  - 보강: 실습 섹션 상단에 "선행 조건: K8s 클러스터(버전 v1.25+)가 운영 중이고, kubectl이 설치되어 있으며, 클러스터 접근 kubeconfig가 있어야 한다. 없다면 [클러스터 구축](../README.md)을 먼저 보거나 미니큐브(minikube start) 사용" 명시.

### daily/day02.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `용어비약` _1.0 등장배경(23줄), 1.1 다이어그램(40줄)_
  - 문제: Watch 메커니즘이 갑자기 등장하는데, Watch가 무엇(polling vs event-driven), 어떻게 작동(gRPC streaming?)하는지 설명 전무. 학생이 내부 작동 원리를 상상할 수 없음.
  - 보강: Watch 개념 1~2문단 추가: 'Watch란 API Server와 클라이언트(Scheduler, kubelet) 간의 지속적 구독-알림 메커니즘으로, etcd의 변경 이벤트를 gRPC streaming으로 실시간 전달한다. 이를 통해 모든 컴포넌트가 API Server를 허브로 느슨한 결합을 유지한다.' + 간단한 mermaid 시퀀스 다이어그램(Watch 이벤트 발생-전달 순서)
- **🔴 HIGH** `용어비약` _1.2 단계 10-13(54~59줄), 문제 17(523~537줄)_
  - 문제: CRI(Container Runtime Interface)·containerd·runc가 비순서적으로 등장하면서 관계가 불명확. 초면 학생은 이들이 무엇인지, 어떤 계층인지 알 수 없음.
  - 보강: 1.2 전에 'CRI·CNI·CSI 인터페이스' 개요 1문단 추가: 'K8s는 벤더 종속을 피하기 위해 플러그인 인터페이스 표준화: CRI는 kubelet-런타임 통신(containerd, CRI-O), CNI는 네트워크 플러그인(Cilium, Calico), CSI는 스토리지(EBS, Longhorn).' 각각 1~2문장.
- **🔴 HIGH** `스토리라인누락` _2.1 Static Pod 개념(104~107줄)_
  - 문제: Static Pod이 '왜' 필요한지 설명 부재. Control Plane 부트스트랩 문제(etcd·API Server·Scheduler가 없으면 kubelet은 누가 Pod를 배포하는가?)를 설명하지 않아, 학생이 설계 의도를 모름.
  - 보강: 2.1 위에 '등장배경' 절 추가(3~4문단): '클러스터 부팅 시 API Server 자신도 Pod로 실행되어야 하는데, API Server가 없으면 Scheduler는 동작할 수 없다. 따라서 Control Plane 컴포넌트(API Server, etcd, Scheduler, Controller Manager)는 kubelet이 직접 /etc/kubernetes/manifests/ 디렉토리를 감시하여 YAML 파일만으로 관리한다. 이를 Static Pod라 한다. 이 설계 덕분에 kubeadm init이 부트스트랩을 완료할 수 있다.'
- **🔴 HIGH** `용어비약` _전체(1줄), 직접 등장 1.0(23줄), 1.1(38줄)_
  - 문제: etcd가 '분산 key-value 저장소'라고 암시만 하고, 정확히 무엇인지 설명 없음. 학생이 'etcd는 Kubernetes의 뇌' 같은 문구만 알고 '정말 뭐 하는 건가?'라 물을 때 답이 없음.
  - 보강: 1.0 맨 앞에 'etcd' 정의 1문단 추가: 'etcd는 CNCF 분산 key-value 데이터베이스로, K8s의 모든 오브젝트(Pod, Service, ConfigMap 등)의 상태(desired state)를 저장한다. 고가용성을 위해 Raft 합의 알고리즘으로 다중 노드 간 데이터 일관성을 보장한다.'
- **🔴 HIGH** `맥락점프` _2.1(119줄), 문제 4 풀이(296줄)_
  - 문제: '미러 Pod'는 언급되지만 정확히 무엇인지 설명 부재. Static Pod YAML을 kubelet이 생성하면, API Server에 어떻게 등록되나? 학생이 kubectl edit으로 수정 시도 후 실패하는 이유를 모를 수 있음.
  - 보강: 2.1 Static Pod 특징 절(145~155줄 표 아래)에 1~2문단 추가: '미러 Pod란 Static Pod의 읽기 전용 반영으로, kubelet이 YAML을 감지하면 자동으로 API Server에 같은 이름의 Pod를 등록한다(이름은 <pod-name>-<node-name>). 이를 통해 kubectl get pods로 Static Pod를 조회할 수 있지만, kubectl edit/delete로 직접 수정할 수 없다. Static Pod의 상태 변경은 /etc/kubernetes/manifests/ YAML 파일 자체를 수정해야 한다.'
- **🔴 HIGH** `용어비약` _1.2(82~86줄), 문제 19(559~570줄) 반대편_
  - 문제: 필터링 단계에서 'Taint, nodeSelector, NodeAffinity' 등이 나오는데, 학생이 처음 봐서 무엇인지 모름. PVC도 갑자기 등장(문제 19).
  - 보강: 1.2의 필터링 설명(83~87줄)을 다음과 같이 보강: '필터링 기준에는 다음이 포함된다: (1) 리소스 부족(CPU/메모리), (2) Pod의 nodeSelector 라벨 불일치, (3) 노드의 Taint와 Pod의 toleration 불일치, (4) 노드 affinity 정책 불일치, (5) 영구볼륨청구(PVC) 미바인딩 등. 이 세부는 CKA 스케줄링에서 다룬다.' — 단, 현 day02는 개념 수준이므로 1~2문장으로 가볍게.
- **🔴 HIGH** `실습재현불가` _tart-infra 실습 섹션(660~760줄), 특히 '실측' 블록_
  - 문제: 'dev 실측'이라고 명시했지만 실제 터미널 스크린샷이 없고 마크다운 텍스트 블록(```text)만 있음. CLAUDE.md §4①에 따르면 모든 명령 출력은 PNG 캡처여야 하는데, 이 파일은 위반. 학생이 '이게 정말 나왔나?'라 의심할 수 있음.
  - 보강: 실습 1~3의 모든 '# dev 실측' 블록을 실제 터미널 스크린샷 PNG로 대체. 예: 696줄의 kubectl describe pod output → 실제 터미널 캡처 이미지로 변경. 캡션은 '[실제 터미널 캡처]' 표기.
- **🔴 HIGH** `이해난이도` _1.0(74~77줄), 1.2(93줄), 문제 7(352~356줄)_
  - 문제: Admission Control(어드미션 컨트롤)이 '정책에 부합하는가'라고만 하는데, 실체가 무엇인지 학생이 감을 잡기 어려움. Pod YAML의 어느 필드를 검증? 기본값 주입? 거부?
  - 보강: 1.2 '단계 1-3' 끝에 1문단 추가: 'Admission Control은 API Server의 마지막 검증 단계로, Pod spec의 이미지 없음·SecurityContext 부재·ResourceQuota 초과 등을 확인하고, 필요시 기본값(예: imagePullPolicy=IfNotPresent)을 주입하거나 요청을 거부한다. 이는 ValidatingAdmissionWebhook(검증)과 MutatingAdmissionWebhook(변환)으로 확장 가능하다.'
- **🔴 HIGH** `스토리라인누락` _문제 9(383~395줄), 다른 섹션과의 관계 불명_
  - 문제: Reconciliation Loop가 설명되지만, 이게 Pod 생성 흐름의 어느 단계인지, kubelet의 감시 루프와 어떤 관계인지, 왜 '지속적'으로 일하는지의 이야기가 없음.
  - 보강: Pod 생성 과정 1.0에 'Control Loop 철학' 1문단 추가: 'K8s 전체는 Watch-Reconcile 루프로 설계돼 있다. (1) Watch: 모든 컴포넌트가 API Server의 변경을 구독, (2) 변경 감지 시 자기 책임에 맞춰 동작(Scheduler는 바인딩, kubelet은 컨테이너 생성, Controller Manager는 원하는 상태 복구), (3) 완료 후 상태를 다시 API Server에 보고. 이 반복이 Pod 생성·업데이트·삭제의 기초다.'
- **🟡 MED** `정확성오류` _2.1 미러 Pod 설명 부분, 문제 4(298줄)_
  - 문제: Static Pod 삭제 시 'kubectl delete로 삭제해도 kubelet이 즉시 재생성'이라고 하지만, 실제로는 kubectl delete가 미러 Pod만 삭제할 뿐 YAML 파일이 남아 있으면 kubelet이 재생성한다는 게 정확한 설명. 현재는 약간 왜곡.
  - 보강: 트러블슈팅(619줄)의 설명을 정확히: 'kubectl delete pod <name>은 API Server의 미러 Pod를 삭제할 뿐 /etc/kubernetes/manifests/ YAML은 남아 있다. 따라서 kubelet은 다시 YAML을 감지하고 Pod를 재생성한다. Static Pod를 완전히 제거하려면 YAML 파일 자체를 rm으로 삭제해야 한다.' 현재는 이 과정이 암묵적.
- **🟡 MED** `용어비약` _문제 3(268~280줄) Raft 설명_
  - 문제: 합의 알고리즘 개념을 학생이 모르므로, 'Raft'라는 이름만 암기하게 될 가능성. 왜 'quorum(과반수)'이 필요한지의 근본 아이디어가 없음.
  - 보강: 문제 3 풀이를 다음과 같이 확장: 'etcd는 Raft 합의 알고리즘을 사용한다. Raft의 핵심 아이디어: 분산 시스템에서 여러 노드 간 데이터 일관성을 보장하려면, 변경마다 '과반수(quorum) 동의'를 받아야 한다. 예를 들어 3개 노드에서 과반수는 2개이므로, 1개 노드 장애 시에도 나머지 2개가 합의하면 데이터 안전이 보장된다. 따라서 HA 환경은 홀수(3, 5, 7개)로 운영한다.'
- **🟡 MED** `맥락점프` _3절 포트 번호(158~182줄), 특히 NodePort 30000-32767_
  - 문제: NodePort 범위가 갑자기 등장하는데, 아직 Service 개념이 설명되지 않았음. 학생이 '노드 포트가 뭐 하는 포트?'라 물으면 대답 불가.
  - 보강: 3절 앞에 1문단 추가: 'K8s 네트워크는 계층적이다: (1) Pod IP(각 Pod가 고유), (2) ClusterIP(Service가 내부 virtual IP 제공), (3) NodePort(외부에서 노드의 특정 포트로 Service 접근). 이 day02는 포트 번호 암기를 목표로, 자세한 Service 개념은 day03에서 다룬다.'
- **🟡 MED** `맥락점프` _문제 16(505~518줄)_
  - 문제: dockershim 제거(K8s v1.24)는 중요하지만, Pod 생성·Static Pod·포트와는 무관한 주제. 주제 응집성 약화. 이 문제가 왜 day02에 있는가?
  - 보강: 이 문제를 day02에서 제거하거나, 도입 말미에 각주 추가: '[CRI 심화] K8s v1.24부터 dockershim이 제거되었으므로, Docker로 빌드한 이미지도 containerd·CRI-O 같은 CRI 호환 런타임에서만 실행된다. 이는 Pod 생성 흐름(단계 9: CRI)과 연관.'
- **🟡 MED** `이해난이도` _2.1 및 문제 5(307~319줄)_
  - 문제: 'kubelet은 systemd 서비스'라고 하는데, 그럼 Control Plane 다른 컴포넌트(API Server·etcd·Scheduler)는 왜 systemd가 아니라 Static Pod인가? 순환적 설명이 되어 학생이 깊이 이해하기 어려움.
  - 보강: 문제 5 풀이를 다음과 같이 확장: 'kubelet은 K8s 클러스터를 부팅하는 초기 에이전트이므로 systemd 서비스로 실행된다. 반면 API Server·etcd·Scheduler·Controller Manager는 클러스터 설정(configuration) 오브젝트이므로 kubeadm이 Static Pod YAML으로 배포한다. 이 설계는 Control Plane 자체를 K8s 원칙(IaC, 선언적 관리)으로 관리하게 한다.'
- **⚪ LOW** `구조` _전체 구성, 1절과 2절 사이_
  - 문제: Pod 생성 흐름(1절)과 Static Pod(2절)·포트(3절)가 독립적으로 보이지만, 실제로는 모두 'API Server 중심 Hub-and-Spoke' 같은 통합 그림으로 봐야 함. 현 구조는 주제별이라 학생이 '전체 K8s 아키텍처'의 큰 그림을 못 잡을 수 있음.
  - 보강: 1절 끝에 'K8s 아키텍처 종합' 다이어그램(mermaid 흑백) 추가: Pod 생성 흐름 위에 Static Pod(Control Plane 노드), kube-proxy, etcd 등의 위치를 명시해 '모든 것이 API Server(6443)를 중심으로 연결'임을 시각화. 포트 번호도 다이어그램에 표기.

### daily/day03.md · 가독성 4/5 · 스토리 4/5 · 합격✅

- **🔴 HIGH** `용어비약` _§4.2 Service 설명 시작_
  - 문제: 'Selector'와 'Label'의 관계가 첫 등장할 때 풀이 없음. Service의 selector.matchLabels가 Pod의 metadata.labels와 정확히 일치해야 한다는 핵심 조건이 명확하지 않음.
  - 보강: §4.1 앞에 한 문단 추가: 'Pod는 metadata.labels로 라벨을 붙이고, Service는 selector 필드로 라벨 조건을 지정하여 조건을 만족하는 Pod를 찾는다. 이 일치는 정확해야 하며(한 글자도 다르면 안 됨), Pod 라벨이 추가/제거되면 Service의 Endpoints도 즉시 갱신된다.'
- **🔴 HIGH** `맥락점프` _§3.2 Deployment YAML → §3.3 배포 전략_
  - 문제: maxSurge: 1, maxUnavailable: 0이 왜 이 값으로 설정되었는지 설명 부족. RollingUpdate가 Pod 개수를 항상 유지하면서 점진적으로 교체하는 원리를 먼저 이해해야 이 설정이 의미를 가짐.
  - 보강: §3.2와 §3.3 사이에 '3.2.5 RollingUpdate 메커니즘' 섹션 추가: maxSurge는 replicas 초과 허용 개수(maxSurge=1이면 최대 4개), maxUnavailable은 서비스 불가능한 최대 Pod 수(0이면 다운타임 없음). 이 두 값으로 무중단 업데이트 방식을 제어한다고 설명.
- **🟡 MED** `스토리라인누락` _§6 StatefulSet 개념 도입_
  - 문제: StatefulSet이 왜 필요한지 배경 설명 약함. 'Deployment로는 안 되나?' 질문에 대답 불충분. Stateful(상태 유지) 의미가 구체적이지 않음.
  - 보강: §6.0 '등장 배경: Stateful vs Stateless' 섹션 신규 추가. Deployment의 Pod는 동일·교체 가능(웹 서버 예), 그러나 DB는 pod-0, pod-1 이름 고정·각 Pod 고유 데이터 필요 설명. MySQL 클러스터에서 mysql-1이 mysql-abc로 바뀌면 replication 설정 깨짐을 구체 예시로 제시.
- **🟡 MED** `이해난이도` _§4.3 Service DNS 체계 (FQDN)_
  - 문제: '<서비스명>.<네임스페이스>.svc.cluster.local' 형식이 첫 봤을 때 학생이 '왜 이렇게 길어? svc.cluster.local이 뭐야?' 할 수 있음. CoreDNS 도메인 체계 맥락 부족.
  - 보강: 표 전에 한 문단 추가: '이 DNS는 클러스터 내부 CoreDNS가 관리하는 특수 도메인이며, 클러스터 외부에는 알려지지 않는다. 같은 네임스페이스에서는 nginx-web만, 다른 네임스페이스에서는 nginx-web.demo로 접근 가능하며, 명시적 FQDN은 언제든 사용 가능하다.'
- **🟡 MED** `실습재현불가` _§2.4 멀티컨테이너 Pod 패턴 (Sidecar, Ambassador, Adapter)_
  - 문제: 패턴의 이론 설명은 있으나, 각 패턴의 실제 작동 YAML 예제가 없음. '어, 그래서 어떻게 구현하는데?' 라는 의문에 답 부족.
  - 보강: Sidecar/Ambassador/Adapter 각 패턴마다 최소 1개의 완전한 작동 YAML 예제 추가. 예: Sidecar는 app 컨테이너 + log-agent 컨테이너가 공유 volume으로 로그 수집하는 Pod 매니페스트.
- **⚪ LOW** `정확성오류` _§2.4 포트 바인드 설명 및 §5.2 DaemonSet의 tolerations 필드_
  - 문제: '각 컨테이너는 서로 다른 포트를 사용해야 한다'는 정확하나 명확하지 않음. tolerations가 YAML에 갑자기 등장하는데 설명 없음.
  - 보강: §2.4에서 '같은 Network Namespace 내 동일 포트 바인드 불가'로 더 명확히 수정. §5.2에서 tolerations 위에 한 문단: 'DaemonSet은 기본적으로 controlplane 노드(taint 있음)에는 스케줄되지 않으나, tolerations로 taint를 무시하고 배치할 수 있다. Fluentd 같은 시스템 에이전트는 모든 노드에서 실행되어야 하므로 이 설정이 필요하다.'
- **⚪ LOW** `구조` _§7 CronJob의 concurrencyPolicy 정의 앞_
  - 문제: 여러 Job 인스턴스가 겹칠 수 있는 상황(이전 Job 실행 중 새 Job 시작)에 대한 선행 설명 부족.
  - 보강: concurrencyPolicy 표 위에 한 문단: '주기적으로 Job을 생성하다 보면 이전 Job이 아직 실행 중인데 새 Job이 시작되는 overlap이 발생할 수 있다. (예: 매 5분마다 백업인데 한 번이 8분 걸린다면) concurrencyPolicy는 이 상황을 어떻게 처리할지 결정한다.'

### daily/day04.md · 가독성 4/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `스토리라인누락` _Section 1(ConfigMap) 개념 직후_
  - 문제: ConfigMap이 환경변수와 파일 형태 둘 다로 마운트될 수 있는 이유가 없다. 학생은 '왜 두 가지 방식이 있나? 어떤 상황에 쓰나?'를 물을 때 답할 수 없음. Docker run -e와의 비교도 없음.
  - 보강: ConfigMap 1.1 직후에 '배경: 이전에는 컨테이너 이미지에 설정을 하드코딩하거나 docker run -e로 환경변수만 전달했다. 하지만 환경변수는 프로세스 시작 시에만 읽히므로 실행 중 설정 변경이 불가능했다. 파일 형태 ConfigMap은 nginx.conf처럼 메인 프로세스 재시작 없이 설정을 주입·갱신할 수 있어(kubelet sync) 실행 중 설정 변경을 가능하게 한다.'를 추가.
- **🔴 HIGH** `정확성오류` _Section 1.4 표(99~109줄) 'ConfigMap 변경 반영' 섹션_
  - 문제: 볼륨 마운트가 '자동 반영'된다고만 써 있으나, 실제로는 kubelet sync 주기(기본 10초~1분)에 따라 지연이 있다. 학생이 '변경 직후 즉시 반영된다'고 착각할 수 있음. 정확한 타이밍과 지연 범위를 명시하지 않음.
  - 보강: 표의 '자동 반영' 항목을 '자동 반영(약 1분 지연, kubelet의 sync-frequency 설정에 의존)'으로 수정. 그리고 1.3의 마운트 예제 아래에 '주의: 파일 변경은 kubelet이 감지할 때까지 대기할 수 있으며, 애플리케이션이 파일을 캐시 중이면 설정 재로드 로직을 명시적으로 구현해야 한다(SIGHUP 등)'을 추가.
- **🔴 HIGH** `용어비약` _Section 2.2 Secret YAML 예제(129~143줄)_
  - 문제: Base64 인코딩된 값(YWRtaW4=)이 무엇인지 학생이 모를 수 있음. 'echo -n admin | base64'를 보여도 base64 명령이 뭔지 모르면 이해 불가. stringData vs data의 차이도 명시 없음.
  - 보강: 2.2 직전에 '배경: Secret은 Base64 인코딩을 사용한다. Base64는 텍스트를 숫자·문자로 변환하는 방식으로, 누구나 디코딩할 수 있다(암호화 아님). data 필드에는 Base64로 인코딩된 값을 직접 쓰거나, stringData 필드에 평문을 쓰면 저장 시 자동 인코딩된다.'를 추가. 그리고 예제 아래에 '검증: echo YWRtaW4= | base64 -d는 admin을 출력한다'를 추가해 학생이 실제로 해볼 수 있게.
- **🔴 HIGH** `맥락점프` _Section 3(Namespace) ~ Section 4(Label/Selector) 전환_
  - 문제: Section 3에서 Namespace의 논리 분리 개념을 설명하고, 갑자기 Section 4에서 Label/Selector가 나온다. 둘의 관계(Namespace는 네임스페이스 단위 격리, Label은 같은 NS 내 오브젝트 그룹화)가 명시되지 않았다. 학생은 '왜 Namespace 다음에 Label이 나오는가?' 혼란.
  - 보강: Section 4 직전에 '배경: Namespace는 물리 클러스터를 여러 가상 클러스터로 나누지만, 같은 NS 내에서는 모든 Pod/Service가 보인다. 그러나 프로덕션 환경에서는 같은 NS 내에 서로 다른 팀의 워크로드, 다양한 환경(dev/prod), 버전(v1/v2) 등이 공존한다. 이들을 케이스별로 선택하고 조작하려면 추가 메타데이터가 필요한데, 그것이 Label이다. Label을 통해 Deployment, Service, NetworkPolicy가 대상을 유연하게 선택할 수 있다.'를 추가.
- **🔴 HIGH** `용어비약` _Section 4.1 Label과 Annotation 비교 박스(214~230줄)_
  - 문제: Label은 '63자 제한'이라고 했으나, 학생은 '왜 63자?', '값도 63자 제한인가?' 물을 수 있음. K8s 오브젝트가 왜 이런 제약이 있는지 배경 없음. 또한 '셀렉터로 선택 불가'가 Label/Annotation 차이의 핵심인데, '왜' 그 설계를 했는지 설명 없음.
  - 보강: 4.1 직전에 '배경: Label의 크기 제한(키 최대 63자, 값 최대 63자)은 Selector 연산 시 성능을 보장하기 위한 제약이다(너무 길면 필터링 느림). Annotation은 메타데이터(빌드정보, 변경 담당자 등)를 저장하되 시스템에서 필터링하지 않으므로 크기 제한(256KB)이 훨씬 크다.'를 추가.
- **🔴 HIGH** `이해난이도` _Section 5(RBAC) 전체(253~337줄)_
  - 문제: RBAC이 문서 분량 대비 너무 밀집되어 있고, '누가(Subject) → Role → RoleBinding' 흐름이 다이어그램으로만 설명된다. 학생이 '실제 kubectl auth can-i 결과'를 보지 못해 추상적으로 느낄 수 있음. 또한 apiGroups: [''] vs apps/v1 등 API 그룹 개념이 없어 verbs를 이해하기 어려움.
  - 보강: 5.1 직후에 '배경: Kubernetes API 서버는 모든 요청(pod get, deployment create 등)에 대해 인증(Authentication) → 인가(Authorization) 순으로 검사한다. RBAC는 인가 메커니즘으로, 누가 무엇을 할 수 있는지를 Role(권한 정의)과 RoleBinding(권한 할당)으로 표현한다. 이전에는 모든 사용자가 동일 권한을 가지거나 수동 allow-list로 관리했는데, RBAC은 역할 기반으로 세분화한다.'를 추가. 그리고 5.3 예제 다음에 '실측 검증: kubectl auth can-i get pods -n demo --as=dev-user는 yes/no로 권한 확인 가능'을 추가해 추상성 제거.
- **🔴 HIGH** `실습재현불가` _Section 6(Ingress) 전체(340~408줄)_
  - 문제: Ingress YAML 예제는 제시되지만, '실제로 curl app.example.com을 했을 때 어떤 일이 일어나는가' 흐름이 없다. 또한 Ingress Controller 설치를 '반드시 필요하다'고만 했지, 이 클러스터(KCNA 실습)에 Ingress Controller가 설치되어 있는지, 어느 네임스페이스에 있는지 언급 없음. 학생은 따라 하려다 '왜 안 되지?'라고 실패할 가능성 높음.
  - 보강: 6.1 개념 다음에 '배경: 외부 클라이언트가 K8s 내부 Service에 접근하려면 NodePort/LoadBalancer를 썼으나, 여러 Service를 하나의 external IP로 통합하면서 호스트 기반(Host: app.com) 또는 경로 기반(/api, /web)으로 라우팅하려는 요구가 있었다. Ingress는 이 규칙을 정의하는 API이지만, 실제 라우팅을 수행하는 Ingress Controller(예: NGINX)가 별도로 필요하다.'를 추가. 그리고 6.3 예제 후에 '실습 주의: 이 클러스터에 Ingress Controller가 설치되어 있지 않으면 Ingress는 rules만 저장할 뿐 실제로는 작동하지 않는다. 설치 확인: kubectl get ingressclass; kubectl get pod -n ingress-nginx'를 추가.
- **🟡 MED** `스토리라인누락` _Section 7(PV/PVC) 개념 직후(414~442줄)_
  - 문제: PV와 PVC 개념은 설명되지만 '왜 이 둘이 나뉘는가? 그냥 Pod가 스토리지를 요청하면 되지 않나?'라는 질문에 답이 없다. 관리자 영역·사용자 영역 분리의 철학이 빠짐.
  - 보강: 7.1 PVC 정의 다음에 '배경: 초기 K8s에서는 Pod가 직접 스토리지(NFS, EBS)를 마운트했다. 하지만 Pod는 노드 간에 이주하므로, 스토리지도 유동적이어야 했다. PersistentVolume(PV)은 클러스터 관리자가 미리 프로비저닝한 물리 스토리지를 추상화하고, PersistentVolumeClaim(PVC)은 사용자(Pod)가 "10Gi, RWX 필요"처럼 요청하면 조건에 맞는 PV와 바인딩한다. 이는 책임 분리(관리자·사용자)와 스토리지 유연성을 제공한다.'를 추가.
- **🟡 MED** `맥락점프` _Section 7.3 접근 모드(491~498줄)_
  - 문제: 접근 모드의 이름만 설명되고, 각 모드가 어떤 스토리지 백엔드에서만 가능한지(예: RWX는 NFS/CephFS만 가능, EBS는 RWO만 지원) 명시되지 않음. 학생이 '왜 내 EBS는 RWX를 지원 안 하나?'라고 헷갈릴 수 있음.
  - 보강: 7.3 테이블 다음에 '주의: 접근 모드 지원은 스토리지 백엔드에 따라 다르다. 예를 들어 AWS EBS는 RWO(단일 노드)만 지원하고, NFS는 RWX(다중 노드)를 지원한다. StorageClass를 선택할 때 필요한 접근 모드를 먼저 파악해야 한다.'를 추가.
- **🟡 MED** `용어비약` _Section 7.4 회수 정책(502~518줄)_
  - 문제: 'Recycle이 deprecated'라고만 했으나, 학생은 '왜 deprecated? 뭐가 문제? Retain과 Delete 중 뭘 써야 하나?'라고 물을 수 있음. 선택 가이드가 없음.
  - 보강: 7.4 각 정책별 설명 후에 '선택 가이드: 프로덕션(중요 데이터)에서는 Retain을 써서 실수로 삭제되지 않도록 보호하고, 개발/테스트 환경에서는 Delete로 스토리지를 자동 정리한다. Recycle은 rm -rf로 데이터만 지우는데, 이것이 느리고 안전하지 않아 deprecated되었고, 대신 StorageClass의 reclaimPolicy를 사용한다.'를 추가.
- **🟡 MED** `이해난이도` _Section 8 문제 12~13(721~750줄) NetworkPolicy_
  - 문제: NetworkPolicy 내용이 일절 강의되지 않았는데, 갑자기 모의문제에만 나온다. 학생은 강의 본문을 찾으려다 혼란. Cilium CNI는 이전 Day 03에서 나왔을 것으로 추정되지만, 명시적 링크가 없음.
  - 보강: 문제 12 정답 설명을 확장해 '추가 학습: NetworkPolicy는 Pod 간 트래픽 흐름을 제어하는 Kubernetes API이다. 자세한 내용은 Day 03(네트워킹)를 참조하고, 여기서는 'NetworkPolicy 없으면 모든 트래픽 허용(기본값), NetworkPolicy가 있으면 명시된 규칙만 허용'이라는 원칙만 기억한다.'를 추가해 Day 링크 명시.
- **🟡 MED** `정확성오류` _Section 8 문제 11(703~716줄)_
  - 문제: 'Secret의 최대 크기는 1MiB'라고 정답 설명에 쓰여 있는데, 본문 어디에도 1MiB 언급이 없다. 학생이 본문만 읽으면 1MiB를 전혀 알 수 없어, 모의문제로 처음 배운다. 체계적이지 않음.
  - 보강: Section 2.1 또는 2.4(보안 주의사항) 끝에 '구현 제약: Secret의 최대 크기는 etcd 저장소 제약으로 1MiB이다. 이를 초과하면 저장 실패.'를 추가.
- **🟡 MED** `맥락점프` _Section 8 문제 14(754~767줄) restartPolicy_
  - 문제: 'restartPolicy'가 본문 어디에도 없다. 갑자기 모의문제에만 나온다. Pod 생성 예제에서도 restartPolicy를 언급하지 않았음.
  - 보강: 문제 14의 정답 설명을 확장해 '추가 학습: restartPolicy는 Pod의 컨테이너가 종료되었을 때 K8s의 동작을 정의한다. Always(재시작), OnFailure(실패 시만 재시작), Never(재시작 안 함). 일반 Pod의 기본값은 Always이며, Job은 Never 또는 OnFailure만 허용된다. 자세한 내용은 Day XX(워크로드)를 참조.'를 추가.
- **⚪ LOW** `스토리라인누락` _Section 0 등장 배경(21~23줄)_
  - 문제: 12-Factor App 원칙을 언급하지만, 학생이 12-Factor App을 몰 수 있으므로 링크나 보충 설명이 유용할 것 같음.
  - 보강: 0 끝에 '참고: 12-Factor App의 "Config" 원칙은 설정을 환경 변수로 외부화해 같은 코드가 dev/staging/prod에서 다르게 동작하도록 한다는 것. ConfigMap/Secret은 이를 Kubernetes 네이티브로 구현한 것.'를 추가하거나 링크를 명시.
- **⚪ LOW** `용어비약` _Section 6.1 Ingress 개념(342~346줄)_
  - 문제: 'HTTP/HTTPS 트래픽을 라우팅'이라고만 했지, 'Service'와의 관계(Ingress는 Service 위에서 작동)가 명시되지 않음. 학생이 'Pod에 직접 접근하나?'라고 혼동할 수 있음.
  - 보강: 6.1 개념 다음에 '관계: Ingress는 Service로의 라우팅 규칙을 정의한다. 외부 클라이언트 → Ingress Controller → Service → Pod 순서로 트래픽이 흘러간다.'를 명시.

### daily/day05.md · 가독성 4/5 · 스토리 3/5 · 미달❌

- **🔴 HIGH** `스토리라인누락` _section 1.0 (dockershim 제거), section 1.2 (컨테이너 효율성)_
  - 문제: dockershim 제거 동기가 '표준화 요구'에만 머물고, 실제 문제(Docker 독점 생태계)의 비용을 구체화하지 않음. VM vs 컨테이너 효율성도 '수 MB vs 수 GB', '초 vs 분' 표기만 있고, 실제 배포 상황에서 '100개 마이크로서비스를 10대 머신에 올릴 수 있는 이유'같은 구체 시나리오 없음
  - 보강: section 1.0에 추가: '2013년 Docker 전 시대는 모든 팀이 각자 다른 VM 추상화 API를 썼다 보니 이미지 호환성이 깨졌다. 예: AWS AMI는 Azure에서 안 돌아감. -> OCI 표준으로 한 번 빌드한 이미지를 모든 클라우드/온프레미스에서 재빌드 없이 실행'. section 1.2에 추가: '예시: 1GB 메모리 호스트에 Java 앱 10개를 배포한다면, VM은 각각 2GB(OS+RT 오버헤드)가 필요해 물리적으로 불가능하나(20GB 필요), 컨테이너는 각각 128MB(앱 바이너리)로 가능하다'
- **🔴 HIGH** `맥락점프` _section 3.1 (런타임 계층), line 141-152_
  - 문제: containerd와 runc의 2단계 구조가 제시되지만, '왜 이렇게 분리해야 하나?'의 스토리가 없음. 고수준/저수준 구분은 있으나, 책임분리 이점(containerd는 이미지·네트워크 관심, runc는 Linux 기본만 구현 -> 다양한 저수준 런타임 선택 가능, gVisor/Kata 교체 가능)이 결여됨
  - 보강: section 3.1 상단에 '런타임 계층 분리 배경' 단락 추가: 'Docker 시절에는 docker daemon이 이미지부터 실행까지 모두 담당해 교체 불가능했다. OCI는 책임을 나누기로 결정: 고수준 런타임(containerd/CRI-O)은 이미지·네트워크·저장소만 관리하고, 저수준 런타임(runc/gVisor/Kata)은 오직 Linux namespace/cgroups 조작만 한다. 덕분에 containerd를 유지하면서 저수준만 gVisor로 바꾸면 보안을 강화할 수 있다.'
- **🟡 MED** `용어비약` _line 344 (kube-proxy 언급), line 598 (eBPF 첫 등장)_
  - 문제: 'kube-proxy 없이도 서비스 로드밸런싱을 처리'(line 598-599) - kube-proxy가 뭐하는 건지 모르면 Cilium의 개선을 이해 못 함. eBPF는 처음 나타나는데 정의 없음. 독자가 'Cilium이 뭐하기에 더 좋은가?'를 풀지 못함
  - 보강: section 7.2 이후에 '부트노트: kube-proxy란' 단락 추가: 'Linux 커널의 iptables/IPVS를 조작해 Service ClusterIP를 실제 Pod IP로 변환하는 네트워크 프록시. 모든 노드의 kube-proxy가 독립적으로 iptables 규칙을 동기화하므로, Service 개수가 많으면 각 노드의 커널 메모리 부하가 커진다(scale 문제). Cilium은 eBPF(Linux 커널의 확장 가능한 가상 머신)를 쓰면 (1) 데이터 평면을 커널 공간에서 고속 처리, (2) 옵저버빌리티 향상(Hubble로 패킷 추적 가능)을 얻는다.'
- **🟡 MED** `실습재현불가` _section 9 (tart-infra 실습), line 549-597_
  - 문제: 실습 2에서 'demo 네임스페이스의 Pod 리소스 설정 확인'이라 했으나, 학부생이 demo ns를 갖지 않을 가능성 높음. 실습 1도 마찬가지로 '네임스페이스 생성 단계'가 빠짐. 실습 3 (CNI)도 cilium Pod이 Running이면 OK인지, 몇 개가 실행되어야 하는지 불명확
  - 보강: 각 실습 직전에 사전 준비 명령 추가. 예: 실습 2 직전에 '```bash
kubectl create namespace demo
kubectl run -n demo nginx --image=nginx --limits=cpu=200m,memory=256Mi --requests=cpu=100m,memory=128Mi
```' 추가하고, '위 명령 실행 후 아래를 시도하라' 표기. 실습 3도 '```bash
kubectl get pods -n kube-system -l k8s-app=cilium --no-headers | wc -l
```' 결과가 '워커 노드 수 이상이면 정상' 이라고 명시
- **🟡 MED** `정확성오류` _line 42 (cgroup namespace), line 204-206 (Dockerfile ENTRYPOINT/CMD)_
  - 문제: cgroup namespace 설명이 부정확. cgroup v2에서만 존재하고, '격리'라기보다 '프로세스가 쳇근할 수 있는 cgroup의 루트를 지정' 하는 것. 또한 Dockerfile 매핑 주의사항(둘 다 지정했을 때 동작)이 없어서 실기 함정 대비 미흡
  - 보강: line 42를 '- Cgroup namespace(v2): 프로세스가 쳇근할 수 있는 cgroup 계층의 루트 지정 (cgroup v2만)' 수정. line 206 뒤에 주의사항 추가: '주의: Dockerfile에 CMD와 ENTRYPOINT를 모두 정의하면 K8s에서 둘을 동시 지정했을 때 Dockerfile CMD는 무시되고 K8s command/args만 적용된다.'
- **🟡 MED** `이해난이도` _section 5.2 (멀티스테이지 빌드, line 208-227), section 6.1 (Digest, line 250-255)_
  - 문제: 멀티스테이지 예제에서 golang:1.21이 800MB인 이유를 학부생이 모름 (Go 런타임+SDK+표준 라이브러리의 정적 링킹). Digest 권장 사유도 '변경 가능하다'는 사실만으로 프로덕션 영향도를 직관화 못 함 (배포 일관성/보안 감사 추적성 미설명)
  - 보강: line 214 위에 부트노트: 'golang:1.21 이미지는 Go 컴파일러·표준 라이브러리·빌드 도구(gcc 호환 레이어)를 포함해 크기가 크다. 반면 alpine:3.18은 bare OS만 있어 tiny하다.' line 252 아래에 추가: 'Digest 권장 이유: (1) 무중단 배포 시 "이미지 X를 v1.2로 고정"할 필요 있으나, 태그 nginx:1.25가 보안패치로 새 바이너리로 push되면 자동 업데이트돼 일관성 깨짐. (2) 보안 감사에서 "어느 파드가 어느 정확한 바이너리를 실행했나?"를 추적할 때 태그는 과거 기록이 불명확하나 Digest는 불변 증명서 역할.'
- **🟡 MED** `용어비약` _section 4 (CRI/CNI/CSI), line 167-181_
  - 문제: 3가지 인터페이스를 나열만 했으나, '왜 K8s가 이렇게 3개를 표준화했는가?'의 맥락이 없음. 예: 'Docker 시절에는 네트워크가 docker0 브릿지 고정, 스토리지가 로컬 디스크만 가능했으나, K8s는 다양한 네트워크(Calico/Cilium/Flannel)과 스토리지(EBS/Ceph/NFS)를 선택 가능하게 하려고 인터페이스를 표준화했다' 같은 설명
  - 보강: section 4 제목 아래에 한 문단 추가: 'K8s는 Docker의 monolithic(단일 구현) 설계를 거부하고, 런타임·네트워킹·스토리지를 표준 인터페이스로 분리했다. 덕분에 사용자는 kubelet의 코드를 바꿀 필요 없이, 플러그인만 교체해 containerd->gVisor 전환, kube-proxy->Cilium 전환, local->AWS EBS 전환 가능하다. 이를 "pluggable 아키텍처"라고 부른다.'
- **⚪ LOW** `맥락점프` _section 2 (CNCF 프로젝트 상태), line 156-160_
  - 문제: 'CNCF 졸업·인큐베이팅' 상태를 정보로 제시하나, 학부생이 CNCF 프로젝트 성숙도 기준을 모르면 그 의미를 못 품 ('인큐베이팅이 위험한가?', '졸업이 더 성숙한가?' 등)
  - 보강: section 2 첫머리에 부트노트: 'CNCF 프로젝트는 성숙도별로 샌드박스(실험)->인큐베이팅(프로덕션 준비)->졸업(프로덕션 권장)으로 분류된다. 졸업 프로젝트는 CNCF 보증 하에 보안감사·지속가능성·커뮤니티 크기를 만족하므로 프로덕션 도입에 안전하다. 이 교재는 졸업 프로젝트 우선을 권장한다.'
- **⚪ LOW** `구조` _section 8->9 순서 (객관식 -> 실습)_
  - 문제: 통상적 학습 흐름은 개념->실습->문제이나, day05는 개념->문제(section 8)->실습(section 9) 순서. 학생이 문제를 풀 때 실습 경험이 없어 감(intuition)을 못 기름
  - 보강: 파일 재구성: section 7(개요)->section 2~7(개념)->section 9(실제 실습 tart-infra)->section 8(시험 대비 객관식)->section 10(정리) 순서로 재정렬. "tart-infra 실습"을 "4. 실제 실습 (tart-infra)"으로 앞당기고, "KCNA 모의 문제"를 "5. 시험 대비"로 뒤로 이동.

### daily/day06.md · 가독성 3/5 · 스토리 2/5 · 합격✅

- **🔴 HIGH** `용어비약` _전체 문서, 특히 §4.1 '사이드카프록시', §1.1 '보안감사', §4.2 'xDS API' 첫 등장 시_
  - 문제: 핵심 기술용어가 정의 없이 사용되어 사전지식 없는 학생이 이해 불가. 예: 사이드카프록시가 정확히 무엇인지, 보안감사의 구체 내용이 무엇인지 명시되지 않음.
  - 보강: 각 용어 첫 등장 시 한 문장 풀이 추가. 예: '사이드카프록시: 주애플리케이션과 동일Pod에서 실행되며 모든네트워크트래픽을가로채는프로세스' / '보안감사: CNCF가외부보안전문가에의뢰하여프로젝트코드설계를검토하는독립적프로세스'
- **🔴 HIGH** `스토리라인누락` _§2 불변인프라, §4 서비스메시, §4.3 Istio vs Linkerd 섹션_
  - 문제: 기술의 등장배경(왜생겼나), 직전기술의한계, 개선효과, 트레이드오프가부족해서학생이암기위주로배운다. 예: 서비스메시가없으면어떤통신문제가있었는지(retry/circuitbreaker를코드에구현), Istio와Linkerd가다른이유(설계철학)가불명확.
  - 보강: 각기술섹션마다'등장배경'문단추가. 예: '마이크로서비스에서애플리케이션개발자가재시도/회로차단/분산추적을직접코드에구현했던한계→서비스메시는이를인프라계층에서제공하여개발자가비즈니스로직에집중가능'. Istio(기능풍부선택)vs Linkerd(경량선택)의설계의도명시.
- **🟡 MED** `맥락점프` _§2.1→§2.2 (왜5개중불변인프라만?), §3.1→§3.2 (마이크로서비스와12-Factor의관계?), §4.1→§4.2 (Control/Data Plane으로나뉜이유?)_
  - 문제: 섹션간에흐름이급변해서학생이이전내용과의연결성을이해못함. 5대요소를정의한후왜불변인프라만깊게설명하는지, 12-FactorApp이마이크로서비스와어떤관계인지명시되지않음.
  - 보강: 각섹션도입부에이전섹션과의연결문장추가. 예: '12-FactorApp은마이크로서비스아키텍처를따를때실무에서지켜야할설계원칙이다. 이제마이크로서비스의배포·운영패턴을표준화한원칙들을학습한다.' / '왜Control Plane과Data Plane으로나뉘는가: 설정(Control)과트래픽처리(Data)를분리하면각각독립적으로확장·변경가능하다.'
- **🟡 MED** `이해난이도` _§4.2 'xDS API', §1.2 '보안감사내용', §5 'requests/limits' 첫등장_
  - 문제: 전문용어가정의없이사용되어학부초년생이처음읽을때막힘. xDS가뭔지(Envoy설정배포프로토콜), 보안감사구체내용, Pod의requests/limits의정확한의미.
  - 보강: 부록'용어집'섹션추가또는첫등장시괄호풀이. 예: 'xDS API(Envoy Discovery Service의약자로동적설정배포프로토콜)' / 'requests(최소리소스,스케줄러판단용), limits(최대리소스,초과시throttling/OOMKill)'.
- **🟡 MED** `실습재현불가` _§7 실습1·2·3 (줄528-639), 트러블슈팅섹션_
  - 문제: 실습명령만있고실제터미널출력의스크린샷이미지가없음. 따라서학생이자신의클러스터에서나온출력이정상인지판단불가. '<unknown>'이표시된다는설명만있고실제이렇게뜨는이미지증거부족.
  - 보강: 모든실습명령아래에'실제터미널스크린샷이미지'추가(CLAUDE.md§4①). 각명령후'검증기준'명시: '다음처럼나오면성공→[스크린샷]→이는Control Plane설정배포의증거'. metrics-server미설치시<unknown>표시되는스크린샷포함.
- **🟡 MED** `구조` _§0 학습목표와본문섹션매핑불일치, §6 12문제의영역태깅부족, 암기가중치불균형_
  - 문제: 학습목표6개→섹션5개불일치(12-FactorApp이어느목표에?). CNCF졸업프로젝트표가매우상세해서'표암기'비중이높으나,시험은'이해'평가. 12문제가KCNA어느영역(Architecture16%등)에속하는지태깅이없어약점진단어려움.
  - 보강: 학습목표와섹션1:1명시매핑. 각문제마다'[CloudNativeArchitecture-영역내비중]'태그추가. 12문제후'분야별정답률자진평가'체크박스추가(아키텍처몇점,CNCF몇점).
- **⚪ LOW** `정확성오류` _§4.3 Knative설명(줄302), §1.2 Grafana언급(줄535-537)_
  - 문제: 기술적오류는없으나설명이불완전. Knative의Scale-to-Zero가HPA와어떻게다른지비교설명이부족(minReplicas최소1vs완전0). Grafana가왜언급되는지(platform클러스터탑재용도)맥락이모호.
  - 보강: 각기술후'KCNA시험함정'섹션추가. 예: 'HPA vs Knative: HPA는minReplicas로최소Pod유지(비용지속), Knative는요청0시완전제거(서버리스요금제). Grafana는자주보이지만CNCF졸업프로젝트가아님.'

### daily/day07.md · 가독성 4/5 · 스토리 4/5 · 합격✅

- **🔴 HIGH** `실습재현불가` _섹션 6~7 실습 (620~717줄)_
  - 문제: 실습 명령어들(kubectl get pods/svc/servicemonitor 등)이 제시되었으나 '예상 출력'이 실제 터미널 스크린샷이 아니라 주석(# platform 실측)과 텍스트 블록으로만 제시됨. CLAUDE.md §4①에 따르면 '명령의 실행 결과는 반드시 실제 터미널 스크린샷 이미지(PNG)'여야 함
  - 보강: tart platform 클러스터에서 실제로 다음 명령들을 실행하고 터미널 스크린샷 캡처를 `images/day07-*.png`로 저장한 후 마크다운 `![](images/...)` 형식으로 삽입. 구체적으로: (1) `kubectl get pods -n monitoring` → platform 실측 조회 (2) `kubectl get svc -n monitoring | grep grafana` → NodePort 확인 (3) `kubectl get servicemonitor -n monitoring` → ServiceMonitor 목록 (4) `kubectl get prometheusrule -n monitoring` → PrometheusRule 목록. 각 명령 후 실제 터미널 이미지 부착
- **🔴 HIGH** `맥락점프` _섹션 2.5 ServiceMonitor YAML (169~211줄)_
  - 문제: ServiceMonitor 예제가 갑자기 등장하는데 '왜 ServiceMonitor인가(Prometheus Operator와의 관계), 기존 방식(static config)의 한계가 무엇인가'를 설명하지 않음. 학생이 이것이 Prometheus 자체의 기능인지 쿠버네티스 확장인지 구분 못함
  - 보강: §2.5 앞에 1~2문단 추가: 'Prometheus는 기본적으로 prometheus.yml에서 static_configs로 타겟을 정의했다(스케일 불편). K8s 환경에서는 Prometheus Operator라는 CRD 확장이 ServiceMonitor를 도입해 선언적으로 Service를 자동 발견할 수 있게 했다(Operator 패턴). 이는 CNCF 졸업 프로젝트인 kube-prometheus-stack에 포함된다'는 배경 제시
- **🟡 MED** `용어비약` _섹션 4.2 'Loki는 라벨만 인덱싱' (288줄)_
  - 문제: '인덱싱'이라는 용어가 검색 최적화 맥락에서는 구체적이지만, 학생이 'Elasticsearch 전문 인덱싱과의 정확한 차이'를 모를 수 있음. 예: '전문 인덱싱 = 로그의 모든 단어를 역색인(inverted index)하여 빠른 전문검색 가능'이라는 정의가 빠짐
  - 보강: 4.2 첫 문단에서 Loki 정의 후 '라벨만 인덱싱한다'는 부분을 확장: '라벨(label)만 인덱싱한다는 것은, 로그의 모든 단어를 역색인하지 않는다는 뜻이다. 따라서 app=nginx 라벨로는 빠르게 필터할 수 있지만, 로그 본문에서 ERROR 단어를 검색할 때는 모든 로그 내용을 순회 검색해야 한다. 하지만 라벨 필터 후 검색하면 양이 크게 줄어든다'
- **🟡 MED** `스토리라인누락` _섹션 5.2 OpenTelemetry (349~383줄)_
  - 문제: OpenTelemetry가 무엇인지(벤더 중립, 표준 프로토콜 OTLP)는 설명하나, '왜 이게 나왔는가(OpenTracing과 OpenCensus의 경쟁, 생태계 혼재 문제)' 직전 배경과 트레이드오프(표준화의 대가로 초기 채택 미흡·추가 설정 필요)를 명시하지 않음
  - 보강: 5.2 본문 첫 문단 앞에 추가: 'OpenTracing(분산 트레이싱 표준, Jaeger 기반)과 OpenCensus(메트릭·로그 표준, Google 주도)가 분산되어 생태계가 혼란스러웠다(벤더들은 양쪽 모두 지원해야 함). 2019년 CNCF는 이를 통합하여 OpenTelemetry라는 단일 표준을 만들었다. 대가로 구현이 복잡해지고(SDK 선택 문제), 초기 채택률이 낮다는 트레이드오프가 있다'
- **🟡 MED** `이해난이도` _섹션 7.2 PromQL rate() 함수 (480~482줄)_
  - 문제: 'rate()는 Range Vector에 대한 초당 변화율'이라는 설명이 추상적. 'Range Vector'라는 용어를 정의하지 않음. 학생이 '그래서 rate()를 언제 쓰는가'를 모를 수 있음
  - 보강: rate() 설명 확장: 'rate()는 Counter 메트릭(누적값)에 대해, 지정된 시간 구간 동안의 초당 변화율을 계산한다. 예: rate(http_requests_total[5m])는 지난 5분 동안 매초 평균 몇 개의 요청이 들어왔는지를 계산한다(예: 300개/300초 = 1초당 1개 요청). Range Vector는 시계열의 "일정 기간 동안의 값의 범위" 즉 시간 대역을 의미한다'
- **🟡 MED** `정확성오류` _섹션 1.2 표 기술 도구 (67~71줄)_
  - 문제: 표에서 'Traces의 주요 도구: Jaeger, Zipkin'이라 했으나, 최신 생태계(2025~2026)에서 OpenTelemetry Collector를 통한 Tempo(Grafana Labs의 트레이싱 백엔드)도 중요한 선택지. 완전성 부족
  - 보강: 표의 Traces 도구명을 'Jaeger, Zipkin, Tempo'로 수정하고, 각주 또는 별도 문단에서 'Tempo는 Grafana Labs의 분산 트레이싱 백엔드로 비용 효율성 강조. OpenTelemetry는 벤더 중립이므로 이 셋 모두를 지원한다'고 추가
- **🟡 MED** `맥락점프` _섹션 3 Grafana (215~231줄)_
  - 문제: Grafana 섹션이 짧고 Prometheus와의 연결(데이터 소스로 추가하는 과정)이 설명되지 않음. 학생이 '그럼 Grafana를 어떻게 Prometheus와 연결하는가'를 모름
  - 보강: 섹션 3.1 후에 '3.2 Grafana-Prometheus 연결' 추가: 'Grafana 웹UI(기본 포트 3000)에서 Prometheus를 데이터 소스로 추가하는 과정: Settings → Data Sources → Add Prometheus → URL(http://prometheus:9090) 입력 → Save. 그 후 Dashboard에서 PromQL 쿼리로 그래프를 그린다'
- **⚪ LOW** `스토리라인누락` _섹션 4.1 Fluent Bit 설명 (259~263줄)_
  - 문제: Fluent Bit이 Fluentd의 경량 버전이라는 설명만 있고, '왜 경량 버전이 필요한가(엣지·IoT·리소스 제약 환경의 요구)', '메모리·성능 구체적 차이'를 언급하지 않음
  - 보강: Fluent Bit 문단 확장: 'Fluent Bit은 C로 작성된 경량 버전으로, Fluentd(Ruby, ~40MB)보다 메모리를 10~20배 적게 사용한다(~1MB). 따라서 IoT 기기·엣지 노드·리소스 제약이 심한 환경에서 활용된다. 패턴은 보통 Fluent Bit(각 노드) → Fluentd(수집·변환, 선택사항) → 저장소(S3, Elasticsearch, Loki)로 구성한다'
- **⚪ LOW** `용어비약` _섹션 2.4 Histogram/Summary (150~151줄)_
  - 문제: '백분위수(percentile)' 용어가 표에서 언급되지만 정의 없음. Summary 설명 '클라이언트에서 계산'이 무슨 뜻인지 Histogram과의 차이가 불명확
  - 보강: Histogram/Summary 표 아래에 1문단 추가: 'Histogram과 Summary는 모두 값의 분포(예: 응답 시간)를 기록한다. 차이: Histogram은 서버(Prometheus)에서 백분위수(p50, p95, p99 같은 상위 비율값)를 계산하므로 다중 인스턴스 집계 가능. Summary는 각 클라이언트가 이미 계산해 보내므로 Prometheus는 단순 저장만 하여 인스턴스 간 백분위수 합산 불가. 따라서 분산 시스템에서는 Histogram 권장'
- **⚪ LOW** `스토리라인누락` _섹션 1 등장배경 (19~21줄)_
  - 문제: 배경이 마이크로서비스와 모놀리식의 비교인데, Kubernetes 없이도 가능한 '물리 서버 분산 환경'과의 구분이 없음. K8s 특화 배경(Pod 생성소멸·네임스페이스 격리로 관측 복잡도 증가)을 강조하면 더 좋음
  - 보강: 등장배경 마지막에 1문장 추가: '더욱이 Kubernetes 환경에서는 Pod이 자동으로 생성되고 소멸하며(ephemeral), 로깅·모니터링도 K8s 메타데이터(라벨, 네임스페이스)를 고려해야 한다(예: Promtail의 Pod 라벨 자동 부착). 따라서 관측성 도구는 K8s API와 통합되어야 한다'

### daily/day08.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `용어비약` _§1.2 '지속적 조정(Continuous Reconciliation)' 설명, §2.1 'CRD' 용어 처음 나타남, §6.2 'Patch' 개념_
  - 문제: 용어가 정의 없이 사용됨. 'Reconciliation Loop'는 감시 주기, watch 메커니즘, 비교 알고리즘이 모두 불명확. CRD=Custom Resource Definition을 설명하지 않고 YAML에 사용. Kustomize의 'Patch'가 무엇인지(strategic merge? json patch?) 미설명.
  - 보강: §1.2에 'Reconciliation Loop: ArgoCD 에이전트가 n초마다(기본 3초) etcd watch로 Git 저장소와 클러스터 상태를 폴링하여 차이를 감지하고 kubectl apply로 동기화하는 루프'로 메커니즘 추가. §2.1에서 ArgoCD Application 예제 전에 'CRD(Custom Resource Definition): K8s가 Deployment/Pod처럼 취급할 사용자정의 리소스를 정의하는 방식'으로 한 문장 설명 추가. §6.2에 'Kustomize Patch: base의 YAML을 수정하는 strategic merge patch(필드별 병합) 방식으로, 전체 템플릿을 다시 쓰지 않아도 됨'으로 구체화.
- **🔴 HIGH** `맥락점프` _§6 Kustomize 섹션, §7 IaC 섹션, §실습 구성_
  - 문제: 왜 Kustomize를 배우는가? Helm 대비 advantage가 불명확. '템플릿 없이'가 왜 좋은지 구체적 사례 없음(예: 개발/프로덕션 환경 설정 차이를 어떻게 관리?). IaC(Terraform/Crossplane)가 GitOps와 어떤 관계인지 동기 없음. 'tart-infra 실습'이 앞의 개념과 어떻게 연결되는지 문장 없음.
  - 보강: §6 시작 전에 1문장 도입: 'Kustomize는 Helm 템플릿과 달리 기존 K8s YAML을 patch로 커스터마이즈하므로, YAML 자체가 항상 유효해 검증·디버깅이 쉽다. 예: base/deployment.yaml에 image 필드만 dev/kustomization.yaml의 patchesJson6902로 오버라이드.'로 장점·사용 사례 명시. §7 IaC 섹션 직전에 '클라우드 인프라(VPC, RDS 등)도 GitOps의 선언적 관리 원칙을 따른다. Terraform(HCL), Crossplane(K8s CRD)는 인프라를 코드로 정의해 Git 버전 관리·자동 배포할 수 있게 한다'로 연결. 실습 섹션 제목을 'tart-infra 실습: 개념을 실제 클러스터에서 검증한다'로 바꾸고, 도입문 '§1~6에서 배운 GitOps·배포 전략·패키지 관리를 이제 실제 platform/dev 클러스터에서 확인한다. CI(Jenkins) + CD(ArgoCD) 파이프라인이 어떻게 작동하는지 손으로 경험한다'로 스토리라인 강화.
- **🔴 HIGH** `실습재현불가` _§실습 1, 2, 3 전체 - 검증 출력_
  - 문제: 명령만 제시하고 실제 터미널 스크린샷이 없음. 대신 주석으로 '예상 출력', '현재 등록된 Application 오브젝트가 없어 비어 있다'라고 기술함. 학생이 자신의 실행 결과를 비교할 수 없음. jsonpath 명령의 복잡한 출력 구조를 예측만 하고 실물이 없음.
  - 보강: 모든 실습에 §4①(CLAUDE.md) 규칙 적용: 각 kubectl 명령 다음에 '![platform-argocd-pods](images/day08-argocd-pods.png)' 형식의 실제 터미널 캡처 이미지 삽입. 현재 platform 클러스터의 실제 argocd namespace pods, Application 목록, dev 클러스터의 실제 Helm release 목록, Deployment strategy JSON 출력을 스크린샷으로 제공. 불가능하면 '(미캡처: platform 클러스터 부재)'로 명시.
- **🔴 HIGH** `이해난이도` _§3.1 CI/CD 파이프라인 설명, §4.1 배포 전략 다이어그램, §5.3 Helm v3 다이어그램_
  - 문제: CI/CD 흐름이 일관되지 않음: '레지스트리 → 스테이징 배포'의 주체가 불명확. GitOps 컨텍스트에서는 ArgoCD가 배포하는가? 아니면 여전히 CI 서버인가? 배포 전략 다이어그램에 maxSurge/maxUnavailable 개념이 없음. Helm v3의 '3-way 병합 전략'이 어디서 작동하는지 불명(client, server, last-applied?)
  - 보강: §3.1을 다시 쓰기: 'CI는 코드 컴파일·테스트·이미지 빌드를 담당(예: Jenkins). CD는 이미지를 K8s 클러스터에 배포하는 것인데, GitOps 방식(이 과정의 핵심)에서는 (1) CI 서버가 container registry에 이미지를 push → (2) CI 서버가 Git의 배포 매니페스트(image: xxx:newTag)를 업데이트 → (3) ArgoCD/Flux가 Git 변경을 감지 → (4) ArgoCD가 kubectl apply로 K8s 클러스터에 배포. 따라서 배포 결정권(Auto-Sync)이 클러스터 내부 에이전트에 있다(Pull 모델).'로 명확화. §4.1 다이어그램 아래에 각 전략별로 '롤링: [maxSurge=25%, maxUnavailable=25%] = 동시에 1개만 중단, 1개 추가 허용해 무중단 배포' 같은 설명 추가. Helm v3의 경우 'client(operator가 helm command 실행) → apiserver로 request 전송 → apiserver가 last-applied annotation과 현재 desired state(values.yaml) 및 클러스터 상태(actual)를 3-way 병합(strategic merge)해 최종 YAML 결정 → deploy' 순서로 명시.
- **🟡 MED** `정확성오류` _§2.2 'Flux = 모듈형 컨트롤러', §6.2 'Kustomize 항상 유효한 YAML', §실습 3 RollingUpdate 예시_
  - 문제: '모듈형 컨트롤러'가 왜 우위인지 설명 없음(Flux의 image-automation-controller, helm-controller 같은 구체적 예시 부재). 'Kustomize가 항상 유효한 YAML'이라는 주장의 근거 불명확(Helm도 kubectl apply로 유효한 YAML 생성하지 않나?). RollingUpdate 예시에서 'maxSurge: 25%'일 때 pod 수가 몇 개 추가되는지 예시 pod 수 불명시.
  - 보강: §2.2: 'Flux의 장점: (a) image-automation-controller로 자동으로 image tag를 감지·Git commit해 policy-based 배포 가능, (b) helm-controller/kustomize-controller로 여러 패키지 형식을 native하게 지원'으로 구체화. §6.2: '항상 유효한'을 '변경 전 base의 YAML이 이미 유효하므로, patch 적용 후에도 문법 오류 가능성이 Helm 템플릿보다 낮다(Helm은 Go 템플릿이 문법 오류일 수 있음)'로 정확화. §실습 3: '[이미지 변경 전] [pod] [pod] [pod] (3개), [변경 후 maxSurge=25%] [pod-v1] [pod-v1] [pod-v2] [pod-v2] (즉시 4개 실행, maxSurge=1)' 같이 구체적 수치 예시 추가.
- **🟡 MED** `스토리라인누락` _§1에서 §7로 가는 흐름, IaC와 GitOps의 관계_
  - 문제: 왜 IaC(§7)를 GitOps 기반 배포(§1~6) 다음에 배우는가? 자격증 도메인 구조에서 이 두 분야의 관계가 불명확. Tekton(§3.2)도 갑자기 도구 나열처럼 나타남.
  - 보강: §3.2 직후에 '참고: Tekton은 K8s 네이티브 CI/CD 도구로, 이 과정의 tart-infra는 Jenkins를 사용하지만, K8s만으로 파이프라인을 구성하려면 Tekton이 적합하다. (심화: ../certification/tekton/)'로 위치 명시. §7 직전에 '여기까지는 애플리케이션 배포(코드·이미지 → K8s Pod)를 다뤘다. 이제 인프라 자체(VPC, DB, 로드밸런서)도 같은 GitOps·선언형 방식으로 관리하는 분야를 본다'로 전환 설명.
- **🟡 MED** `스토리라인누락` _§5.3 Helm v2의 보안 문제 설명_
  - 문제: Tiller가 cluster-admin 권한을 가지면 어떤 보안 위험이 생기는가? 구체적 공격 시나리오가 없음.
  - 보강: §5.3: '보안 문제: Tiller가 모든 네임스페이스를 접근할 수 있으므로, Tiller에 접근 가능한 일반 사용자도 cluster-admin 권한을 간접 획득할 수 있다(privilege escalation). 또한 Tiller를 운영하려면 클러스터 내 별도 보안이 필요해 운영 복잡도 증가.'로 위험 명시.
- **🟡 MED** `용어비약` _§2.1, §4.1 배포 전략 다이어그램_
  - 문제: ArgoCD Application 예제의 `prune: true`·`selfHeal: true` 옵션 의미를 명확하지 않게 설명함. 배포 전략 다이어그램에서 'Recreate' 옵션(§4.1 문제 10-11에 언급)이 설명 없이 문제에만 나타남.
  - 보강: §2.1 YAML 아래에 '주요 옵션: prune=true면 Git에서 삭제된 K8s 리소스를 클러스터에서도 자동 삭제. selfHeal=true면 누군가 kubectl로 직접 수정한 것을 ArgoCD가 감지해 Git 상태로 자동 복원(§1.2 지속적 조정).'로 명시. §4.1에 Recreate 전략 한 줄 추가: 'Recreate: 모든 파드를 한 번에 삭제 후 재생성(다운타임 발생, 개발 환경용)'.

### daily/day09.md · 가독성 3/5 · 스토리 2/5 · 미달❌

- **🔴 HIGH** `용어비약` _Line 94(Raft), Line 222(NetworkPolicy), Line 517(CNCF 졸업 프로젝트)_
  - 문제: 첫 등장하는 핵심 용어에 한 줄 풀이가 없음. 예: Raft를 '합의 알고리즘'이라는 정의 없이 제시, NetworkPolicy가 뭐하는 것인지 설명 없음, 'CNCF 졸업 프로젝트'의 의미 미설명
  - 보강: 각 핵심 용어에 첫 등장 시 역할을 한 문장으로 추가: 'Raft = 분산 서버가 데이터 일관성을 투표로 유지하는 합의 알고리즘. etcd는 이를 통해 마스터-팔로워 복제 구조로 고가용성 확보' 또는 'NetworkPolicy = Pod 간 통신을 IP/포트로 제어하는 선언적 방화벽(CNI가 구현함)' 추가
- **🔴 HIGH** `스토리라인누락` _문제 8(Headless Service), 문제 28(CMD vs ENTRYPOINT), 문제 38(Istio Sidecar)_
  - 문제: '답'만 있고 '왜 이 기술이 나왔는지·직전 방식의 한계·무엇이 개선됐는지' 없음. 예: Headless Service는 '고유 DNS가 필요'하다고만 하고, 왜 일반 ClusterIP로는 부족한지(StatefulSet의 순차적 배포 보장) 미설명. CMD vs ENTRYPOINT는 답만 있고 Docker 설계 의도 없음
  - 보강: 각 문제 해설에 스토리 추가: '문제 8 Headless Service: StatefulSet의 각 Pod는 고유 이름(mysql-0, mysql-1...)으로 식별되어 순차 시작·중지를 보장함. 일반 ClusterIP는 로드밸런싱으로 무작위 선택하므로 DB 복제(순서 중요)에 부적합' / '문제 28: Docker는 ENTRYPOINT와 CMD를 분리해 이미지 빌더는 기본 동작(ENTRYPOINT=진짜 실행파일)을 정의하고, 사용자는 CMD(매개변수)만 오버라이드 가능하게 설계'
- **🔴 HIGH** `맥락점프` _Line 51(전략 제시 전 Day 1~8 학습 가정), Line 705(서비스 메시 개념), Line 412(API Server 요청 순서)_
  - 문제: 이 문서가 독립적이지 않음. 모의시험을 풀려면 Day 1~8에서 개념을 알아야 함을 명시하지 않았고, 문제 42(서비스 메시 Control Plane vs Data Plane)는 단어만 있어 이해 불가
  - 보강: 문서 Line 10 '[0. 등장 배경과 시험 전략]' 후에 '선수 과정 점검' 섹션 추가: '이 모의시험을 풀기 전에 Day 1(etcd/kubelet/API Server) + Day 4(Secret/ConfigMap/Probe) + Day 6(Istio/HPA/VPA) 을 10분 내로 복습하라. [빠른 복습표]' 형태로 핵심 개념 정리표 삽입. 문제 42 해설에 'Control Plane = 정책·라우팅 규칙 관리(Envoy 설정 전달), Data Plane = 실제 트래픽 전달(Envoy 프록시)'를 추가
- **🔴 HIGH** `이해난이도` _Line 23(API Server 인증→인가→어드미션), 문제 6(배포 전략 다운타임), 문제 4(Pod 컨테이너 공유)_
  - 문제: 개념이 너무 추상적. 예: '어드미션 컨트롤'이 뭐하는지 모르는 학생은 정답을 맞춰도 왜 그런지 이해 못 함. '필터링→스코어링'은 스케줄러가 뭐 하는지 배경 없이 용어만 있음
  - 보강: §4④의 '쉬운 이해 우선' 원칙 적용: ① 한 문장 직관 추가 후 ② 정확한 정의 → ③ 내부 동작 순으로 재구성. 예: '문제 23: API Server는 요청을 3단계로 검증한다. ① 인증(누구인가? 인증서/토큰 확인) → ② 인가(그 사람이 이 동작을 할 권한 있나? RBAC 정책 확인) → ③ 어드미션(정책 위반이 없나? 예: 이미지는 internal registry만 허용? Pod가 2CPU 이상 요청?).' 추가
- **🔴 HIGH** `실습재현불가` _Line 929~1001(tart-infra 실습 섹션)_
  - 문제: 구체적 실행 결과가 없음. 'Grafana 대시보드: http://localhost:30300'이라 했는데, 학생이 정말 이 포트가 떠 있을까? 어떤 메트릭/로그를 보고 뭘 확인하는지 불명확. 장애 시나리오(Pod 삭제·네트워크 끊김)를 재현해서 관측성이 정말 필요한 이유를 보여주지 않음
  - 보강: 실습 섹션을 '개념→실행→해석' 3단계로 재작성: ① 설명: 'Prometheus는 각 노드 10250포트(/metrics)의 kubelet을 주기적으로 스크래핑(Pull 방식)해 메트릭 수집' ② 실행: 'kubectl port-forward -n monitoring svc/prometheus 9090:9090; curl localhost:9090/api/v1/targets' (실제 스크린샷) ③ 해석: '타겟 상태 보면 3개 워커 노드 다 UP으로 표시되고, 다운되면 DOWN으로 변함' 추가. 또한 구체 스크린샷(Grafana 대시보드 이미지, Prometheus 그래프)를 삽입
- **🟡 MED** `정확성오류` _Line 782(OpenTelemetry CNCF 인큐베이팅 상태)_
  - 문제: 문서 작성 시점(2026-06-12)에 정말 OpenTelemetry가 인큐베이팅인지 미재확인. CNCF 공식 현황이 바뀔 수 있음(졸업 승격 가능)
  - 보강: Line 782 수정 전 'curl https://api.cncf.io/v3/projects | jq ".[].maturity" 또는 [CNCF Landscape 공식](https://landscape.cncf.io) 확인해 정확한 성숙도 기록. 현재는 '인큐베이팅'이 맞으면 유지, 졸업했으면 수정
- **🟡 MED** `구조` _전체 문서 독립성_
  - 문제: '이 파일만으로 자격증을 딸 수 있는가' 기준에서 '아니오'. 모의시험만 있고 개념 설명(Day 1~8)은 없어서, 문제를 풀 때 자신 없는 것은 왜 답이 맞는지 확인할 방법이 없음. CLAUDE.md §4④에서 요구한 독립성 미달성
  - 보강: ①파일 상단에 '이 모의시험을 풀기 전 Day 1~8을 완료하시오' 명시 ②오답 분석용 '개념 요약' 섹션 추가(3쪽 분량): '스케줄러는 필터링(조건 맞는 노드만)과 스코어링(최적 노드 선택)을 함' 수준의 개념 한두 줄. 또는 각 도메인별 '[복습] 스케줄링이란' 재정의 링크 제시
- **⚪ LOW** `용어비약` _Line 178(Headless Service), Line 650(Envoy 프록시)_
  - 문제: Headless Service는 'clusterIP: None' 문법만 있고 '없으면 뭐가 달라지는가'를 안 설명. Envoy는 'sidecar 프록시'라 했는데, '사이드카'가 뭐하는지(Pod 내 보조 컨테이너) 모르면 이해 불가
  - 보강: Line 188: '고유 DNS를 부여하기 위해 Headless Service 필수' → '각 Pod마다 독립 DNS(예: mysql-0.mysql-headless.default.svc, mysql-1.mysql-headless...)를 받음. 일반 Service는 로드밸런서 IP를 주므로 특정 Pod로 직접 접근 불가' 추가. Line 654: 'Envoy = Pod 내 사이드카 프록시(Istio가 자동 주입). 모든 인바운드/아웃바운드 트래픽을 가로채 라우팅 규칙·재시도·서킷브레이커 적용' 추가

### daily/day10.md · 가독성 4/5 · 스토리 2/5 · 합격✅

- **🔴 HIGH** `용어비약` _섹션 1-1 항목 3, 1-2 항목 2, 1-3 항목 8_
  - 문제: Raft, apiserver advertise, eBPF, sidecar proxy 등 핵심 용어가 day 1~9 참조 없이 표만으로 등장 → 학부생이 의미를 모름
  - 보강: 각 섹션 상단에 '선수 기술 확인: etcd의 Raft란 합의 알고리즘으로 분산 상태 동기화를 보장(→ Day 1 Control Plane 참조)' 형식으로 링크 추가
- **🔴 HIGH** `스토리라인누락` _섹션 1-1~1-5, 섹션 2-1~2-2 전체_
  - 문제: 각 기술이 왜 필요했고, 이전 방식의 한계, 무엇이 나아졌는지, 트레이드오프가 없음 → 암기만 강요되고 개념 이해 불가
  - 보강: 각 도메인별 상단에 '배경: [이전 문제] → [새 해결] → [트레이드오프]' 한 문단 추가. 예: 'Cilium(eBPF): 종전 kube-proxy iptables는 느린 커널 모드 전환과 읽기 어려운 규칙 생성 → eBPF로 커널 내 L3~L7 필터링 + 관측 동시화 가능하나 eBPF 디버깅 복잡도 증가'
- **🟡 MED** `실습재현불가` _섹션 4 최종 20문, 섹션 8 트러블슈팅 시나리오_
  - 문제: 모두 개념과 정답만 있고, 실제 dev 클러스터에서 kubectl 명령·describe 출력·스크린샷 증거 0개 → 학생이 손으로 재현하며 검증 불가
  - 보강: 각 트러블 시나리오(Pod Pending, CrashLoopBackOff 등) 마다 '실측 검증: kubectl describe pod <name> -n <ns>' 명령 + 실제 터미널 스크린샷 추가. 최종 20문도 정답 후 '검증 명령: kubectl explain pod.spec.containers' 같은 확인 방법 제시
- **🟡 MED** `정확성오류` _섹션 7-2 항목 3, 섹션 1-1 항목 17_
  - 문제: 'kube-proxy는 실제 트래픽을 프록시하지 않는다' → IPVS 모드는 커널 수준 로드밸런싱 수행하므로 반은 틀림. PV 회수 정책도 'PVC 삭제 시 동작'이라는 조건 누락
  - 보강: kube-proxy 설명 수정: 'iptables 모드: 규칙만 관리, IPVS 모드: 커널 수준 로드밸런싱 수행' 명시. PV 항목: 'PVC 삭제 후 회수 정책 적용' 조건 추가
- **🟡 MED** `맥락점프` _섹션 3-3 오답 함정, 섹션 8 트러블슈팅, 섹션 6-3 Microservices 단점_
  - 문제: 오답 함정과 트러블슈팅이 중복된 내용 구조. '단점' 열거 후 객관식 문제에서 어떻게 출제되는지 맥락 부재
  - 보강: 섹션 순서 정렬: 암기카드(1) → 프로젝트(2) → 최종20문(4) → 시간전략(3) → 함정패턴(3-3) → 트러블(8) 또는, 각 개념 뒤에 '실제 문제 예시: "다음 중 Microservices 단점으로 옳은 것은? (A) 배포 독립성 (B) 네트워크 복잡성 (C) 코드 통합 용이'" 추가
- **⚪ LOW** `이해난이도` _섹션 1-1 도메인별 암기카드, 섹션 2-1 CNCF 프로젝트_
  - 문제: 표 형식만으로 학부생이 'Raft 합의', '각 도구의 선택 기준'을 이해 불가
  - 보강: 섹션 시작 전 '이 섹션을 읽기 전 알아야 할 것: [Raft는 분산 합의 알고리즘] [Namespace는 프로세스 격리] 자가평가 체크리스트' + 각 3~5줄 직관 설명 추가
