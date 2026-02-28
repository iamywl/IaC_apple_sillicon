import { useParams, Link } from 'react-router-dom';
import { ClusterCard } from '../components/cluster/ClusterCard.js';
import { usePolling } from '../hooks/usePolling.js';
import type { DashboardSnapshot, ServiceInfo } from '../../shared/types.js';

interface Props {
  data: DashboardSnapshot;
  networkHistory: Record<string, { rx: number[]; tx: number[] }>;
}

export function ClusterDetailPage({ data, networkHistory }: Props) {
  const { name } = useParams<{ name: string }>();
  const cluster = data.clusters.find(c => c.name === name);
  const { data: services } = usePolling<ServiceInfo[]>(`/api/cluster/${name}/services`, 30000, { raw: true });

  if (!cluster) {
    return (
      <div className="text-center py-20">
        <div className="text-red-400 text-lg mb-2">Cluster '{name}' not found</div>
        <Link to="/" className="text-blue-400 hover:underline text-sm">Back to overview</Link>
      </div>
    );
  }

  const vms = data.vms.filter(v => v.cluster === name);
  const pods = data.clusterPods[name!] || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-slate-400 hover:text-white text-sm">&larr; Overview</Link>
        <h2 className="text-lg font-semibold text-slate-100 capitalize">{name} Cluster</h2>
      </div>

      <ClusterCard
        cluster={cluster}
        vms={vms}
        vmResources={data.vmResources}
        vmPorts={data.vmPorts}
        vmNetwork={data.vmNetwork}
        networkHistory={networkHistory}
        pods={pods}
      />

      {/* Services Table */}
      {services && services.length > 0 && (
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/80">
          <div className="px-4 py-3 border-b border-slate-700/60">
            <h3 className="text-sm font-medium text-slate-300">Services ({services.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700/60">
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">Namespace</th>
                  <th className="text-left px-4 py-2">Type</th>
                  <th className="text-left px-4 py-2">Cluster IP</th>
                  <th className="text-left px-4 py-2">Ports</th>
                  <th className="text-left px-4 py-2">Endpoints</th>
                </tr>
              </thead>
              <tbody>
                {services.map(svc => (
                  <tr key={`${svc.namespace}/${svc.name}`} className="border-b border-slate-700/30 text-slate-300 hover:bg-slate-700/20">
                    <td className="px-4 py-1.5 font-mono">{svc.name}</td>
                    <td className="px-4 py-1.5">{svc.namespace}</td>
                    <td className="px-4 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        svc.type === 'NodePort' ? 'bg-blue-500/15 text-blue-400' :
                        svc.type === 'LoadBalancer' ? 'bg-purple-500/15 text-purple-400' :
                        'bg-slate-700 text-slate-400'
                      }`}>{svc.type}</span>
                    </td>
                    <td className="px-4 py-1.5 font-mono text-slate-500">{svc.clusterIp}</td>
                    <td className="px-4 py-1.5 font-mono">
                      {svc.ports.map(p => `${p.port}${p.nodePort ? `:${p.nodePort}` : ''}/${p.protocol}`).join(', ')}
                    </td>
                    <td className="px-4 py-1.5 text-slate-500">{svc.endpoints.length} endpoints</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
