import { GaugeChart } from '../common/GaugeChart.js';
import type { VmResources } from '../../../shared/types.js';

interface Props {
  resources?: VmResources;
}

export function VmResourceGauges({ resources }: Props) {
  if (!resources) {
    return <div className="text-xs text-slate-500 py-2">No data</div>;
  }

  return (
    <div className="flex gap-4 justify-center">
      <GaugeChart
        value={resources.cpuPercent}
        label="CPU"
        size={70}
      />
      <GaugeChart
        value={resources.memoryPercent}
        label="Memory"
        detail={`${resources.memoryUsedMb}/${resources.memoryTotalMb}MB`}
        size={70}
      />
      <GaugeChart
        value={resources.diskPercent}
        label="Disk"
        detail={`${resources.diskUsedGb.toFixed(1)}/${resources.diskTotalGb}GB`}
        size={70}
      />
    </div>
  );
}
