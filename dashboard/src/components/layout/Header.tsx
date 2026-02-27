import { StatusDot } from '../common/StatusDot.js';

interface HeaderProps {
  lastUpdated: number;
  connectionStatus: 'healthy' | 'degraded' | 'down';
  errorCount: number;
}

export function Header({ lastUpdated, connectionStatus, errorCount }: HeaderProps) {
  const timeStr = lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '--:--:--';

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-slate-700 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-white">Tart Infra Dashboard</h1>
        <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">7 VMs / 3 Clusters</span>
      </div>
      <div className="flex items-center gap-4">
        {errorCount > 0 && (
          <span className="text-xs text-yellow-400">{errorCount} errors</span>
        )}
        <div className="flex items-center gap-2">
          <StatusDot status={connectionStatus} size="sm" />
          <span className="text-xs text-slate-400">{connectionStatus}</span>
        </div>
        <span className="text-xs text-slate-500">Updated: {timeStr}</span>
        <span className="text-xs text-slate-600 bg-slate-800 px-2 py-0.5 rounded">5s poll</span>
      </div>
    </header>
  );
}
