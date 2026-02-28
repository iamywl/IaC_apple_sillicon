import { useRef } from 'react';
import { Routes, Route } from 'react-router-dom';
import { usePolling } from './hooks/usePolling.js';
import { AppShell } from './components/layout/AppShell.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { ClusterDetailPage } from './pages/ClusterDetailPage.js';
import { TestingPage } from './pages/TestingPage.js';
import { TrafficPage } from './pages/TrafficPage.js';
import { ScalingPage } from './pages/ScalingPage.js';
import { LoadAnalysisPage } from './pages/LoadAnalysisPage.js';
import type { DashboardSnapshot } from '../shared/types.js';

const MAX_HISTORY = 60;

function App() {
  const { data, error, lastUpdated } = usePolling<DashboardSnapshot>('/api/snapshot', 5000);
  const networkHistoryRef = useRef<Record<string, { rx: number[]; tx: number[] }>>({});

  if (data?.vmNetwork) {
    for (const [vmName, stats] of Object.entries(data.vmNetwork)) {
      if (!networkHistoryRef.current[vmName]) {
        networkHistoryRef.current[vmName] = { rx: [], tx: [] };
      }
      const h = networkHistoryRef.current[vmName];
      h.rx.push(stats.rxBytesPerSec);
      h.tx.push(stats.txBytesPerSec);
      if (h.rx.length > MAX_HISTORY) h.rx.shift();
      if (h.tx.length > MAX_HISTORY) h.tx.shift();
    }
  }

  const connectionStatus = error ? 'down' : !data ? 'degraded' : data.errors.length > 3 ? 'degraded' : 'healthy';

  return (
    <AppShell
      lastUpdated={lastUpdated}
      connectionStatus={connectionStatus as 'healthy' | 'degraded' | 'down'}
      errorCount={data?.errors.length ?? 0}
      vmCount={data?.vms.length ?? 0}
      clusterCount={data?.clusters.length ?? 0}
    >
      {!data ? (
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center">
            {error ? (
              <>
                <div className="text-red-400 text-lg mb-2">Backend Disconnected</div>
                <div className="text-slate-500 text-sm">Ensure the server is running on port 3001</div>
                <div className="text-slate-600 text-xs mt-2">{error.message}</div>
              </>
            ) : (
              <>
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <div className="text-slate-400">Loading dashboard...</div>
              </>
            )}
          </div>
        </div>
      ) : (
        <Routes>
          <Route path="/" element={<OverviewPage data={data} />} />
          <Route path="/cluster/:name" element={
            <ClusterDetailPage data={data} networkHistory={networkHistoryRef.current} />
          } />
          <Route path="/testing" element={<TestingPage clusters={data.clusters} />} />
          <Route path="/traffic" element={<TrafficPage clusters={data.clusters} pods={data.clusterPods} vms={data.vms} />} />
          <Route path="/scaling" element={<ScalingPage clusters={data.clusters} />} />
          <Route path="/analysis" element={<LoadAnalysisPage clusters={data.clusters} data={data} />} />
        </Routes>
      )}
    </AppShell>
  );
}

export default App;
