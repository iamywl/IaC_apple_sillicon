# Bug Report — Grafana CrashLoopBackOff

- **작성일시(Timestamp)**: 2026-03-24 09:25 KST
- **환경(Environment)**: M4 Max MacBook Pro, macOS Darwin 24.6.0
- **인프라(Infrastructure)**: Tart VM 10개, K8s 4 클러스터 — kubeadm v1.31.14
- **영향 범위(Scope)**: platform 클러스터 monitoring 네임스페이스

---

## BUG-008: Grafana CrashLoopBackOff — Datasource isDefault 충돌

| 항목(Field) | 내용(Detail) |
|------|------|
| 타임스탬프(Timestamp) | 2026-03-24 09:25 |
| 심각도(Severity) | High |
| 카테고리(Category) | Monitoring / Grafana |
| 영향 파드(Affected Pod) | `kube-prometheus-stack-grafana-5c68b8b867-xnkn7` |
| 노드(Node) | `platform-worker2` (192.168.66.12) |
| Restart Count | 7회 (9시간 동안 반복 크래시) |

### 증상(Symptom)

Grafana 파드가 시작 직후 **Exit Code 1**로 종료되며 CrashLoopBackOff 상태 반복.

```
$ kubectl -n monitoring get pods -l app.kubernetes.io/name=grafana
NAME                                             READY   STATUS             RESTARTS
kube-prometheus-stack-grafana-5c68b8b867-xnkn7   2/3     CrashLoopBackOff   7
```

Sidecar 컨테이너(`grafana-sc-dashboard`, `grafana-sc-datasources`)는 정상 Running이나, 메인 `grafana` 컨테이너만 반복 크래시.

### 원인(Root Cause)

두 개의 Datasource ConfigMap이 모두 `isDefault: true`로 설정되어 Grafana 프로비저닝 단계에서 충돌 발생.

**ConfigMap 1** — `kube-prometheus-stack-grafana-datasource` (Helm: kube-prometheus-stack)
```yaml
datasources:
- name: "Prometheus"
  type: prometheus
  isDefault: true        # ← default
```

**ConfigMap 2** — `loki-loki-stack` (Helm: loki-stack)
```yaml
datasources:
- name: Loki
  type: loki
  isDefault: true        # ← 중복 default (충돌 원인)
```

Grafana 로그에서 확인된 에러 메시지:

```
logger=provisioning level=error msg="Failed to provision data sources"
  error="Datasource provisioning error: datasource.yaml config is invalid.
  Only one datasource per organization can be marked as default"

Error: ✗ invalid service state: Failed [...] failure: Datasource provisioning error:
  datasource.yaml config is invalid. Only one datasource per organization can be marked as default
```

### 근본 원인 분석(Why)

- `kube-prometheus-stack` Helm 차트가 Prometheus datasource를 `isDefault: true`로 프로비저닝
- `loki-stack` Helm 차트도 Loki datasource를 기본값 `isDefault: true`로 프로비저닝
- 두 차트가 독립적으로 설치되면서 default datasource 충돌이 발생
- Grafana는 조직(org)당 default datasource를 **1개만** 허용하므로, 프로비저닝 실패 → 프로세스 종료

### 해결(Fix)

Loki datasource ConfigMap에서 `isDefault: true`를 `false`로 변경 후 Grafana 파드 재시작.

```bash
# ConfigMap 패치
kubectl -n monitoring get configmap loki-loki-stack -o json \
  | sed 's/isDefault: true/isDefault: false/' \
  | kubectl apply -f -

# Grafana 파드 재시작
kubectl -n monitoring delete pod -l app.kubernetes.io/name=grafana
```

### 재발 방지(Prevention)

Loki-stack Helm 설치 시 `grafana.sidecar.datasources.isDefault`를 명시적으로 `false`로 지정해야 함.
향후 `scripts/install/07-install-monitoring.sh` 또는 관련 Helm values에 다음 설정 추가 권장:

```yaml
# loki-stack values에 추가
grafana:
  sidecar:
    datasources:
      isDefault: false
```

### 검증(Verification)

```
$ kubectl -n monitoring get pods -l app.kubernetes.io/name=grafana
NAME                                             READY   STATUS    RESTARTS   AGE
kube-prometheus-stack-grafana-5c68b8b867-rphz2   3/3     Running   0          68s
```

패치 후 새 파드 `rphz2`가 **3/3 Running** 상태로 정상 기동 확인.
