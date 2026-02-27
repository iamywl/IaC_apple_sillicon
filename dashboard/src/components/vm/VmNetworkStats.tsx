import { SparkLine } from '../common/SparkLine.js';
import type { NetworkStats } from '../../../shared/types.js';

interface Props {
  network?: NetworkStats;
  history: { rx: number[]; tx: number[] };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function VmNetworkStats({ network, history }: Props) {
  if (!network) {
    return <div className="text-xs text-slate-500">No data</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-xs text-green-400">RX</span>
          <span className="text-xs text-slate-300 font-mono">{formatBytes(network.rxBytesPerSec)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-blue-400">TX</span>
          <span className="text-xs text-slate-300 font-mono">{formatBytes(network.txBytesPerSec)}</span>
        </div>
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <SparkLine data={history.rx} color="#22c55e" height={24} />
        </div>
        <div className="flex-1">
          <SparkLine data={history.tx} color="#3b82f6" height={24} />
        </div>
      </div>
    </div>
  );
}
