import { StatusDot } from '../common/StatusDot.js';
import { NodeCard } from './NodeCard.js';
import type { ClusterInfo, VmInfo, VmResources, PortInfo, NetworkStats, PodInfo } from '../../../shared/types.js';

interface Props {
  cluster: ClusterInfo;
  vms: VmInfo[];
  vmResources: Record<string, VmResources>;
  vmPorts: Record<string, PortInfo[]>;
  vmNetwork: Record<string, NetworkStats>;
  networkHistory: Record<string, { rx: number[]; tx: number[] }>;
  pods: PodInfo[];
}

export function ClusterCard({ cluster, vms, vmResources, vmPorts, vmNetwork, networkHistory, pods }: Props) {
  const readyNodes = cluster.nodes.filter(n => n.status === 'Ready').length;
  const totalNodes = cluster.nodes.length;
  const totalPods = pods.length;
  const runningPods = pods.filter(p => p.status === 'Running' || p.status === 'Succeeded').length;

  const clusterStatus = !cluster.reachable ? 'down' : readyNodes === totalNodes ? 'healthy' : 'degraded';

  const roleColors: Record<string, string> = {
    platform: 'border-l-purple-500',
    dev: 'border-l-blue-500',
    staging: 'border-l-green-500',
  };

  return (
    <div className={`rounded-lg border border-slate-700 bg-slate-900/50 border-l-4 ${roleColors[cluster.name] || 'border-l-slate-500'}`}>
      {/* Cluster Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <StatusDot status={clusterStatus} />
          <div>
            <h2 className="text-base font-bold text-white capitalize">{cluster.name}</h2>
            <div className="text-xs text-slate-400">
              Pod CIDR: {cluster.podCidr} | Service CIDR: {cluster.serviceCidr}
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <span className="text-xs bg-slate-800 px-2 py-1 rounded">
            <span className={readyNodes === totalNodes ? 'text-green-400' : 'text-yellow-400'}>{readyNodes}</span>
            <span className="text-slate-500">/{totalNodes} nodes</span>
          </span>
          <span className="text-xs bg-slate-800 px-2 py-1 rounded">
            <span className={runningPods === totalPods ? 'text-green-400' : 'text-yellow-400'}>{runningPods}</span>
            <span className="text-slate-500">/{totalPods} pods</span>
          </span>
        </div>
      </div>

      {/* Nodes */}
      <div className="p-3 space-y-2">
        {cluster.nodes.map(node => {
          const vm = vms.find(v => v.name === node.name);
          if (!vm) return null;
          return (
            <NodeCard
              key={node.name}
              vm={vm}
              resources={vmResources[node.name]}
              ports={vmPorts[node.name]}
              network={vmNetwork[node.name]}
              networkHistory={networkHistory[node.name] || { rx: [], tx: [] }}
              pods={pods.filter(p => p.nodeName === node.name)}
            />
          );
        })}
      </div>
    </div>
  );
}
