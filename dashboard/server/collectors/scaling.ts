import { execaCommand } from 'execa';
import { getKubeconfigPath, getClusterConfigs } from '../config.js';

export interface HpaSnapshot {
  name: string;
  namespace: string;
  deployment: string;
  currentReplicas: number;
  desiredReplicas: number;
  minReplicas: number;
  maxReplicas: number;
  currentCpuPercent: number | null;
  targetCpuPercent: number;
}

export interface ScalingDataPoint {
  timestamp: number;
  hpas: HpaSnapshot[];
}

// Per-cluster time-series: last 30 minutes of data at ~5s granularity = ~360 points
const MAX_POINTS = 360;
const scalingHistory = new Map<string, ScalingDataPoint[]>();

export function getScalingHistory(cluster: string): ScalingDataPoint[] {
  return scalingHistory.get(cluster) || [];
}

export function getAllScalingHistory(): Record<string, ScalingDataPoint[]> {
  const result: Record<string, ScalingDataPoint[]> = {};
  for (const [k, v] of scalingHistory) {
    result[k] = v;
  }
  return result;
}

export async function collectScaling(cluster: string): Promise<void> {
  const kubeconfig = getKubeconfigPath(cluster);

  try {
    const { stdout } = await execaCommand(
      `kubectl --kubeconfig ${kubeconfig} get hpa -A -o json`,
      { timeout: 10000 }
    );

    const data = JSON.parse(stdout);
    const hpas: HpaSnapshot[] = [];

    for (const item of data.items || []) {
      const spec = item.spec || {};
      const status = item.status || {};
      const metrics = spec.metrics || [];

      // Find CPU target
      let targetCpu = 50;
      for (const m of metrics) {
        if (m.type === 'Resource' && m.resource?.name === 'cpu') {
          targetCpu = m.resource.target?.averageUtilization ?? 50;
        }
      }

      // Find current CPU from status
      let currentCpu: number | null = null;
      for (const m of status.currentMetrics || []) {
        if (m.type === 'Resource' && m.resource?.name === 'cpu') {
          currentCpu = m.resource.current?.averageUtilization ?? null;
        }
      }

      hpas.push({
        name: item.metadata.name,
        namespace: item.metadata.namespace,
        deployment: spec.scaleTargetRef?.name || 'unknown',
        currentReplicas: status.currentReplicas ?? 0,
        desiredReplicas: status.desiredReplicas ?? 0,
        minReplicas: spec.minReplicas ?? 1,
        maxReplicas: spec.maxReplicas ?? 1,
        currentCpuPercent: currentCpu,
        targetCpuPercent: targetCpu,
      });
    }

    const point: ScalingDataPoint = {
      timestamp: Date.now(),
      hpas,
    };

    let history = scalingHistory.get(cluster);
    if (!history) {
      history = [];
      scalingHistory.set(cluster, history);
    }
    history.push(point);
    if (history.length > MAX_POINTS) {
      history.splice(0, history.length - MAX_POINTS);
    }
  } catch (e: any) {
    // Cluster might not be reachable
    console.log(`[scaling] ${cluster}: ${e.message?.substring(0, 80)}`);
  }
}

export async function collectAllScaling(): Promise<void> {
  const configs = getClusterConfigs();
  await Promise.allSettled(configs.map(c => collectScaling(c.name)));
}
