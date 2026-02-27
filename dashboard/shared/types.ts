export interface VmInfo {
  name: string;
  status: 'running' | 'stopped';
  ip: string | null;
  cluster: string;
  role: 'master' | 'worker';
  specs: { cpu: number; memoryMb: number; diskGb: number };
}

export interface VmResources {
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  diskPercent: number;
  diskUsedGb: number;
  diskTotalGb: number;
}

export interface PortInfo {
  port: number;
  address: string;
  process: string;
  state: string;
}

export interface NetworkStats {
  interfaces: Record<string, { rxBytes: number; txBytes: number }>;
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

export interface ClusterInfo {
  name: string;
  podCidr: string;
  serviceCidr: string;
  nodes: NodeInfo[];
  reachable: boolean;
}

export interface NodeInfo {
  name: string;
  status: 'Ready' | 'NotReady' | 'Unknown';
  roles: string[];
  kubeletVersion: string;
  internalIp: string;
}

export interface PodInfo {
  name: string;
  namespace: string;
  status: string;
  nodeName: string;
  restarts: number;
  age: string;
  cpuRequest?: string;
  memoryRequest?: string;
}

export interface DashboardSnapshot {
  vms: VmInfo[];
  vmResources: Record<string, VmResources>;
  vmPorts: Record<string, PortInfo[]>;
  vmNetwork: Record<string, NetworkStats>;
  clusters: ClusterInfo[];
  clusterPods: Record<string, PodInfo[]>;
  collectedAt: number;
  errors: { source: string; message: string }[];
}
