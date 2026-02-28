import { useState, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Area, AreaChart,
} from 'recharts';
import { usePolling } from '../hooks/usePolling.js';
import type { ClusterInfo, ScalingDataPoint, HpaSnapshot } from '../../shared/types.js';

interface Props {
  clusters: ClusterInfo[];
}

const COLORS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7', '#06b6d4', '#f97316', '#ec4899'];

export function ScalingPage({ clusters }: Props) {
  const [selectedCluster, setSelectedCluster] = useState(clusters[0]?.name || 'dev');
  const { data: history } = usePolling<ScalingDataPoint[]>(
    `/api/scaling/${selectedCluster}`, 3000, { raw: true }
  );

  const deploymentNames = useMemo(() => {
    if (!history || history.length === 0) return [];
    const latest = history[history.length - 1];
    return latest.hpas.map(h => `${h.namespace}/${h.deployment}`);
  }, [history]);

  const replicaChartData = useMemo(() => {
    if (!history) return [];
    return history.map(point => {
      const row: Record<string, any> = {
        time: point.timestamp,
        timeLabel: new Date(point.timestamp).toLocaleTimeString(),
      };
      for (const hpa of point.hpas) {
        const key = `${hpa.namespace}/${hpa.deployment}`;
        row[key] = hpa.currentReplicas;
        row[`${key}_desired`] = hpa.desiredReplicas;
        row[`${key}_max`] = hpa.maxReplicas;
        row[`${key}_min`] = hpa.minReplicas;
      }
      return row;
    });
  }, [history]);

  const cpuChartData = useMemo(() => {
    if (!history) return [];
    return history.map(point => {
      const row: Record<string, any> = {
        time: point.timestamp,
        timeLabel: new Date(point.timestamp).toLocaleTimeString(),
      };
      for (const hpa of point.hpas) {
        const key = `${hpa.namespace}/${hpa.deployment}`;
        row[key] = hpa.currentCpuPercent;
        row[`${key}_target`] = hpa.targetCpuPercent;
      }
      return row;
    });
  }, [history]);

  const latestHpas: HpaSnapshot[] = useMemo(() => {
    if (!history || history.length === 0) return [];
    return history[history.length - 1].hpas;
  }, [history]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Auto Scaling Monitor</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            HPA replica counts and CPU utilization over time
          </p>
        </div>
        <select
          value={selectedCluster}
          onChange={e => setSelectedCluster(e.target.value)}
          className="bg-slate-800 text-slate-200 text-sm px-3 py-1.5 rounded-lg border border-slate-600 focus:outline-none focus:border-blue-500"
        >
          {clusters.map(c => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
      </div>

      {latestHpas.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {latestHpas.map((hpa, i) => {
            const scaleRatio = hpa.maxReplicas > hpa.minReplicas
              ? (hpa.currentReplicas - hpa.minReplicas) / (hpa.maxReplicas - hpa.minReplicas)
              : 0;
            const isScaling = hpa.currentReplicas !== hpa.desiredReplicas;
            const isAtMax = hpa.currentReplicas >= hpa.maxReplicas;

            return (
              <div key={hpa.name} className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/60">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-slate-400">{hpa.namespace}</span>
                  {isScaling && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/15 text-yellow-400 rounded">SCALING</span>
                  )}
                  {isAtMax && !isScaling && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-red-500/15 text-red-400 rounded">AT MAX</span>
                  )}
                </div>
                <div className="text-sm font-medium text-slate-200 truncate">{hpa.deployment}</div>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-2xl font-bold" style={{ color: COLORS[i % COLORS.length] }}>
                    {hpa.currentReplicas}
                  </span>
                  <span className="text-xs text-slate-500">/ {hpa.maxReplicas} max</span>
                </div>
                <div className="mt-2 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.max(5, scaleRatio * 100)}%`,
                      backgroundColor: COLORS[i % COLORS.length],
                    }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>min {hpa.minReplicas}</span>
                  <span>CPU {hpa.currentCpuPercent ?? '?'}% / {hpa.targetCpuPercent}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {replicaChartData.length > 0 ? (
        <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 p-4">
          <h2 className="text-sm font-medium text-slate-300 mb-3">Pod Replica Count (Time Series)</h2>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={replicaChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="timeLabel" stroke="#64748b" fontSize={10}
                interval="equidistantPreserveStart" tickCount={6}
                angle={-30} textAnchor="end" height={50}
                label={{ value: 'Time', position: 'insideBottom', offset: -5, fill: '#94a3b8', fontSize: 11 }}
              />
              <YAxis stroke="#64748b" fontSize={10} allowDecimals={false} domain={[0, 'auto']}
                label={{ value: 'Replicas', angle: -90, position: 'insideLeft', offset: 10, fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                labelStyle={{ color: '#94a3b8' }} itemStyle={{ fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8', paddingTop: 8 }} />
              {deploymentNames.map((name, i) => (
                <Area
                  key={name} type="stepAfter" dataKey={name}
                  stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]}
                  fillOpacity={0.15} strokeWidth={2} dot={false} isAnimationActive={false}
                />
              ))}
              {latestHpas.map((hpa, i) => (
                <ReferenceLine
                  key={`max-${hpa.name}`} y={hpa.maxReplicas}
                  stroke={COLORS[i % COLORS.length]} strokeDasharray="4 4" strokeOpacity={0.4}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 p-12 text-center">
          <div className="text-slate-500 text-sm">
            {!history ? 'Loading scaling data...' : 'No HPA configured on this cluster'}
          </div>
          <div className="text-slate-600 text-xs mt-1">
            Scaling data is collected every 5 seconds
          </div>
        </div>
      )}

      {cpuChartData.length > 0 && deploymentNames.length > 0 && (
        <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 p-4">
          <h2 className="text-sm font-medium text-slate-300 mb-3">CPU Utilization (%) vs Target</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={cpuChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="timeLabel" stroke="#64748b" fontSize={10}
                interval="equidistantPreserveStart" tickCount={6}
                angle={-30} textAnchor="end" height={50}
                label={{ value: 'Time', position: 'insideBottom', offset: -5, fill: '#94a3b8', fontSize: 11 }}
              />
              <YAxis stroke="#64748b" fontSize={10} domain={[0, 100]} tickFormatter={v => `${v}%`}
                label={{ value: 'CPU Utilization (%)', angle: -90, position: 'insideLeft', offset: 10, fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                labelStyle={{ color: '#94a3b8' }} itemStyle={{ fontSize: 12 }}
                formatter={(value: number | null) => [value != null ? `${value}%` : 'N/A']}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8', paddingTop: 8 }} />
              {deploymentNames.map((name, i) => (
                <Line
                  key={name} type="monotone" dataKey={name}
                  stroke={COLORS[i % COLORS.length]} strokeWidth={2}
                  dot={false} connectNulls isAnimationActive={false}
                />
              ))}
              {latestHpas.map((hpa, i) => (
                <ReferenceLine
                  key={`target-${hpa.name}`} y={hpa.targetCpuPercent}
                  stroke={COLORS[i % COLORS.length]} strokeDasharray="4 4" strokeOpacity={0.4}
                  label={{
                    value: `target ${hpa.targetCpuPercent}%`, position: 'right',
                    fill: COLORS[i % COLORS.length], fontSize: 10, opacity: 0.6,
                  }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {latestHpas.length > 0 && (
        <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700/60">
            <h2 className="text-sm font-medium text-slate-300">HPA Configuration</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700/60">
                  <th className="text-left px-4 py-2 font-medium">Namespace</th>
                  <th className="text-left px-4 py-2 font-medium">Deployment</th>
                  <th className="text-center px-4 py-2 font-medium">Current</th>
                  <th className="text-center px-4 py-2 font-medium">Desired</th>
                  <th className="text-center px-4 py-2 font-medium">Min</th>
                  <th className="text-center px-4 py-2 font-medium">Max</th>
                  <th className="text-center px-4 py-2 font-medium">CPU Usage</th>
                  <th className="text-center px-4 py-2 font-medium">CPU Target</th>
                </tr>
              </thead>
              <tbody>
                {latestHpas.map((hpa, i) => (
                  <tr key={hpa.name} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                    <td className="px-4 py-2 font-mono text-slate-400">{hpa.namespace}</td>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="text-slate-200">{hpa.deployment}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center font-bold text-slate-200">{hpa.currentReplicas}</td>
                    <td className="px-4 py-2 text-center text-slate-300">{hpa.desiredReplicas}</td>
                    <td className="px-4 py-2 text-center text-slate-400">{hpa.minReplicas}</td>
                    <td className="px-4 py-2 text-center text-slate-400">{hpa.maxReplicas}</td>
                    <td className="px-4 py-2 text-center">
                      {hpa.currentCpuPercent != null ? (
                        <span className={hpa.currentCpuPercent > hpa.targetCpuPercent ? 'text-red-400' : 'text-green-400'}>
                          {hpa.currentCpuPercent}%
                        </span>
                      ) : (
                        <span className="text-slate-500">--</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center text-slate-400">{hpa.targetCpuPercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
