import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import type { DashboardSnapshot, NamespacePodCount } from '../../shared/types.js';

interface Props {
  data: DashboardSnapshot;
}

const clusterColors: Record<string, string> = {
  platform: 'border-purple-500 hover:border-purple-400',
  dev: 'border-blue-500 hover:border-blue-400',
  staging: 'border-green-500 hover:border-green-400',
  prod: 'border-red-500 hover:border-red-400',
};

const clusterBg: Record<string, string> = {
  platform: 'from-purple-500/5',
  dev: 'from-blue-500/5',
  staging: 'from-green-500/5',
  prod: 'from-red-500/5',
};

export function OverviewPage({ data }: Props) {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-slate-100">Cluster Overview</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.clusters.map(cluster => {
          const pods = data.clusterPods[cluster.name] || [];
          const vms = data.vms.filter(v => v.cluster === cluster.name);
          const readyNodes = cluster.nodes.filter(n => n.status === 'Ready').length;

          // Pod status counts
          const podsByStatus: Record<string, number> = {};
          for (const p of pods) {
            podsByStatus[p.status] = (podsByStatus[p.status] || 0) + 1;
          }

          // Average CPU/Memory from VMs
          const vmResources = vms
            .map(v => data.vmResources[v.name])
            .filter(Boolean);
          const avgCpu = vmResources.length
            ? vmResources.reduce((s, r) => s + r.cpuPercent, 0) / vmResources.length
            : 0;
          const avgMem = vmResources.length
            ? vmResources.reduce((s, r) => s + r.memoryPercent, 0) / vmResources.length
            : 0;
          const totalMemUsed = vmResources.reduce((s, r) => s + r.memoryUsedMb, 0);
          const totalMemTotal = vmResources.reduce((s, r) => s + r.memoryTotalMb, 0);

          // Namespace breakdown
          const nsMap = new Map<string, NamespacePodCount>();
          for (const p of pods) {
            if (!nsMap.has(p.namespace)) {
              nsMap.set(p.namespace, { namespace: p.namespace, total: 0, running: 0, pending: 0, failed: 0 });
            }
            const ns = nsMap.get(p.namespace)!;
            ns.total++;
            if (p.status === 'Running' || p.status === 'Succeeded') ns.running++;
            else if (p.status === 'Pending') ns.pending++;
            else if (p.status === 'Failed' || p.status === 'CrashLoopBackOff' || p.status === 'Error') ns.failed++;
          }
          const namespaces = Array.from(nsMap.values()).sort((a, b) => b.total - a.total);

          return (
            <ClusterSummaryCard
              key={cluster.name}
              name={cluster.name}
              reachable={cluster.reachable}
              nodeCount={cluster.nodes.length}
              readyNodeCount={readyNodes}
              podsByStatus={podsByStatus}
              avgCpu={avgCpu}
              avgMem={avgMem}
              totalMemUsedMb={totalMemUsed}
              totalMemTotalMb={totalMemTotal}
              namespaces={namespaces}
              onClick={() => navigate(`/cluster/${cluster.name}`)}
            />
          );
        })}
      </div>
    </div>
  );
}

interface CardProps {
  name: string;
  reachable: boolean;
  nodeCount: number;
  readyNodeCount: number;
  podsByStatus: Record<string, number>;
  avgCpu: number;
  avgMem: number;
  totalMemUsedMb: number;
  totalMemTotalMb: number;
  namespaces: NamespacePodCount[];
  onClick: () => void;
}

function ClusterSummaryCard({
  name, reachable, nodeCount, readyNodeCount,
  podsByStatus, avgCpu, avgMem, totalMemUsedMb, totalMemTotalMb,
  namespaces, onClick,
}: CardProps) {
  const [expanded, setExpanded] = useState(false);
  const totalPods = Object.values(podsByStatus).reduce((s, n) => s + n, 0);
  const runningPods = (podsByStatus['Running'] || 0) + (podsByStatus['Succeeded'] || 0);
  const pendingPods = podsByStatus['Pending'] || 0;
  const failedPods = (podsByStatus['Failed'] || 0) + (podsByStatus['CrashLoopBackOff'] || 0) + (podsByStatus['Error'] || 0);

  const statusColor = !reachable ? 'bg-red-500' : readyNodeCount === nodeCount ? 'bg-green-500' : 'bg-yellow-500';

  return (
    <div
      className={`rounded-lg border-l-4 border border-slate-700 ${clusterColors[name] || 'border-slate-500'} bg-gradient-to-br ${clusterBg[name] || ''} to-transparent bg-slate-900/50 cursor-pointer transition-all hover:bg-slate-800/50`}
    >
      <div className="p-4" onClick={onClick}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
            <h3 className="text-lg font-bold text-white capitalize">{name}</h3>
          </div>
          <div className="flex gap-2">
            <span className="text-xs bg-slate-800 px-2 py-1 rounded">
              <span className={readyNodeCount === nodeCount ? 'text-green-400' : 'text-yellow-400'}>{readyNodeCount}</span>
              <span className="text-slate-500">/{nodeCount} nodes</span>
            </span>
          </div>
        </div>

        {/* Pod Status Badges */}
        <div className="flex gap-2 mb-3">
          <span className="text-xs bg-green-500/15 text-green-400 px-2 py-0.5 rounded">{runningPods} Running</span>
          {pendingPods > 0 && <span className="text-xs bg-yellow-500/15 text-yellow-400 px-2 py-0.5 rounded">{pendingPods} Pending</span>}
          {failedPods > 0 && <span className="text-xs bg-red-500/15 text-red-400 px-2 py-0.5 rounded">{failedPods} Failed</span>}
          <span className="text-xs text-slate-500">{totalPods} total</span>
        </div>

        {/* CPU / Memory Bars */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>CPU</span>
              <span>{avgCpu.toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${avgCpu > 90 ? 'bg-red-500' : avgCpu > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${Math.min(avgCpu, 100)}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>Memory</span>
              <span>{avgMem.toFixed(1)}% ({(totalMemUsedMb / 1024).toFixed(1)}G / {(totalMemTotalMb / 1024).toFixed(1)}G)</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${avgMem > 90 ? 'bg-red-500' : avgMem > 70 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(avgMem, 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Namespace Breakdown (collapsible) */}
      <div className="border-t border-slate-800">
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="w-full px-4 py-2 text-xs text-slate-400 hover:text-white flex items-center gap-1"
        >
          <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" />
          </svg>
          {namespaces.length} namespaces
        </button>
        {expanded && (
          <div className="px-4 pb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left py-1">Namespace</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Running</th>
                  <th className="text-right">Pending</th>
                  <th className="text-right">Failed</th>
                </tr>
              </thead>
              <tbody>
                {namespaces.map(ns => (
                  <tr key={ns.namespace} className="text-slate-300">
                    <td className="py-0.5 font-mono">{ns.namespace}</td>
                    <td className="text-right">{ns.total}</td>
                    <td className="text-right text-green-400">{ns.running || '-'}</td>
                    <td className="text-right text-yellow-400">{ns.pending || '-'}</td>
                    <td className="text-right text-red-400">{ns.failed || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
