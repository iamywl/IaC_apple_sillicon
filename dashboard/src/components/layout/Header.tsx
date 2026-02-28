import { StatusDot } from '../common/StatusDot.js';

interface HeaderProps {
  lastUpdated: number;
  connectionStatus: 'healthy' | 'degraded' | 'down';
  errorCount: number;
  vmCount?: number;
  clusterCount?: number;
}

export function Header({ lastUpdated, connectionStatus, errorCount, vmCount = 0, clusterCount = 0 }: HeaderProps) {
  const timeStr = lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '--:--:--';

  return (
    <header className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700 bg-slate-900/80 backdrop-blur sticky top-0 z-10 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-base font-bold text-white whitespace-nowrap">Tart Infra</h1>
        <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded whitespace-nowrap">{vmCount} VMs / {clusterCount} Clusters</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {errorCount > 0 && (
          <span className="text-xs text-yellow-400 whitespace-nowrap">{errorCount} err</span>
        )}
        <div className="flex items-center gap-1.5">
          <StatusDot status={connectionStatus} size="sm" />
          <span className="text-xs text-slate-400">{connectionStatus}</span>
        </div>
        <span className="text-xs text-slate-500 whitespace-nowrap">{timeStr}</span>
      </div>
    </header>
  );
}
