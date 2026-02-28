import type { ReactNode } from 'react';
import { Header } from './Header.js';
import { Sidebar } from './Sidebar.js';

interface Props {
  lastUpdated: number;
  connectionStatus: 'healthy' | 'degraded' | 'down';
  errorCount: number;
  vmCount: number;
  clusterCount: number;
  children: ReactNode;
}

export function AppShell({ lastUpdated, connectionStatus, errorCount, vmCount, clusterCount, children }: Props) {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <Header
        lastUpdated={lastUpdated}
        connectionStatus={connectionStatus}
        errorCount={errorCount}
        vmCount={vmCount}
        clusterCount={clusterCount}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
