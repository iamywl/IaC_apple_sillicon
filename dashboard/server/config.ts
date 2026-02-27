import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../');

interface NodeConfig {
  name: string;
  role: 'master' | 'worker';
  cpu: number;
  memory: number;
  disk: number;
}

interface ClusterConfig {
  name: string;
  pod_cidr: string;
  service_cidr: string;
  nodes: NodeConfig[];
}

interface ClustersJson {
  base_image: string;
  ssh_user: string;
  ssh_password: string;
  clusters: ClusterConfig[];
}

let cached: ClustersJson | null = null;

export function loadConfig(): ClustersJson {
  if (cached) return cached;
  const raw = readFileSync(resolve(PROJECT_ROOT, 'config/clusters.json'), 'utf-8');
  cached = JSON.parse(raw) as ClustersJson;
  return cached;
}

export function getKubeconfigPath(clusterName: string): string {
  return resolve(PROJECT_ROOT, `kubeconfig/${clusterName}.yaml`);
}

export function getSshCredentials() {
  const cfg = loadConfig();
  return { user: cfg.ssh_user, password: cfg.ssh_password };
}

export function getAllVmNames(): string[] {
  const cfg = loadConfig();
  return cfg.clusters.flatMap(c => c.nodes.map(n => n.name));
}

export function getVmClusterMap(): Record<string, { cluster: string; role: 'master' | 'worker'; cpu: number; memoryMb: number; diskGb: number }> {
  const cfg = loadConfig();
  const map: Record<string, { cluster: string; role: 'master' | 'worker'; cpu: number; memoryMb: number; diskGb: number }> = {};
  for (const c of cfg.clusters) {
    for (const n of c.nodes) {
      map[n.name] = { cluster: c.name, role: n.role, cpu: n.cpu, memoryMb: n.memory, diskGb: n.disk };
    }
  }
  return map;
}

export function getClusterConfigs() {
  return loadConfig().clusters;
}
