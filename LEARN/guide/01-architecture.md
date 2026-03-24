# 재연 가이드 01. 아키텍처 이해

이 문서는 프로젝트의 멀티 클러스터 아키텍처, 네트워크 설계, 리소스 할당 전략을 설명한다.

---

## 왜 멀티 클러스터인가

### 단일 클러스터의 한계

1. **Blast Radius**: 단일 클러스터에서 CNI 장애나 etcd 손상이 발생하면 모든 워크로드가 영향을 받는다. 클러스터를 분리하면 장애의 영향 범위가 해당 클러스터로 한정된다.

2. **환경 격리 불가**: 네임스페이스로 dev/staging/prod를 분리해도 동일 노드에서 실행되면 리소스 경합이 발생한다. noisy neighbor 문제를 네임스페이스만으로 완전히 해결할 수 없다.

3. **장애 전파**: 모니터링 스택이 애플리케이션과 같은 클러스터에 있으면, 클러스터 장애 시 모니터링 자체가 불가능해진다. 관측 시스템은 관측 대상과 분리되어야 한다.

4. **버전 독립성**: 클러스터별로 Kubernetes 버전, CNI 버전, Istio 버전을 독립적으로 관리할 수 있다. dev에서 먼저 업그레이드를 검증하고, staging을 거쳐 prod에 적용하는 것이 가능하다.

### 4개 클러스터의 역할

| 클러스터 | 역할 | 주요 컴포넌트 |
|---------|------|--------------|
| **platform** | 인프라 서비스 | Prometheus, Grafana, Loki, AlertManager, ArgoCD, Jenkins |
| **dev** | 개발 환경 + 서비스 메시 | 데모 앱(nginx, httpbin, redis, postgres, rabbitmq, keycloak), Istio, CiliumNetworkPolicy |
| **staging** | HPA/부하 테스트 | metrics-server, HPA, PDB, 부하 테스트용 앱 |
| **prod** | 프로덕션 시뮬레이션 | 2개 워커 노드로 HA 구성 시뮬레이션 |

platform 클러스터가 모니터링과 CI/CD를 전담하므로, dev/staging/prod 클러스터에 장애가 발생해도 관측과 배포 파이프라인은 유지된다.

---

## clusters.json 구조

`config/clusters.json`은 전체 인프라의 단일 설정 소스(Single Source of Truth)이다. 모든 스크립트가 이 파일을 읽어 클러스터, 노드, 네트워크 정보를 결정한다.

### 전체 내용

```json
{
  "base_image": "ghcr.io/cirruslabs/ubuntu:latest",
  "ssh_user": "admin",
  "ssh_password": "admin",
  "clusters": [
    {
      "name": "platform",
      "pod_cidr": "10.10.0.0/16",
      "service_cidr": "10.96.0.0/16",
      "nodes": [
        { "name": "platform-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20 },
        { "name": "platform-worker1", "role": "worker", "cpu": 3, "memory": 12288, "disk": 20 },
        { "name": "platform-worker2", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 }
      ]
    },
    {
      "name": "dev",
      "pod_cidr": "10.20.0.0/16",
      "service_cidr": "10.97.0.0/16",
      "nodes": [
        { "name": "dev-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20 },
        { "name": "dev-worker1", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 }
      ]
    },
    {
      "name": "staging",
      "pod_cidr": "10.30.0.0/16",
      "service_cidr": "10.98.0.0/16",
      "nodes": [
        { "name": "staging-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20 },
        { "name": "staging-worker1", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 }
      ]
    },
    {
      "name": "prod",
      "pod_cidr": "10.40.0.0/16",
      "service_cidr": "10.99.0.0/16",
      "nodes": [
        { "name": "prod-master", "role": "master", "cpu": 2, "memory": 4096, "disk": 20 },
        { "name": "prod-worker1", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 },
        { "name": "prod-worker2", "role": "worker", "cpu": 2, "memory": 8192, "disk": 20 }
      ]
    }
  ]
}
```

### 최상위 필드

| 필드 | 값 | 설명 |
|------|---|------|
| `base_image` | `ghcr.io/cirruslabs/ubuntu:latest` | Tart VM의 베이스 이미지. Golden image 사용 시 `k8s-golden`으로 변경한다. |
| `ssh_user` | `admin` | VM SSH 접속 사용자명. Cirrus Labs Ubuntu 이미지의 기본값이다. |
| `ssh_password` | `admin` | VM SSH 접속 패스워드. 프로덕션 환경에서는 SSH 키 인증으로 교체해야 한다. |

### 클러스터별 필드

| 필드 | 예시 | 설명 |
|------|-----|------|
| `name` | `platform` | 클러스터 이름. kubeconfig 파일명, Cilium cluster.name 등에 사용된다. |
| `pod_cidr` | `10.10.0.0/16` | Pod에 할당되는 IP 대역. kubeadm init --pod-network-cidr에 전달된다. |
| `service_cidr` | `10.96.0.0/16` | ClusterIP Service에 할당되는 IP 대역. kubeadm init --service-cidr에 전달된다. |

### 노드별 필드

| 필드 | 예시 | 설명 |
|------|-----|------|
| `name` | `platform-worker1` | VM 이름이자 Kubernetes 노드 이름. `tart clone`, `hostnamectl set-hostname`에 사용된다. |
| `role` | `master` 또는 `worker` | master는 kubeadm init, worker는 kubeadm join을 실행한다. |
| `cpu` | `3` | VM에 할당하는 vCPU 수. `tart set --cpu`에 전달된다. |
| `memory` | `12288` | VM에 할당하는 메모리(MB). `tart set --memory`에 전달된다. |
| `disk` | `20` | VM 디스크 크기(GB). 현재 Tart의 기본 디스크 크기를 사용하며, 별도 설정은 하지 않는다. |

### CIDR을 클러스터별로 다르게 설정하는 이유

각 클러스터의 Pod CIDR과 Service CIDR이 겹치지 않도록 설계하였다. 그 이유는 다음과 같다:

1. **멀티 클러스터 라우팅 대비**: 향후 Cilium ClusterMesh나 Submariner 등으로 클러스터 간 Pod-to-Pod 통신을 구성할 때, CIDR이 겹치면 라우팅이 불가하다.

2. **네트워크 디버깅 용이**: 패킷 캡처 시 IP 대역만 보고 어느 클러스터의 Pod인지 즉시 식별할 수 있다. `10.20.x.x`이면 dev 클러스터, `10.40.x.x`이면 prod 클러스터이다.

3. **IP 충돌 방지**: 여러 클러스터의 Service IP가 같은 대역을 사용하면, 외부 DNS나 로드밸런서 구성 시 충돌이 발생할 수 있다.

---

## 리소스 할당 전략

### 노드별 리소스 할당표

| 노드 | CPU | 메모리 | 할당 근거 |
|------|-----|--------|----------|
| platform-master | 2 | 4GB | etcd + API server. 워크로드를 실행하지 않으므로 최소 사양. |
| **platform-worker1** | **3** | **12GB** | Prometheus, Grafana, Loki, AlertManager가 모두 이 노드에서 실행된다. Prometheus는 메모리 사용량이 높고(TSDB), Loki는 로그 인덱싱에 메모리를 소비한다. 프로젝트에서 가장 무거운 노드이다. |
| platform-worker2 | 2 | 8GB | ArgoCD, Jenkins가 실행된다. Jenkins는 빌드 시 메모리를 많이 사용하므로 8GB를 할당하였다. |
| dev-master | 2 | 4GB | 컨트롤 플레인 전용. |
| dev-worker1 | 2 | 8GB | 데모 앱 6개(nginx, httpbin, redis, postgres, rabbitmq, keycloak) + Istio 사이드카. Istio Envoy 프록시가 각 Pod마다 추가되므로 메모리 소비가 증가한다. |
| staging-master | 2 | 4GB | 컨트롤 플레인 전용. |
| staging-worker1 | 2 | 8GB | HPA 테스트용. 부하 테스트 시 Pod 수가 증가하므로 여유를 두었다. |
| prod-master | 2 | 4GB | 컨트롤 플레인 전용. 모든 master 노드는 etcd 안정 운영을 위해 4GB를 할당한다. |
| prod-worker1 | 2 | 8GB | HA 시뮬레이션을 위한 워커 노드 #1. |
| prod-worker2 | 2 | 8GB | HA 시뮬레이션을 위한 워커 노드 #2. 워커가 2개이므로 한쪽이 장애 나도 서비스가 유지된다. |

### platform-worker1이 12GB인 이유 (상세)

모니터링 스택의 예상 메모리 사용량은 다음과 같다:

| 컴포넌트 | 예상 메모리 |
|---------|-----------|
| Prometheus (TSDB + scrape) | 2~4GB |
| Grafana | 200~500MB |
| Loki + Promtail | 1~2GB |
| AlertManager | 100~200MB |
| node-exporter (DaemonSet) | 50MB |
| kube-state-metrics | 100~200MB |
| kubelet, containerd, OS | 1~2GB |

합계: 약 5~9GB. 피크 시에도 여유가 있도록 12GB를 할당하였다.

---

## 네트워크 토폴로지

### VM 간 네트워크 구조

모든 VM은 macOS 호스트의 Tart 가상 네트워크 브릿지에 연결된다. VM끼리는 같은 L2 네트워크에 있으므로 직접 통신이 가능하다. DHCP로 IP를 받으며, `tart ip <vm-name>`으로 확인한다.

```
┌─────────────────────────────────────────────────────────────────┐
│  macOS Host (Apple Silicon)                                     │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Tart Virtual Network Bridge (192.168.64.0/24)          │   │
│  │                                                          │   │
│  │  ┌─────────────────────┐  ┌──────────────────────────┐  │   │
│  │  │ platform cluster    │  │ dev cluster              │  │   │
│  │  │                     │  │                          │  │   │
│  │  │ platform-master     │  │ dev-master               │  │   │
│  │  │   192.168.64.x      │  │   192.168.64.x           │  │   │
│  │  │ platform-worker1    │  │ dev-worker1              │  │   │
│  │  │   192.168.64.x      │  │   192.168.64.x           │  │   │
│  │  │ platform-worker2    │  │                          │  │   │
│  │  │   192.168.64.x      │  │                          │  │   │
│  │  └─────────────────────┘  └──────────────────────────┘  │   │
│  │                                                          │   │
│  │  ┌─────────────────────┐  ┌──────────────────────────┐  │   │
│  │  │ staging cluster     │  │ prod cluster             │  │   │
│  │  │                     │  │                          │  │   │
│  │  │ staging-master      │  │ prod-master              │  │   │
│  │  │   192.168.64.x      │  │   192.168.64.x           │  │   │
│  │  │ staging-worker1     │  │ prod-worker1             │  │   │
│  │  │   192.168.64.x      │  │   192.168.64.x           │  │   │
│  │  │                     │  │ prod-worker2             │  │   │
│  │  │                     │  │   192.168.64.x           │  │   │
│  │  └─────────────────────┘  └──────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

> **참고**: 실제 IP 주소는 DHCP 할당이므로 부팅할 때마다 달라질 수 있다. IP가 변경되면 API 서버/etcd의 TLS 인증서 SAN이 맞지 않아 클러스터가 기동되지 않는다. `boot.sh`(`02-wait-clusters.sh`)가 이를 자동으로 감지하여 인증서 재생성, static pod 매니페스트 IP 갱신, kubeconfig 재생성을 수행한다.

### Pod CIDR / Service CIDR 매핑 테이블

| 클러스터 | Pod CIDR | Service CIDR | Pod IP 예시 | Service IP 예시 |
|---------|----------|-------------|-------------|----------------|
| platform | 10.10.0.0/16 | 10.96.0.0/16 | 10.10.x.x | 10.96.x.x |
| dev | 10.20.0.0/16 | 10.97.0.0/16 | 10.20.x.x | 10.97.x.x |
| staging | 10.30.0.0/16 | 10.98.0.0/16 | 10.30.x.x | 10.98.x.x |
| prod | 10.40.0.0/16 | 10.99.0.0/16 | 10.40.x.x | 10.99.x.x |

각 /16 대역은 65,534개의 IP를 제공한다. 로컬 환경에서는 충분하다.

### 네트워크 계층 구조

```
Layer 1: macOS Host Network
  └── 192.168.64.0/24  (VM NIC, Tart bridge)

Layer 2: Kubernetes Overlay (Cilium VXLAN)
  ├── platform: 10.10.0.0/16  (Pod), 10.96.0.0/16  (Service)
  ├── dev:      10.20.0.0/16  (Pod), 10.97.0.0/16  (Service)
  ├── staging:  10.30.0.0/16  (Pod), 10.98.0.0/16  (Service)
  └── prod:     10.40.0.0/16  (Pod), 10.99.0.0/16  (Service)
```

- **Layer 1 (호스트 네트워크)**: macOS의 가상 브릿지 네트워크이다. VM 간, 그리고 호스트-VM 간 통신이 이 네트워크를 통한다. NodePort 서비스는 이 IP를 통해 접근한다.

- **Layer 2 (오버레이 네트워크)**: Cilium이 VXLAN 터널링으로 구성하는 Pod 네트워크이다. 같은 클러스터 내 Pod끼리만 통신 가능하다. 다른 클러스터의 Pod 네트워크와는 기본적으로 격리되어 있다.

### 서비스 접근 방식

이 프로젝트에서는 모든 외부 노출 서비스를 NodePort로 구성한다. LoadBalancer 타입은 클라우드 환경이 아니므로 사용하지 않는다.

| 서비스 | NodePort | 접근 URL |
|--------|----------|---------|
| Grafana | 30300 | `http://<platform-worker1-ip>:30300` |
| ArgoCD | 30800 | `http://<platform-worker1-ip>:30800` |
| Jenkins | 30900 | `http://<platform-worker1-ip>:30900` |
| AlertManager | 30903 | `http://<platform-worker1-ip>:30903` |

---

## 설계 트레이드오프

### 리소스 효율 vs 격리

10개 VM이 약 67GB RAM을 사용하는 것은 로컬 환경에서 무거운 구성이다. 실무에서는 platform + dev 2개 클러스터로 줄이고, staging/prod는 별도 환경(CI 파이프라인, 클라우드)에서 구성하는 것이 일반적이다. 이 프로젝트는 학습 목적으로 4개 클러스터를 모두 로컬에 구성한다.

### 단일 마스터 vs HA 마스터

모든 클러스터가 마스터 1개로 구성되어 있다. 이는 리소스 절약을 위한 선택이다. 프로덕션 환경에서는 마스터 3개(etcd quorum)가 필수이다. 마스터 VM이 죽으면 해당 클러스터 전체가 중단된다.

### SSH 패스워드 인증

SSH 키 인증 대신 패스워드 인증(sshpass)을 사용한다. 이는 설정 단계를 줄이기 위한 로컬 환경의 편의적 선택이다. 외부 네트워크에 노출하면 보안 취약점이 된다.

---

다음 장: [02. 빠른 시작](02-quick-start.md)
