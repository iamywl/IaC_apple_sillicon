import type { DashboardSnapshot, VmResources, PortInfo, NetworkStats } from '../shared/types.js';
import { collectVmInfo } from './collectors/tart.js';
import { sshPool } from './collectors/ssh.js';
import { collectClusterInfo, collectPods } from './collectors/kubectl.js';
import { getClusterConfigs } from './config.js';
import { parseCpuUsage } from './parsers/top.js';
import { parseMemory } from './parsers/free.js';
import { parseDisk } from './parsers/df.js';
import { parsePorts } from './parsers/ss.js';
import { parseNetDev } from './parsers/netdev.js';

const INTERVAL = 5000;
let snapshot: DashboardSnapshot = {
  vms: [],
  vmResources: {},
  vmPorts: {},
  vmNetwork: {},
  clusters: [],
  clusterPods: {},
  collectedAt: 0,
  errors: [],
};

// Store previous network readings for rate calculation
const prevNetReadings = new Map<string, { time: number; interfaces: Record<string, { rxBytes: number; txBytes: number }> }>();

export function getSnapshot(): DashboardSnapshot {
  return snapshot;
}

async function collectVmResources(ip: string): Promise<VmResources> {
  const [topOut, freeOut, dfOut] = await Promise.all([
    sshPool.exec(ip, 'top -bn1 | head -5'),
    sshPool.exec(ip, 'free -m'),
    sshPool.exec(ip, 'df / --output=size,used,avail,pcent | tail -1'),
  ]);

  const cpu = parseCpuUsage(topOut);
  const mem = parseMemory(freeOut);
  const disk = parseDisk(dfOut);

  return {
    cpuPercent: cpu,
    memoryPercent: mem.percent,
    memoryUsedMb: mem.usedMb,
    memoryTotalMb: mem.totalMb,
    diskPercent: disk.percent,
    diskUsedGb: disk.usedGb,
    diskTotalGb: disk.totalGb,
  };
}

async function collectVmPorts(ip: string): Promise<PortInfo[]> {
  const out = await sshPool.exec(ip, 'sudo ss -tlnp 2>/dev/null || ss -tlnp');
  return parsePorts(out);
}

async function collectVmNetwork(vmName: string, ip: string): Promise<NetworkStats> {
  const out = await sshPool.exec(ip, 'cat /proc/net/dev');
  const interfaces = parseNetDev(out);

  const now = Date.now();
  const prev = prevNetReadings.get(vmName);
  let rxBytesPerSec = 0;
  let txBytesPerSec = 0;

  if (prev) {
    const elapsed = (now - prev.time) / 1000;
    if (elapsed > 0) {
      for (const [iface, curr] of Object.entries(interfaces)) {
        const p = prev.interfaces[iface];
        if (p) {
          rxBytesPerSec += (curr.rxBytes - p.rxBytes) / elapsed;
          txBytesPerSec += (curr.txBytes - p.txBytes) / elapsed;
        }
      }
    }
  }

  prevNetReadings.set(vmName, { time: now, interfaces });

  return {
    interfaces,
    rxBytesPerSec: Math.max(0, Math.round(rxBytesPerSec)),
    txBytesPerSec: Math.max(0, Math.round(txBytesPerSec)),
  };
}

async function collect(): Promise<void> {
  const errors: { source: string; message: string }[] = [];

  // 1. Collect VM info (tart list + ip)
  let vms = snapshot.vms;
  try {
    vms = await collectVmInfo();
  } catch (e: any) {
    errors.push({ source: 'tart', message: e.message });
  }

  // 2. For running VMs, collect resources/ports/network via SSH
  const vmResources: Record<string, VmResources> = {};
  const vmPorts: Record<string, PortInfo[]> = {};
  const vmNetwork: Record<string, NetworkStats> = {};

  const runningVms = vms.filter(v => v.status === 'running' && v.ip);
  const sshResults = await Promise.allSettled(
    runningVms.map(async (vm) => {
      const [resources, ports, network] = await Promise.allSettled([
        collectVmResources(vm.ip!),
        collectVmPorts(vm.ip!),
        collectVmNetwork(vm.name, vm.ip!),
      ]);
      if (resources.status === 'fulfilled') vmResources[vm.name] = resources.value;
      else errors.push({ source: `ssh:${vm.name}:resources`, message: resources.reason?.message || 'failed' });

      if (ports.status === 'fulfilled') vmPorts[vm.name] = ports.value;
      else errors.push({ source: `ssh:${vm.name}:ports`, message: ports.reason?.message || 'failed' });

      if (network.status === 'fulfilled') vmNetwork[vm.name] = network.value;
      else errors.push({ source: `ssh:${vm.name}:network`, message: network.reason?.message || 'failed' });
    })
  );

  // 3. Collect cluster info
  let clusters = snapshot.clusters;
  try {
    clusters = await collectClusterInfo();
  } catch (e: any) {
    errors.push({ source: 'kubectl', message: e.message });
  }

  // 4. Collect pods per cluster
  const clusterPods: Record<string, import('../shared/types.js').PodInfo[]> = {};
  const clusterConfigs = getClusterConfigs();
  const podResults = await Promise.allSettled(
    clusterConfigs.map(async (c) => {
      clusterPods[c.name] = await collectPods(c.name);
    })
  );

  snapshot = {
    vms,
    vmResources,
    vmPorts,
    vmNetwork,
    clusters,
    clusterPods,
    collectedAt: Date.now(),
    errors,
  };

  const vmCount = vms.length;
  const running = vms.filter(v => v.status === 'running').length;
  const errCount = errors.length;
  console.log(`[collector] ${new Date().toLocaleTimeString()} | VMs: ${running}/${vmCount} running | Errors: ${errCount}`);
}

let intervalId: NodeJS.Timeout | null = null;

export function startCollector() {
  console.log('[collector] starting background collection (5s interval)');
  collect();
  intervalId = setInterval(collect, INTERVAL);
}

export function stopCollector() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  sshPool.closeAll();
}
