import { useRef } from 'react';
import { usePolling } from './hooks/usePolling.js';
import { Header } from './components/layout/Header.js';
import { MainLayout } from './components/layout/MainLayout.js';
import { ClusterCard } from './components/cluster/ClusterCard.js';
import type { DashboardSnapshot } from '../shared/types.js';

const MAX_HISTORY = 60;

function App() {
  const { data, error, lastUpdated } = usePolling<DashboardSnapshot>('/api/snapshot', 5000);
  const networkHistoryRef = useRef<Record<string, { rx: number[]; tx: number[] }>>({});

  // Update network history ring buffer
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

  if (!data) {
    return (
      <MainLayout
        header={<Header lastUpdated={0} connectionStatus={error ? 'down' : 'degraded'} errorCount={0} />}
      >
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
      </MainLayout>
    );
  }

  return (
    <MainLayout
      header={
        <Header
          lastUpdated={lastUpdated}
          connectionStatus={connectionStatus as 'healthy' | 'degraded' | 'down'}
          errorCount={data.errors.length}
        />
      }
    >
      <div className="space-y-6">
        {data.clusters.map(cluster => (
          <ClusterCard
            key={cluster.name}
            cluster={cluster}
            vms={data.vms.filter(v => v.cluster === cluster.name)}
            vmResources={data.vmResources}
            vmPorts={data.vmPorts}
            vmNetwork={data.vmNetwork}
            networkHistory={networkHistoryRef.current}
            pods={data.clusterPods[cluster.name] || []}
          />
        ))}
      </div>
    </MainLayout>
  );
}

export default App;
