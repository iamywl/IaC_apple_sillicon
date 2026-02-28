import { execaCommand } from 'execa';
import { getKubeconfigPath } from '../config.js';
import type { ServiceInfo } from '../../shared/types.js';

// Cache per cluster
const servicesCache = new Map<string, ServiceInfo[]>();

export function getCachedServices(cluster: string): ServiceInfo[] {
  return servicesCache.get(cluster) || [];
}

export async function collectServices(cluster: string): Promise<ServiceInfo[]> {
  const kubeconfig = getKubeconfigPath(cluster);
  const services: ServiceInfo[] = [];

  try {
    const [svcResult, epResult] = await Promise.all([
      execaCommand(
        `kubectl --kubeconfig ${kubeconfig} get services -A -o json`,
        { timeout: 10000 }
      ),
      execaCommand(
        `kubectl --kubeconfig ${kubeconfig} get endpoints -A -o json`,
        { timeout: 10000 }
      ),
    ]);

    const svcData = JSON.parse(svcResult.stdout);
    const epData = JSON.parse(epResult.stdout);

    // Build endpoints map: namespace/name -> addresses
    const endpointsMap = new Map<string, string[]>();
    for (const ep of epData.items || []) {
      const key = `${ep.metadata.namespace}/${ep.metadata.name}`;
      const addresses: string[] = [];
      for (const subset of ep.subsets || []) {
        for (const addr of subset.addresses || []) {
          addresses.push(addr.ip + (addr.targetRef?.name ? ` (${addr.targetRef.name})` : ''));
        }
      }
      endpointsMap.set(key, addresses);
    }

    // Parse services
    for (const item of svcData.items || []) {
      const ns = item.metadata.namespace;
      const name = item.metadata.name;
      const epKey = `${ns}/${name}`;

      services.push({
        name,
        namespace: ns,
        type: item.spec.type || 'ClusterIP',
        clusterIp: item.spec.clusterIP || 'None',
        ports: (item.spec.ports || []).map((p: any) => ({
          port: p.port,
          targetPort: p.targetPort,
          nodePort: p.nodePort || undefined,
          protocol: p.protocol || 'TCP',
        })),
        endpoints: endpointsMap.get(epKey) || [],
      });
    }
  } catch (e: any) {
    console.log(`[services] ${cluster}: ${e.message?.substring(0, 80)}`);
  }

  servicesCache.set(cluster, services);
  return services;
}
