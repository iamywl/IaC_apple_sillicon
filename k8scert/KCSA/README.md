# KCSA (Kubernetes and Cloud Native Security Associate) 시험 가이드

## 시험 개요

KCSA(Kubernetes and Cloud Native Security Associate)는 Linux Foundation과 CNCF(Cloud Native Computing Foundation)가 공동으로 주관하는 자격증 시험이다. Kubernetes 및 클라우드 네이티브 환경에서의 보안 개념, 원칙, 모범 사례에 대한 이해도를 검증하는 시험이다.

## 시험 정보

| 항목 | 내용 |
|------|------|
| **시험 형식** | 객관식(Multiple Choice) |
| **문항 수** | 60문항 |
| **시험 시간** | 90분 |
| **합격 기준** | 67% (약 40문항 이상 정답) |
| **시험 비용** | $250 USD |
| **유효 기간** | 3년 |
| **재시험** | 1회 무료 재시험 포함 |
| **시험 방식** | 온라인 프록터(감독관) 기반 |
| **시험 언어** | 영어 |
| **전제 조건** | 없음 (권장: Kubernetes 기본 지식) |

## 도메인별 출제 비율

KCSA 시험은 아래 6개 도메인으로 구성되어 있다. 각 도메인의 출제 비율을 반드시 숙지하고, 비율이 높은 도메인에 더 많은 학습 시간을 투자하는 것이 합격 전략의 핵심이다.

| 도메인 | 출제 비율 | 예상 문항 수 |
|--------|----------|-------------|
| 1. Overview of Cloud Native Security | 14% | ~8문항 |
| 2. Kubernetes Cluster Component Security | 22% | ~13문항 |
| 3. Kubernetes Security Fundamentals | 22% | ~13문항 |
| 4. Kubernetes Threat Model | 16% | ~10문항 |
| 5. Platform Security | 16% | ~10문항 |
| 6. Compliance and Security Frameworks | 10% | ~6문항 |

### 도메인별 출제 비율 시각화

```
도메인 2: Kubernetes Cluster Component Security  ████████████████████████ 22%
도메인 3: Kubernetes Security Fundamentals       ████████████████████████ 22%
도메인 4: Kubernetes Threat Model                ██████████████████ 16%
도메인 5: Platform Security                      ██████████████████ 16%
도메인 1: Overview of Cloud Native Security      ████████████████ 14%
도메인 6: Compliance and Security Frameworks     ████████████ 10%
```

## 학습 자료 구성

이 디렉토리에는 KCSA 시험 준비를 위한 학습 자료가 아래와 같이 구성되어 있다.

| 파일 | 내용 |
|------|------|
| [01-concepts.md](./01-concepts.md) | 6개 도메인별 핵심 개념 정리 |
| [02-examples.md](./02-examples.md) | YAML 설정 및 실습 예제 |
| [03-exam-questions.md](./03-exam-questions.md) | 모의 시험 문제 (40문항 이상) |
| [04-tart-infra-practice.md](./04-tart-infra-practice.md) | tart-infra 환경 활용 실습 가이드 |

## 학습 전략

### 1단계: 개념 이해 (1~2주)

`01-concepts.md` 파일을 통해 6개 도메인의 핵심 개념을 학습한다. 출제 비율이 높은 도메인 2(Cluster Component Security)와 도메인 3(Security Fundamentals)을 가장 먼저, 가장 깊이 있게 학습하는 것이 효율적이다.

### 2단계: 실습 (1~2주)

`02-examples.md` 파일의 YAML 예제를 직접 Kubernetes 클러스터에 적용해 보며 실무 감각을 익힌다. 각 예제의 동작 원리와 설정 의미를 정확히 이해하는 것이 중요하다.

### 3단계: 모의 시험 (1주)

`03-exam-questions.md` 파일의 모의 문제를 풀어본다. 틀린 문제는 반드시 해설을 확인하고, 관련 개념을 다시 복습한다. 실제 시험과 동일한 조건(90분 시간 제한)으로 연습하는 것을 권장한다.

### 4단계: 취약 부분 보강 (시험 전까지)

모의 시험에서 약점으로 드러난 도메인을 집중적으로 복습한다. 특히 Kubernetes 공식 문서의 보안 관련 섹션을 반복 학습하는 것이 효과적이다.

## 참고 링크

- [KCSA 시험 공식 페이지](https://training.linuxfoundation.org/certification/kubernetes-and-cloud-native-security-associate-kcsa/)
- [KCSA Curriculum (시험 범위)](https://github.com/cncf/curriculum)
- [Kubernetes 공식 문서 - Security](https://kubernetes.io/docs/concepts/security/)
- [CNCF Security Technical Advisory Group](https://github.com/cncf/tag-security)
- [CIS Kubernetes Benchmark](https://www.cisecurity.org/benchmark/kubernetes)
- [NIST SP 800-190 (Container Security Guide)](https://csrc.nist.gov/publications/detail/sp/800-190/final)
- [MITRE ATT&CK for Containers](https://attack.mitre.org/matrices/enterprise/containers/)
