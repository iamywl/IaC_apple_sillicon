import { execaCommand } from 'execa';
import { getKubeconfigPath, getClusterConfigs } from '../config.js';
import type { ClusterInfo, NodeInfo, PodInfo } from '../../shared/types.js';

export async function collectClusterInfo(): Promise<ClusterInfo[]> {
  const configs = getClusterConfigs();
  const results = await Promise.allSettled(
    configs.map(async (c) => {
      const kubeconfig = getKubeconfigPath(c.name);
      const nodesJson = await execaCommand(
        `kubectl --kubeconfig ${kubeconfig} get nodes -o json`,
        { timeout: 10000 }
      );
      const nodesData = JSON.parse(nodesJson.stdout);
      const nodes: NodeInfo[] = nodesData.items.map((item: any) => {
        const readyCond = item.status.conditions?.find((c: any) => c.type === 'Ready');
        const ipAddr = item.status.addresses?.find((a: any) => a.type === 'InternalIP');
        const roles = Object.keys(item.metadata.labels || {})
          .filter(k => k.startsWith('node-role.kubernetes.io/'))
          .map(k => k.replace('node-role.kubernetes.io/', ''));
        return {
          name: item.metadata.name,
          status: readyCond?.status === 'True' ? 'Ready' : 'NotReady',
          roles: roles.length ? roles : ['worker'],
          kubeletVersion: item.status.nodeInfo?.kubeletVersion || '',
          internalIp: ipAddr?.address || '',
        };
      });
      return {
        name: c.name,
        podCidr: c.pod_cidr,
        serviceCidr: c.service_cidr,
        nodes,
        reachable: true,
      };
    })
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      name: configs[i].name,
      podCidr: configs[i].pod_cidr,
      serviceCidr: configs[i].service_cidr,
      nodes: [],
      reachable: false,
    };
  });
}

export async function collectPods(clusterName: string): Promise<PodInfo[]> {
  try {
    const kubeconfig = getKubeconfigPath(clusterName);
    const { stdout } = await execaCommand(
      `kubectl --kubeconfig ${kubeconfig} get pods -A -o json`,
      { timeout: 10000 }
    );
    const data = JSON.parse(stdout);
    return data.items.map((item: any) => {
      const containers = item.spec.containers || [];
      const statuses = item.status.containerStatuses || [];
      const restarts = statuses.reduce((sum: number, s: any) => sum + (s.restartCount || 0), 0);
      const createdAt = new Date(item.metadata.creationTimestamp);
      const age = formatAge(Date.now() - createdAt.getTime());
      const cpuReq = containers.reduce((acc: string, c: any) => c.resources?.requests?.cpu || acc, '');
      const memReq = containers.reduce((acc: string, c: any) => c.resources?.requests?.memory || acc, '');
      return {
        name: item.metadata.name,
        namespace: item.metadata.namespace,
        status: item.status.phase || 'Unknown',
        nodeName: item.spec.nodeName || '',
        restarts,
        age,
        cpuRequest: cpuReq || undefined,
        memoryRequest: memReq || undefined,
      };
    });
  } catch {
    return [];
  }
}

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
