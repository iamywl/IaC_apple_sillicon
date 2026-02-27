import type { PortInfo } from '../../../shared/types.js';

interface Props {
  ports?: PortInfo[];
}

export function VmPortList({ ports }: Props) {
  if (!ports || ports.length === 0) {
    return <div className="text-xs text-slate-500">No open ports</div>;
  }

  return (
    <div className="max-h-32 overflow-y-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-slate-700">
            <th className="text-left py-1 font-medium">Port</th>
            <th className="text-left py-1 font-medium">Address</th>
            <th className="text-left py-1 font-medium">Process</th>
          </tr>
        </thead>
        <tbody>
          {ports.map((p, i) => (
            <tr key={i} className="border-b border-slate-800 hover:bg-slate-700/30">
              <td className="py-0.5 text-cyan-400 font-mono">{p.port}</td>
              <td className="py-0.5 text-slate-400 font-mono">{p.address}</td>
              <td className="py-0.5 text-slate-300">{p.process}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
