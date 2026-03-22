# Day 2: PromQL 완전 가이드

> PromQL의 데이터 타입, 셀렉터, 연산자, 집계 함수, 내장 함수, 서브쿼리 등 PromQL 전반을 심화 학습한다.

## PromQL 완전 가이드

### Selector (선택자)

#### Instant Vector Selector

```promql
# 메트릭 이름으로 선택
http_requests_total

# 라벨 매칭
http_requests_total{method="GET"}

# 라벨 매칭 연산자
http_requests_total{method="GET"}     # = : 정확히 일치
http_requests_total{method!="GET"}    # != : 일치하지 않음
http_requests_total{method=~"GET|POST"}  # =~ : 정규식 일치
http_requests_total{method!~"GET|POST"} # !~ : 정규식 불일치

# 복수 라벨 조건 (AND 연산)
http_requests_total{method="GET", status="200", job="api-server"}

# __name__ 라벨로 메트릭 이름 매칭
{__name__=~"http_requests_.*"}

# 빈 라벨 매칭 (라벨이 존재하지 않는 시계열)
http_requests_total{exported_job=""}
```

#### Range Vector Selector

```promql
# 최근 5분간의 샘플 목록
http_requests_total[5m]

# 시간 단위: ms, s, m, h, d, w, y
http_requests_total[30s]
http_requests_total[2h]
http_requests_total[7d]

# 복합 시간 단위
http_requests_total[1h30m]

# offset과 함께 사용 (과거 시점의 range vector)
http_requests_total[5m] offset 1h

# @ modifier와 함께 사용 (특정 시각의 range vector)
http_requests_total[5m] @ 1609459200
```

### 연산자 (Operators)

#### 산술 연산자

```promql
# +, -, *, /, %, ^
node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes  # 사용 중인 메모리
node_filesystem_avail_bytes / node_filesystem_size_bytes * 100  # 사용 가능 비율 (%)
2 ^ 10  # 1024 (스칼라 연산)
```

#### 비교 연산자

```promql
# ==, !=, >, <, >=, <=
# 필터링 모드 (기본): 조건에 맞는 시계열만 반환한다
http_requests_total > 1000

# bool 모드: 조건 결과를 0/1로 반환한다
http_requests_total > bool 1000
# 조건 충족 시 1, 미충족 시 0

# 활용: 조건부 값 선택
http_requests_total > 1000 or http_requests_total * 0
```

#### 논리/집합 연산자

```promql
# and: 양쪽 모두 존재하는 시계열만 반환 (왼쪽 값 유지)
http_requests_total{status="500"} and on(instance) up == 1

# or: 합집합 (왼쪽 우선)
http_requests_total{status="500"} or http_requests_total{status="503"}

# unless: 차집합 (왼쪽에만 있고 오른쪽에는 없는 시계열)
http_requests_total unless http_requests_total{status=~"2.."}
```

### Vector Matching 심화

두 벡터 간의 연산 시, 어떤 시계열끼리 매칭할지를 결정하는 규칙이다.

#### One-to-One Matching

```promql
# 기본: 모든 라벨이 같은 시계열끼리 매칭
vector_a / vector_b

# on(): 지정한 라벨만 비교하여 매칭
method_code:http_errors:rate5m / on(method) method:http_requests:rate5m

# ignoring(): 지정한 라벨을 무시하고 매칭
method_code:http_errors:rate5m / ignoring(code) method:http_requests:rate5m
```

#### Many-to-One / One-to-Many Matching

```promql
# group_left: 왼쪽이 다수, 오른쪽이 1 (오른쪽의 라벨을 왼쪽에 복제)
method_code:http_errors:rate5m
  / ignoring(code) group_left
  method:http_requests:rate5m

# group_left(extra_label): 오른쪽의 추가 라벨을 왼쪽으로 복사
node_filesystem_avail_bytes
  * on(instance) group_left(nodename)
  node_uname_info

# group_right: 오른쪽이 다수, 왼쪽이 1
```

#### 매칭 규칙 요약 표

| 매칭 유형 | 키워드 | 설명 | 예시 |
|-----------|--------|------|------|
| 1:1 | `on(label)` | 지정 라벨 기준 매칭 | `a / on(instance) b` |
| 1:1 | `ignoring(label)` | 지정 라벨 제외 매칭 | `a / ignoring(code) b` |
| N:1 | `group_left` | 왼쪽이 다수 | `a / on(instance) group_left b` |
| 1:N | `group_right` | 오른쪽이 다수 | `a / on(instance) group_right b` |

### 집계 연산자 (Aggregation Operators)

```promql
# sum: 합계
sum(rate(http_requests_total[5m])) by (service)

# avg: 평균
avg(node_cpu_seconds_total{mode="idle"}) by (instance)

# count: 시계열 개수
count(up == 1) by (job)

# min / max: 최솟값 / 최댓값
max(node_cpu_seconds_total{mode="idle"}) by (instance)

# topk: 상위 N개
topk(5, sum(rate(http_requests_total[5m])) by (endpoint))

# bottomk: 하위 N개
bottomk(3, node_filesystem_avail_bytes)

# quantile: 집계 수준의 분위수 (histogram_quantile과 다르다)
quantile(0.95, rate(http_requests_total[5m]))

# stddev / stdvar: 표준편차 / 분산
stddev(rate(http_requests_total[5m])) by (service)

# count_values: 값별 시계열 개수
count_values("version", kube_pod_container_info)

# group: 고유 라벨 조합을 반환 (값은 항상 1)
group(kube_pod_info) by (namespace, pod)

# by vs without
# by: 지정한 라벨만 유지
sum by (namespace) (rate(container_cpu_usage_seconds_total[5m]))

# without: 지정한 라벨을 제거하고 나머지로 집계
sum without (instance, pod) (rate(container_cpu_usage_seconds_total[5m]))
```

### 함수 완전 레퍼런스

#### Counter 관련 함수

```promql
# rate(): 범위 내 초당 평균 변화율 (Counter 리셋 자동 보정)
rate(http_requests_total[5m])
# 주의: 범위는 scrape_interval의 최소 4배를 권장한다

# irate(): 마지막 두 데이터 포인트의 순간 변화율
irate(http_requests_total[5m])
# 주의: 빠르게 변하는 메트릭에 적합하지만, 알림에는 rate()를 사용한다

# increase(): 범위 내 총 증가량 (rate * 범위 초)
increase(http_requests_total[1h])
# 사실상 rate(x[1h]) * 3600 과 동일하다

# resets(): 범위 내 Counter 리셋 횟수
resets(http_requests_total[1h])
# 프로세스 재시작 횟수를 추정할 수 있다
```

#### rate() vs irate() 심화 비교

```
실제 데이터 포인트: [100, 110, 120, 115(리셋+115), 200, 210]
                    t0   t1   t2   t3              t4   t5

rate([t0:t5]):
  - 리셋 보정: 120 + 210 = 330
  - (330 - 100) / (t5-t0) = 평균 변화율
  - 스파이크가 평탄화된다

irate([t0:t5]):
  - 마지막 두 포인트만 사용: (210 - 200) / (t5-t4)
  - 최근의 순간적 변화만 반영한다
  - 범위 [t0:t5]는 "최소 두 포인트가 포함되는 범위"의 의미이다
```

#### Gauge 관련 함수

```promql
# delta(): 범위의 첫/마지막 값의 차이
delta(node_memory_MemAvailable_bytes[1h])

# deriv(): 선형 회귀의 기울기 (초당 변화량)
deriv(node_memory_MemAvailable_bytes[1h])

# predict_linear(): 선형 회귀를 사용한 미래 값 예측
# 6시간 데이터를 기반으로 24시간 후 디스크 사용량 예측
predict_linear(node_filesystem_avail_bytes[6h], 24*3600)

# changes(): 범위 내 값이 변경된 횟수
changes(node_memory_MemAvailable_bytes[1h])

# idelta(): 마지막 두 데이터 포인트의 차이 (irate의 gauge 버전)
idelta(node_memory_MemAvailable_bytes[5m])
```

#### 시간 관련 함수

```promql
# time(): 현재 Unix 타임스탬프 (초)
time()

# timestamp(): 시계열의 마지막 샘플 타임스탬프
timestamp(up)

# day_of_week(): 요일 (0=일요일, 6=토요일)
day_of_week()

# hour(): 현재 시간 (0-23, UTC)
hour()

# 활용: 업무 시간에만 알림
rate(http_requests_total[5m]) > 1000
  and on() hour() >= 9 and on() hour() <= 18
  and on() day_of_week() >= 1 and on() day_of_week() <= 5
```

#### over_time 함수군

```promql
# Range Vector를 Instant Vector로 변환하는 함수들

# avg_over_time(): 범위 내 평균
avg_over_time(node_load1[1h])

# min_over_time() / max_over_time(): 범위 내 최소/최대
max_over_time(node_cpu_seconds_total{mode="idle"}[1h])

# sum_over_time(): 범위 내 합계
sum_over_time(http_request_duration_seconds_count[1h])

# count_over_time(): 범위 내 샘플 수
count_over_time(up[1h])

# quantile_over_time(): 범위 내 분위수
quantile_over_time(0.95, http_request_duration_seconds_sum[1h])

# stddev_over_time() / stdvar_over_time(): 범위 내 표준편차/분산
stddev_over_time(node_load1[1h])

# last_over_time(): 범위 내 마지막 값 (staleness 우회)
last_over_time(up[5m])
```

#### histogram_quantile() 심화

```promql
# 기본 사용법: p99 응답 시간
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))

# 서비스별 p95 응답 시간
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)
)

# 주의: by 절에 반드시 le 라벨을 포함해야 한다!
# le 라벨이 없으면 함수가 동작하지 않는다

# 평균 응답 시간 (histogram으로부터)
rate(http_request_duration_seconds_sum[5m])
  / rate(http_request_duration_seconds_count[5m])

# Apdex 스코어 계산 (SLO target = 0.3초)
(
  sum(rate(http_request_duration_seconds_bucket{le="0.3"}[5m])) by (service)
  +
  sum(rate(http_request_duration_seconds_bucket{le="1.2"}[5m])) by (service)
) / 2
/ sum(rate(http_request_duration_seconds_count[5m])) by (service)
```

#### histogram_quantile 선형 보간 원리

```
버킷:    le=0.05 (1000개), le=0.1 (1500개), le=0.25 (1800개)
quantile(0.9) 요청 시 (총 2000개 중 90%인 1800번째 값):

1. 1800번째 값이 le=0.25 버킷에 속한다는 것을 확인
2. 이전 버킷(le=0.1, 1500개)과 현재 버킷(le=0.25, 1800개) 사이에서 보간
3. 해당 구간의 관측값: 1800 - 1500 = 300개
4. 구간 내 위치: (1800 - 1500) / (1800 - 1500) = 1.0 (구간의 100% 위치)
5. 보간값: 0.1 + (0.25 - 0.1) * 1.0 = 0.25

# 따라서 버킷 경계가 넓으면 보간 오차가 커진다
# SLO 경계값(예: 200ms)에 해당하는 버킷을 반드시 추가해야 정확도가 높아진다
```

#### absent / absent_over_time

```promql
# absent(): 시계열이 존재하지 않으면 1을 반환한다
# 주로 알림에서 "메트릭이 사라졌을 때" 감지하는 데 사용한다
absent(up{job="my-service"})  # my-service가 다운되면 1 반환

# absent_over_time(): 범위 내에 샘플이 하나도 없으면 1을 반환한다
absent_over_time(up{job="my-service"}[5m])

# 활용: 메트릭이 사라졌을 때 알림
# 주의: absent()는 라벨 매처가 정확해야 의미가 있다
- alert: JobDown
  expr: absent(up{job="my-service"}) == 1
  for: 5m
  annotations:
    summary: "my-service의 메트릭이 사라졌다"
```

#### label 조작 함수

```promql
# label_replace(): 정규식으로 라벨 값을 생성/변경한다
label_replace(
  up,
  "hostname",           # 새 라벨 이름
  "$1",                 # 대체값 (정규식 캡처 그룹)
  "instance",           # 원본 라벨
  "(.+):\\d+"           # 정규식 (IP:port에서 IP만 추출)
)

# label_join(): 여러 라벨 값을 결합하여 새 라벨을 만든다
label_join(
  up,
  "combined",           # 새 라벨 이름
  "-",                  # 구분자
  "job", "instance"     # 결합할 라벨들
)
# 결과: combined="api-server-10.0.0.1:9090"
```

#### 수학 함수

```promql
# abs(): 절대값
abs(delta(node_memory_MemAvailable_bytes[1h]))

# ceil() / floor(): 올림 / 내림
ceil(node_memory_MemAvailable_bytes / 1024 / 1024 / 1024)  # GB로 올림

# round(): 반올림 (두 번째 인수로 반올림 단위 지정)
round(node_memory_MemAvailable_bytes / 1024 / 1024, 100)  # 100MB 단위로 반올림

# clamp() / clamp_min() / clamp_max(): 값 범위 제한
clamp(cpu_usage_ratio, 0, 1)  # 0~1 사이로 제한
clamp_min(remaining_capacity, 0)  # 음수 방지

# ln() / log2() / log10(): 로그 함수
log2(node_memory_MemTotal_bytes)  # 메모리를 로그 스케일로

# exp(): e의 거듭제곱
# sqrt(): 제곱근

# sgn(): 부호 함수 (-1, 0, 1)
sgn(delta(node_memory_MemAvailable_bytes[1h]))  # 증가(1) or 감소(-1)
```

### Subquery 문법

```promql
# 형식: <instant_query>[<range>:<resolution>]
# range: 되돌아볼 시간 범위
# resolution: 평가 간격 (생략하면 global evaluation_interval 사용)

# 5분 간격으로 계산된 rate를 1시간 범위에서 max로 집계한다
max_over_time(rate(http_requests_total[5m])[1h:5m])

# 최근 1시간에서 CPU 사용률이 최고였던 순간
max_over_time(
  (1 - avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])))[1h:1m]
)

# 주의: Subquery는 계산 비용이 높다
# resolution이 작을수록 더 많은 평가가 필요하다
# 가능하면 Recording Rule로 대체하는 것이 성능에 유리하다
```

### offset과 @ modifier

```promql
# 1시간 전 값과 비교
http_requests_total offset 1h

# 특정 Unix 타임스탬프의 값
http_requests_total @ 1609459200

# 어제 대비 오늘의 요청 증가율
rate(http_requests_total[5m]) / rate(http_requests_total[5m] offset 1d) * 100 - 100

# 지난주 같은 시간 대비 비교
rate(http_requests_total[5m]) / rate(http_requests_total[5m] offset 7d)

# @ modifier와 offset 조합
http_requests_total @ 1609459200 offset 1h
# 1609459200 타임스탬프에서 1시간 전 값
```

### PromQL 안티패턴과 모범 사례

#### 안티패턴

```promql
# (X) Counter를 직접 사용
http_requests_total{status="500"}

# (X) rate()에 너무 짧은 범위 사용 (scrape_interval보다 짧으면 데이터 없음)
rate(http_requests_total[10s])  # scrape_interval=15s이면 빈 결과

# (X) irate()를 알림에 사용 (변동이 심하여 오탐/미탐 발생)
irate(http_requests_total[5m]) > 1000

# (X) histogram_quantile에서 le 라벨을 제거
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (service))
# le가 없어서 동작하지 않는다!

# (X) 높은 카디널리티 라벨로 집계
sum by (user_id) (rate(http_requests_total[5m]))
# user_id가 수백만 개면 카디널리티 폭발
```

#### 모범 사례

```promql
# (O) rate()에 충분한 범위 사용
rate(http_requests_total[5m])  # scrape_interval=15s의 20배

# (O) rate()를 알림에 사용
rate(http_requests_total{status=~"5.."}[5m]) > 0.05

# (O) histogram_quantile에 le 라벨 포함
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))

# (O) Recording Rule로 복잡한 쿼리 사전 계산
# rule: job:http_requests:rate5m = sum by (job) (rate(http_requests_total[5m]))
job:http_requests:rate5m

# (O) 적절한 라벨만 사용하여 카디널리티 관리
sum by (method, status_code) (rate(http_requests_total[5m]))
```

---

