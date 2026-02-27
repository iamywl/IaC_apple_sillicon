import { execaCommand } from 'execa';
import type { VmInfo } from '../../shared/types.js';
import { getVmClusterMap } from '../config.js';

interface TartVmRaw {
  name: string;
  status: 'running' | 'stopped';
  cpu: number;
  memory: number;
  disk: number;
}

export async function getTartVmList(): Promise<TartVmRaw[]> {
  // tart list format: Source Name Disk Size Accessed State
  // State is always the last word (running/stopped)
  const { stdout } = await execaCommand('tart list', { timeout: 10000 });
  const lines = stdout.trim().split('\n').slice(1);
  return lines
    .filter(l => l.startsWith('local'))
    .map(line => {
      const parts = line.split(/\s+/);
      const name = parts[1];
      const disk = parseInt(parts[2]) || 0;
      const state = parts[parts.length - 1] as 'running' | 'stopped';
      return {
        name,
        status: state,
        cpu: 0,
        memory: 0,
        disk,
      };
    });
}

export async function getTartVmIp(vmName: string): Promise<string | null> {
  try {
    const { stdout } = await execaCommand(`tart ip ${vmName}`, { timeout: 5000 });
    const ip = stdout.trim();
    return ip || null;
  } catch {
    return null;
  }
}

export async function collectVmInfo(): Promise<VmInfo[]> {
  const clusterMap = getVmClusterMap();
  const rawList = await getTartVmList();

  const vms: VmInfo[] = await Promise.all(
    rawList
      .filter(vm => clusterMap[vm.name])
      .map(async (vm) => {
        const meta = clusterMap[vm.name];
        const ip = vm.status === 'running' ? await getTartVmIp(vm.name) : null;
        return {
          name: vm.name,
          status: vm.status,
          ip,
          cluster: meta.cluster,
          role: meta.role,
          specs: { cpu: meta.cpu, memoryMb: meta.memoryMb, diskGb: meta.diskGb },
        };
      })
  );

  return vms;
}
