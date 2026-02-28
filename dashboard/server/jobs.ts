import { execaCommand } from 'execa';
import { getKubeconfigPath } from './config.js';
import { parseK6Output } from './parsers/k6.js';
import { parseStressNgOutput } from './parsers/stress-ng.js';
import { getScalingHistory } from './collectors/scaling.js';
import type { TestRun, TestType, TestResults, CustomLoadConfig, StressConfig, ScalingTestConfig, ScalingDataPoint, ScalingTestMeta, HpaSnapshot } from '../shared/types.js';

// CiliumNetworkPolicy allowing sre-test pods full egress + ingress
// Applied alongside every job to ensure k6/stress can reach services
const SRE_TEST_NETWORK_POLICY = `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-sre-tests
  namespace: demo
spec:
  endpointSelector:
    matchLabels:
      sre-test: "true"
  ingress:
  - fromEntities:
    - cluster
    - world
  egress:
  - toEntities:
    - cluster
    - world
  - toEndpoints:
    - matchLabels:
        io.kubernetes.pod.namespace: kube-system
        k8s-app: kube-dns
    toPorts:
    - ports:
      - port: "53"
        protocol: ANY
`.trim();

const tests = new Map<string, TestRun>();
const watchers = new Map<string, NodeJS.Timeout>();

export function getAllTests(): TestRun[] {
  return Array.from(tests.values());
}

export function getTest(id: string): TestRun | undefined {
  return tests.get(id);
}

export function deleteTest(id: string): boolean {
  const test = tests.get(id);
  if (!test) return false;

  const watcher = watchers.get(id);
  if (watcher) {
    clearInterval(watcher);
    watchers.delete(id);
  }

  // Delete k8s job + configmap in background
  const kubeconfig = getKubeconfigPath(test.cluster);
  execaCommand(
    `kubectl --kubeconfig ${kubeconfig} delete job ${id} -n demo --ignore-not-found`,
    { timeout: 10000 }
  ).catch(() => {});
  if (test.type === 'load' || test.type === 'custom-load' || test.type === 'scaling-test') {
    execaCommand(
      `kubectl --kubeconfig ${kubeconfig} delete configmap ${id}-script -n demo --ignore-not-found`,
      { timeout: 10000 }
    ).catch(() => {});
  }

  tests.delete(id);
  return true;
}

// Only 1 test at a time (any type)
function getRunningTest(): TestRun | null {
  for (const t of tests.values()) {
    if (t.status === 'running' || t.status === 'pending') return t;
  }
  return null;
}

export async function runTest(
  type: TestType,
  cluster: string,
  config?: CustomLoadConfig,
  stressConfig?: StressConfig,
  scenarioName?: string,
  scalingConfig?: ScalingTestConfig,
): Promise<TestRun> {
  const running = getRunningTest();
  if (running) {
    throw new Error(`Test "${running.id}" is still ${running.status}. Wait for it to finish.`);
  }

  const suffix = Date.now().toString(36);
  const id = `${type}-${suffix}`;
  const kubeconfig = getKubeconfigPath(cluster);

  const test: TestRun = {
    id,
    type,
    cluster,
    status: 'pending',
    startedAt: Date.now(),
    config: type === 'scaling-test' ? scalingConfig : config,
    stressConfig,
    scalingConfig,
    scenarioName,
  };
  tests.set(id, test);

  try {
    const yaml = generateJobYaml(id, type, type === 'scaling-test' ? scalingConfig : config, stressConfig);
    await execaCommand(
      `kubectl --kubeconfig ${kubeconfig} apply -f -`,
      { input: yaml, timeout: 15000 }
    );
    test.status = 'running';
    if (type === 'scaling-test') {
      startWatchingScalingTest(id, kubeconfig, cluster, scalingConfig);
    } else {
      startWatching(id, kubeconfig);
    }
  } catch (e: any) {
    test.status = 'failed';
    test.error = e.message;
    test.completedAt = Date.now();
  }

  return test;
}

export function exportTestsCsv(): string {
  const allTests = getAllTests().filter(t => t.status === 'completed' || t.status === 'failed');
  const headers = [
    'id', 'type', 'scenario', 'cluster', 'status',
    'started_at', 'completed_at', 'duration_sec',
    'vus', 'load_duration', 'target_url',
    'stress_workers', 'stress_timeout', 'stress_vm_bytes',
    'p95_latency_ms', 'p99_latency_ms', 'avg_latency_ms',
    'error_rate', 'rps', 'total_requests',
    'cpu_bogo_ops', 'memory_bogo_ops',
    'scale_up_latency_ms', 'peak_replicas', 'scale_down_started_ms', 'avg_rps_per_pod',
    'error',
  ];
  const rows = allTests.map(t => {
    const dur = t.completedAt && t.startedAt
      ? ((t.completedAt - t.startedAt) / 1000).toFixed(1)
      : '';
    const r = t.results || {} as Partial<TestResults>;
    return [
      t.id,
      t.type,
      t.scenarioName || '',
      t.cluster,
      t.status,
      new Date(t.startedAt).toISOString(),
      t.completedAt ? new Date(t.completedAt).toISOString() : '',
      dur,
      t.config?.vus ?? '',
      t.config?.duration ?? '',
      t.config?.targetUrl ?? '',
      t.stressConfig?.workers ?? '',
      t.stressConfig?.timeout ?? '',
      t.stressConfig?.vmBytes ?? '',
      r.p95Latency ?? '',
      r.p99Latency ?? '',
      r.avgLatency ?? '',
      r.errorRate ?? '',
      r.rps ?? '',
      r.totalRequests ?? '',
      r.cpuBogoOps ?? '',
      r.memoryBogoOps ?? '',
      r.scalingMeta?.scaleUpLatency ?? '',
      r.scalingMeta?.peakReplicas ?? '',
      r.scalingMeta?.scaleDownStarted ?? '',
      r.scalingMeta?.avgRpsPerPod != null ? r.scalingMeta.avgRpsPerPod.toFixed(1) : '',
      (t.error || '').replace(/"/g, '""'),
    ].map(v => `"${v}"`).join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}

function generateJobYaml(id: string, type: TestType, config?: CustomLoadConfig, stressConfig?: StressConfig): string {
  switch (type) {
    case 'load':
      return generateK6JobYaml(id, 50, '30s', 'http://nginx-web.demo.svc.cluster.local', config);
    case 'custom-load':
      return generateK6JobYaml(
        id,
        config?.vus ?? 50,
        config?.duration ?? '30s',
        config?.targetUrl ?? 'http://nginx-web.demo.svc.cluster.local',
        config,
      );
    case 'stress-cpu':
      return generateStressJobYaml(id, [
        '--cpu', String(stressConfig?.workers ?? 1),
        '--timeout', stressConfig?.timeout ?? '30s',
        '--metrics-brief',
      ]);
    case 'stress-memory':
      return generateStressJobYaml(id, [
        '--vm', String(stressConfig?.workers ?? 1),
        '--vm-bytes', stressConfig?.vmBytes ?? '64M',
        '--timeout', stressConfig?.timeout ?? '30s',
        '--metrics-brief',
      ]);
    case 'scaling-test':
      return generateK6JobYaml(
        id,
        config?.vus ?? 50,
        config?.duration ?? '60s',
        config?.targetUrl ?? 'http://nginx-web.demo.svc.cluster.local',
        config,
      );
    default:
      throw new Error(`Unknown test type: ${type}`);
  }
}

function generateK6JobYaml(id: string, vus: number, duration: string, targetUrl: string, config?: CustomLoadConfig): string {
  const thresholdP95 = config?.thresholdP95 ?? 2000;
  const thresholdErr = config?.thresholdErrorRate ?? 0.5;
  const rampUp = config?.rampUp;

  // Build options block
  let optionsBlock: string;
  if (rampUp) {
    // Ramped VU scenario: ramp up → sustain → ramp down
    optionsBlock = `
  stages: [
    { duration: '${rampUp}', target: ${vus} },
    { duration: '${duration}', target: ${vus} },
    { duration: '${rampUp}', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<${thresholdP95}'],
    http_req_failed: ['rate<${thresholdErr}'],
  },`;
  } else {
    optionsBlock = `
  vus: ${vus},
  duration: '${duration}',
  thresholds: {
    http_req_duration: ['p(95)<${thresholdP95}'],
    http_req_failed: ['rate<${thresholdErr}'],
  },`;
  }

  const scriptContent = `
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {${optionsBlock}
};

export default function () {
  const res = http.get('${targetUrl}');
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(0.1);
}
`.trim();

  return `
${SRE_TEST_NETWORK_POLICY}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${id}-script
  namespace: demo
data:
  loadtest.js: |
${scriptContent.split('\n').map(l => '    ' + l).join('\n')}
---
apiVersion: batch/v1
kind: Job
metadata:
  name: ${id}
  namespace: demo
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 300
  template:
    metadata:
      labels:
        sre-test: "true"
      annotations:
        sidecar.istio.io/inject: "false"
    spec:
      restartPolicy: Never
      containers:
        - name: k6
          image: grafana/k6:latest
          command: ["k6", "run", "--summary-trend-stats", "avg,min,med,max,p(90),p(95),p(99)", "/scripts/loadtest.js"]
          resources:
            requests:
              cpu: 100m
              memory: 64Mi
            limits:
              cpu: 500m
              memory: 256Mi
          volumeMounts:
            - name: script
              mountPath: /scripts
      volumes:
        - name: script
          configMap:
            name: ${id}-script
`.trim();
}

function generateStressJobYaml(id: string, args: string[]): string {
  return `
apiVersion: batch/v1
kind: Job
metadata:
  name: ${id}
  namespace: demo
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 300
  template:
    metadata:
      labels:
        sre-test: "true"
      annotations:
        sidecar.istio.io/inject: "false"
    spec:
      restartPolicy: Never
      containers:
        - name: stress
          image: alexeiled/stress-ng:latest
          args: ${JSON.stringify(args)}
          resources:
            requests:
              cpu: 50m
              memory: 32Mi
            limits:
              cpu: "1"
              memory: 256Mi
`.trim();
}

function startWatching(id: string, kubeconfig: string) {
  const POLL_MS = 2000;
  const TIMEOUT_MS = 5 * 60 * 1000;
  const startTime = Date.now();

  const interval = setInterval(async () => {
    const test = tests.get(id);
    if (!test || (test.status !== 'running' && test.status !== 'pending')) {
      clearInterval(interval);
      watchers.delete(id);
      return;
    }

    // Timeout
    if (Date.now() - startTime > TIMEOUT_MS) {
      test.status = 'failed';
      test.error = 'Timeout: test exceeded 5 minutes';
      test.completedAt = Date.now();
      clearInterval(interval);
      watchers.delete(id);
      // Cleanup
      execaCommand(
        `kubectl --kubeconfig ${kubeconfig} delete job ${id} -n demo --ignore-not-found`,
        { timeout: 10000 }
      ).catch(() => {});
      return;
    }

    try {
      // Check pod phase first (for more granular status)
      const { stdout: podJson } = await execaCommand(
        `kubectl --kubeconfig ${kubeconfig} get pods -n demo -l job-name=${id} -o json`,
        { timeout: 10000 }
      );
      const podData = JSON.parse(podJson);
      const pod = podData.items?.[0];

      if (pod) {
        const phase = pod.status?.phase;
        const containerState = pod.status?.containerStatuses?.[0]?.state;

        // Pod is still pending
        if (phase === 'Pending') {
          test.status = 'pending';
          return;
        }

        // Pod started running
        if (phase === 'Running') {
          test.status = 'running';
        }

        // Pod completed (Succeeded or Failed)
        if (phase === 'Succeeded' || phase === 'Failed') {
          clearInterval(interval);
          watchers.delete(id);
          await collectResults(id, kubeconfig, phase === 'Failed');
          return;
        }

        // Container terminated (even if pod phase is still Running due to sidecars)
        if (containerState?.terminated) {
          clearInterval(interval);
          watchers.delete(id);
          await collectResults(id, kubeconfig, containerState.terminated.exitCode !== 0);
          return;
        }
      }
    } catch {
      // Pod might not exist yet
    }
  }, POLL_MS);

  watchers.set(id, interval);
}

async function collectResults(id: string, kubeconfig: string, isFailed: boolean) {
  const test = tests.get(id);
  if (!test) return;

  try {
    // Get container name based on test type
    const container = (test.type === 'load' || test.type === 'custom-load' || test.type === 'scaling-test') ? 'k6' : 'stress';
    const { stdout: logs } = await execaCommand(
      `kubectl --kubeconfig ${kubeconfig} logs job/${id} -c ${container} -n demo --tail=500`,
      { timeout: 15000 }
    );

    let results: TestResults = { rawOutput: logs };

    if (test.type === 'load' || test.type === 'custom-load' || test.type === 'scaling-test') {
      results = { ...results, ...parseK6Output(logs) };
    } else if (test.type === 'stress-cpu' || test.type === 'stress-memory') {
      results = { ...results, ...parseStressNgOutput(logs) };
    }

    test.results = results;
    test.status = isFailed ? 'failed' : 'completed';
  } catch (e: any) {
    test.status = 'failed';
    test.error = `Failed to collect results: ${e.message}`;
  }

  test.completedAt = Date.now();

  // Cleanup configmap
  if (test.type === 'load' || test.type === 'custom-load' || test.type === 'scaling-test') {
    execaCommand(
      `kubectl --kubeconfig ${kubeconfig} delete configmap ${id}-script -n demo --ignore-not-found`,
      { timeout: 10000 }
    ).catch(() => {});
  }
}

// ========== Scaling Test Watcher ==========

function startWatchingScalingTest(id: string, kubeconfig: string, cluster: string, scalingConfig?: ScalingTestConfig) {
  const POLL_MS = 2000;
  const TIMEOUT_MS = 8 * 60 * 1000;
  const COOLDOWN_MS = (scalingConfig?.cooldownSec ?? 60) * 1000;
  const startTime = Date.now();

  const scalingSnapshots: ScalingDataPoint[] = [];
  let testStartTimestamp = 0;
  let testEndTimestamp = 0;
  const baselineReplicas: Record<string, number> = {};
  let k6Completed = false;
  let cooldownStartTime = 0;

  // Capture baseline
  const currentHistory = getScalingHistory(cluster);
  if (currentHistory.length > 0) {
    const latest = currentHistory[currentHistory.length - 1];
    for (const hpa of latest.hpas) {
      baselineReplicas[`${hpa.namespace}/${hpa.deployment}`] = hpa.currentReplicas;
    }
    scalingSnapshots.push(latest);
  }

  const interval = setInterval(async () => {
    const test = tests.get(id);
    if (!test) {
      clearInterval(interval);
      watchers.delete(id);
      return;
    }

    // Timeout guard
    if (Date.now() - startTime > TIMEOUT_MS) {
      test.status = 'failed';
      test.error = 'Timeout: scaling test exceeded 8 minutes';
      test.completedAt = Date.now();
      clearInterval(interval);
      watchers.delete(id);
      return;
    }

    // Capture scaling snapshot
    const history = getScalingHistory(cluster);
    if (history.length > 0) {
      const latest = history[history.length - 1];
      const lastCaptured = scalingSnapshots[scalingSnapshots.length - 1];
      if (!lastCaptured || latest.timestamp > lastCaptured.timestamp) {
        scalingSnapshots.push(latest);
      }
    }

    // Cooldown phase
    if (k6Completed) {
      if (Date.now() - cooldownStartTime >= COOLDOWN_MS) {
        clearInterval(interval);
        watchers.delete(id);

        const meta = calculateScalingMeta(
          scalingSnapshots, testStartTimestamp, testEndTimestamp, Date.now(),
          baselineReplicas, test.results?.rps ?? null,
          scalingConfig?.targetDeployments,
        );
        if (test.results) {
          test.results.scalingMeta = meta;
        }
        test.status = test.error ? 'failed' : 'completed';
        test.completedAt = Date.now();
      }
      return;
    }

    // Poll k6 pod status
    if (test.status !== 'running' && test.status !== 'pending') {
      clearInterval(interval);
      watchers.delete(id);
      return;
    }

    try {
      const { stdout: podJson } = await execaCommand(
        `kubectl --kubeconfig ${kubeconfig} get pods -n demo -l job-name=${id} -o json`,
        { timeout: 10000 }
      );
      const podData = JSON.parse(podJson);
      const pod = podData.items?.[0];

      if (pod) {
        const phase = pod.status?.phase;
        const containerState = pod.status?.containerStatuses?.[0]?.state;

        if (phase === 'Pending') {
          test.status = 'pending';
          return;
        }

        if (phase === 'Running' && !testStartTimestamp) {
          testStartTimestamp = Date.now();
          test.status = 'running';
        }

        if (phase === 'Succeeded' || phase === 'Failed' || containerState?.terminated) {
          const isFailed = phase === 'Failed' || (containerState?.terminated?.exitCode !== 0);
          testEndTimestamp = Date.now();
          k6Completed = true;
          cooldownStartTime = Date.now();

          // Collect k6 results, but keep status as 'running' during cooldown
          await collectResults(id, kubeconfig, isFailed);
          // Override status back — collectResults sets completed/failed, but we need cooldown
          test.status = 'running';
          test.completedAt = undefined;
          return;
        }
      }
    } catch {
      // Pod might not exist yet
    }
  }, POLL_MS);

  watchers.set(id, interval);
}

function calculateScalingMeta(
  snapshots: ScalingDataPoint[],
  testStart: number,
  testEnd: number,
  cooldownEnd: number,
  baselineReplicas: Record<string, number>,
  rps: number | null,
  targetDeployments?: string[],
): ScalingTestMeta {
  const filterHpas = (hpas: HpaSnapshot[]) => {
    if (!targetDeployments || targetDeployments.length === 0) return hpas;
    return hpas.filter(h => targetDeployments.includes(h.deployment));
  };

  // scaleUpLatency
  let scaleUpLatency: number | null = null;
  for (const point of snapshots) {
    if (point.timestamp < testStart) continue;
    for (const hpa of filterHpas(point.hpas)) {
      const key = `${hpa.namespace}/${hpa.deployment}`;
      const baseline = baselineReplicas[key];
      if (baseline !== undefined && hpa.currentReplicas > baseline) {
        scaleUpLatency = point.timestamp - testStart;
        break;
      }
    }
    if (scaleUpLatency !== null) break;
  }

  // peakReplicas
  let peakReplicas = 0;
  for (const point of snapshots) {
    const total = filterHpas(point.hpas).reduce((s, h) => s + h.currentReplicas, 0);
    peakReplicas = Math.max(peakReplicas, total);
  }

  // scaleDownStarted
  let scaleDownStarted: number | null = null;
  const peakMap: Record<string, number> = {};
  for (const point of snapshots) {
    if (point.timestamp > testEnd) break;
    for (const hpa of filterHpas(point.hpas)) {
      const key = `${hpa.namespace}/${hpa.deployment}`;
      peakMap[key] = Math.max(peakMap[key] ?? 0, hpa.currentReplicas);
    }
  }
  for (const point of snapshots) {
    if (point.timestamp <= testEnd) continue;
    for (const hpa of filterHpas(point.hpas)) {
      const key = `${hpa.namespace}/${hpa.deployment}`;
      if (peakMap[key] !== undefined && hpa.currentReplicas < peakMap[key]) {
        scaleDownStarted = point.timestamp - testEnd;
        break;
      }
    }
    if (scaleDownStarted !== null) break;
  }

  // avgRpsPerPod
  let avgRpsPerPod: number | null = null;
  if (rps !== null) {
    const testSnaps = snapshots.filter(p => p.timestamp >= testStart && p.timestamp <= testEnd);
    if (testSnaps.length > 0) {
      const avgReplicas = testSnaps.reduce((s, p) =>
        s + filterHpas(p.hpas).reduce((sum, h) => sum + h.currentReplicas, 0), 0
      ) / testSnaps.length;
      if (avgReplicas > 0) avgRpsPerPod = rps / avgReplicas;
    }
  }

  const allDeploys = new Set<string>();
  for (const point of snapshots) {
    for (const hpa of filterHpas(point.hpas)) allDeploys.add(hpa.deployment);
  }

  return {
    scalingSnapshots: snapshots,
    testStartTimestamp: testStart,
    testEndTimestamp: testEnd,
    cooldownEndTimestamp: cooldownEnd,
    scaleUpLatency,
    peakReplicas,
    scaleDownStarted,
    avgRpsPerPod,
    targetDeployments: Array.from(allDeploys),
  };
}
