import { useState } from 'react';
import { StatusDot } from '../common/StatusDot.js';
import { VmResourceGauges } from '../vm/VmResourceGauges.js';
import { VmPortList } from '../vm/VmPortList.js';
import { VmNetworkStats } from '../vm/VmNetworkStats.js';
import { PodTable } from '../pod/PodTable.js';
import type { VmInfo, VmResources, PortInfo, NetworkStats, PodInfo } from '../../../shared/types.js';

interface Props {
  vm: VmInfo;
  resources?: VmResources;
  ports?: PortInfo[];
  network?: NetworkStats;
  networkHistory: { rx: number[]; tx: number[] };
  pods: PodInfo[];
}

export function NodeCard({ vm, resources, ports, network, networkHistory, pods }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isOffline = vm.status !== 'running';

  return (
    <div className={`rounded-lg border ${isOffline ? 'border-slate-700 opacity-60' : 'border-slate-700 hover:border-slate-600'} bg-slate-800/50 transition-all`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <StatusDot status={vm.status === 'running' ? 'running' : 'stopped'} />
          <div className="text-left">
            <div className="text-sm font-semibold text-white">{vm.name}</div>
            <div className="text-xs text-slate-400">
              {vm.role} | {vm.ip || 'no ip'} | {vm.specs.cpu}C/{(vm.specs.memoryMb / 1024).toFixed(0)}G/{vm.specs.diskGb}G
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {resources && !isOffline && (
            <div className="hidden sm:flex gap-2 text-xs">
              <span className={resources.cpuPercent >= 80 ? 'text-red-400' : 'text-slate-400'}>
                CPU {resources.cpuPercent}%
              </span>
              <span className={resources.memoryPercent >= 80 ? 'text-red-400' : 'text-slate-400'}>
                MEM {resources.memoryPercent}%
              </span>
            </div>
          )}
          <span className="text-xs text-slate-500 bg-slate-700 px-1.5 py-0.5 rounded">
            {pods.length} pods
          </span>
          <svg className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div className="border-t border-slate-700 p-3 space-y-4">
          {isOffline ? (
            <div className="text-center text-sm text-slate-500 py-4">VM is offline</div>
          ) : (
            <>
              {/* Resource Gauges */}
              <div>
                <h4 className="text-xs font-medium text-slate-400 mb-2">Resources</h4>
                <VmResourceGauges resources={resources} />
              </div>

              {/* Network */}
              <div>
                <h4 className="text-xs font-medium text-slate-400 mb-2">Network Traffic</h4>
                <VmNetworkStats network={network} history={networkHistory} />
              </div>

              {/* Ports */}
              <div>
                <h4 className="text-xs font-medium text-slate-400 mb-2">Open Ports ({ports?.length || 0})</h4>
                <VmPortList ports={ports} />
              </div>

              {/* Pods */}
              <div>
                <h4 className="text-xs font-medium text-slate-400 mb-2">Pods ({pods.length})</h4>
                <PodTable pods={pods} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
