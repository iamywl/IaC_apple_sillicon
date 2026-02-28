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

// ========== Enhanced Cluster Overview ==========
export interface NamespacePodCount {
  namespace: string;
  total: number;
  running: number;
  pending: number;
  failed: number;
}

// ========== SRE Testing ==========
export type TestType = 'load' | 'stress-cpu' | 'stress-memory' | 'custom-load' | 'scaling-test';
export type TestStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface TestRun {
  id: string;
  type: TestType;
  cluster: string;
  status: TestStatus;
  startedAt: number;
  completedAt?: number;
  results?: TestResults;
  error?: string;
  config?: CustomLoadConfig;
  stressConfig?: StressConfig;
  scalingConfig?: ScalingTestConfig;
  scenarioName?: string;
}

export interface TestResults {
  p95Latency?: number;
  p99Latency?: number;
  avgLatency?: number;
  errorRate?: number;
  rps?: number;
  totalRequests?: number;
  cpuBogoOps?: number;
  memoryBogoOps?: number;
  rawOutput: string;
  scalingMeta?: ScalingTestMeta;
}

export interface CustomLoadConfig {
  vus: number;
  duration: string;
  targetUrl: string;
  rampUp?: string;           // k6 ramp-up stage duration (e.g. "10s")
  thresholdP95?: number;     // p95 latency threshold in ms (default: 2000)
  thresholdErrorRate?: number; // error rate threshold (default: 0.5)
}

export interface StressConfig {
  workers: number;            // number of stressors (--cpu N or --vm N)
  timeout: string;            // duration (e.g. "30s", "1m")
  vmBytes?: string;           // for memory stress (e.g. "64M", "128M")
}

export interface ScalingTestConfig extends CustomLoadConfig {
  cooldownSec: number;
  targetDeployments?: string[];
}

export interface ScalingTestMeta {
  scalingSnapshots: ScalingDataPoint[];
  testStartTimestamp: number;
  testEndTimestamp: number;
  cooldownEndTimestamp: number;
  scaleUpLatency: number | null;
  peakReplicas: number;
  scaleDownStarted: number | null;
  avgRpsPerPod: number | null;
  targetDeployments: string[];
}

export interface TestScenario {
  name: string;
  description: string;
  type: TestType;
  config?: CustomLoadConfig;
  stressConfig?: StressConfig;
  scalingConfig?: ScalingTestConfig;
}

// ========== Traffic Flow ==========
export interface TrafficFlow {
  id: string;
  timestamp: number;
  sourceNamespace: string;
  sourcePod: string;
  destinationNamespace: string;
  destinationPod: string;
  destinationPort: number;
  protocol: string;
  l7Protocol?: string;
  verdict: 'FORWARDED' | 'DROPPED' | 'ERROR';
  httpStatusCode?: number;
}

export interface TrafficSummary {
  flows: TrafficFlow[];
  aggregated: AggregatedEdge[];
  collectedAt: number;
  cluster: string;
}

export interface AggregatedEdge {
  sourceKey: string;
  destinationKey: string;
  flowCount: number;
  forwardedCount: number;
  droppedCount: number;
  protocols: string[];
}

// ========== Service Info ==========
export interface ServiceInfo {
  name: string;
  namespace: string;
  type: string;
  clusterIp: string;
  ports: { port: number; targetPort: number | string; nodePort?: number; protocol: string }[];
  endpoints: string[];
}

// ========== Scaling History ==========
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

// ========== Enhanced Network ==========
export interface ConnectionInfo {
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
  process: string;
}
