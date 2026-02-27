import type { PodInfo } from '../../../shared/types.js';

interface Props {
  pods: PodInfo[];
  nodeName?: string;
}

const statusColor: Record<string, string> = {
  Running: 'text-green-400',
  Succeeded: 'text-blue-400',
  Pending: 'text-yellow-400',
  Failed: 'text-red-400',
  Unknown: 'text-gray-400',
};

export function PodTable({ pods, nodeName }: Props) {
  const filtered = nodeName ? pods.filter(p => p.nodeName === nodeName) : pods;

  if (filtered.length === 0) {
    return <div className="text-xs text-slate-500 py-1">No pods</div>;
  }

  return (
    <div className="max-h-48 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-800">
          <tr className="text-slate-500 border-b border-slate-700">
            <th className="text-left py-1 font-medium">Pod</th>
            <th className="text-left py-1 font-medium">Namespace</th>
            <th className="text-left py-1 font-medium">Status</th>
            <th className="text-right py-1 font-medium">Restarts</th>
            <th className="text-right py-1 font-medium">Age</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((pod) => (
            <tr key={`${pod.namespace}/${pod.name}`} className="border-b border-slate-800/50 hover:bg-slate-700/20">
              <td className="py-0.5 text-slate-300 font-mono truncate max-w-[200px]" title={pod.name}>
                {pod.name}
              </td>
              <td className="py-0.5 text-purple-400">{pod.namespace}</td>
              <td className={`py-0.5 font-medium ${statusColor[pod.status] || 'text-gray-400'}`}>
                {pod.status}
              </td>
              <td className={`py-0.5 text-right ${pod.restarts > 0 ? 'text-yellow-400' : 'text-slate-500'}`}>
                {pod.restarts}
              </td>
              <td className="py-0.5 text-right text-slate-500">{pod.age}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
