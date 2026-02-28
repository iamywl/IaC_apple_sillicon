import { useState, useMemo } from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceArea, ReferenceLine,
} from 'recharts';
import { usePolling } from '../hooks/usePolling.js';
import type {
  ClusterInfo, DashboardSnapshot, TestRun, ScalingDataPoint,
  ScalingTestMeta, TrafficSummary, AggregatedEdge, HpaSnapshot,
} from '../../shared/types.js';

interface Props {
  clusters: ClusterInfo[];
  data: DashboardSnapshot;
}

const COLORS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7', '#06b6d4'];

// ========== Identity resolution ==========
const IDENTITY_LABELS: Record<string, string> = {
  '1': 'host', '2': 'world', '3': 'unmanaged', '4': 'health',
  '5': 'init', '6': 'kube-apiserver', '7': 'remote-node', '8': 'ingress',
};

function resolveIdentity(ns: string, pod: string): { ns: string; service: string } {
  if (ns === 'unknown') {
    return { ns: 'cluster', service: IDENTITY_LABELS[pod] || `id:${pod}` };
  }
  const service = pod.replace(/-[a-z0-9]{8,10}-[a-z0-9]{4,5}$/, '').replace(/-[a-f0-9]{7,10}$/, '');
  return { ns, service };
}

const NS_COLORS: Record<string, string> = {
  'kube-system': '#3b82f6', 'demo': '#10b981', 'monitoring': '#a855f7',
  'argocd': '#f97316', 'istio-system': '#06b6d4', 'istio-ingress': '#14b8a6',
  'cluster': '#64748b', 'default': '#8b5cf6',
};
function nsColor(ns: string): string { return NS_COLORS[ns] || '#64748b'; }

interface ServiceEdge {
  sourceNs: string; sourceService: string;
  targetNs: string; targetService: string;
  flowCount: number; forwardedCount: number; droppedCount: number;
  protocols: string[];
}

function aggregateEdges(aggregated: AggregatedEdge[]): ServiceEdge[] {
  const edgeMap = new Map<string, ServiceEdge>();
  for (const edge of aggregated) {
    const [srcNs, srcPod] = edge.sourceKey.split('/');
    const [dstNs, dstPod] = edge.destinationKey.split('/');
    const src = resolveIdentity(srcNs, srcPod);
    const dst = resolveIdentity(dstNs, dstPod);
    const srcId = `${src.ns}/${src.service}`;
    const dstId = `${dst.ns}/${dst.service}`;
    if (srcId === dstId) continue;
    const key = `${srcId}|${dstId}`;
    const ex = edgeMap.get(key);
    if (ex) {
      ex.flowCount += edge.flowCount;
      ex.forwardedCount += edge.forwardedCount;
      ex.droppedCount += edge.droppedCount;
      for (const p of edge.protocols) if (!ex.protocols.includes(p)) ex.protocols.push(p);
    } else {
      edgeMap.set(key, {
        sourceNs: src.ns, sourceService: src.service,
        targetNs: dst.ns, targetService: dst.service,
        flowCount: edge.flowCount, forwardedCount: edge.forwardedCount,
        droppedCount: edge.droppedCount, protocols: [...edge.protocols],
      });
    }
  }
  return Array.from(edgeMap.values()).sort((a, b) => b.flowCount - a.flowCount);
}

// Recharts common axis label style
const AXIS_LABEL = { fill: '#94a3b8', fontSize: 11 };

// ========== Main Page ==========
export function LoadAnalysisPage({ clusters, data }: Props) {
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState(clusters[0]?.name || 'dev');
  const [showEventLog, setShowEventLog] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  // Data polling
  const { data: tests } = usePolling<TestRun[]>('/api/tests/status', 2000, { raw: true });
  const { data: liveScaling } = usePolling<ScalingDataPoint[]>(
    `/api/scaling/${selectedCluster}`, 3000, { raw: true }
  );
  const { data: traffic } = usePolling<TrafficSummary>(
    `/api/traffic?cluster=${selectedCluster}`, 5000, { raw: true }
  );

  // Filter scaling tests
  const scalingTests = useMemo(() => {
    if (!tests) return [];
    return tests
      .filter(t => t.type === 'scaling-test')
      .sort((a, b) => b.startedAt - a.startedAt);
  }, [tests]);

  // Auto-select: running test first, then most recent completed
  const selectedTest = useMemo(() => {
    if (!scalingTests.length) return null;
    if (selectedTestId) {
      const found = scalingTests.find(t => t.id === selectedTestId);
      if (found) return found;
    }
    const running = scalingTests.find(t => t.status === 'running' || t.status === 'pending');
    if (running) return running;
    return scalingTests.find(t => t.status === 'completed') || scalingTests[0];
  }, [scalingTests, selectedTestId]);

  const isLive = selectedTest?.status === 'running' || selectedTest?.status === 'pending';
  const meta: ScalingTestMeta | null = selectedTest?.results?.scalingMeta || null;

  // Scaling snapshots: from meta (completed) or live polling (running)
  const scalingSnapshots = useMemo(() => {
    if (meta?.scalingSnapshots) return meta.scalingSnapshots;
    if (isLive && liveScaling) return liveScaling;
    return [];
  }, [meta, isLive, liveScaling]);

  // Timestamps
  const testStart = meta?.testStartTimestamp || selectedTest?.startedAt || 0;
  const testEnd = meta?.testEndTimestamp || (selectedTest?.completedAt || 0);
  const cooldownEnd = meta?.cooldownEndTimestamp || 0;

  // Deployment names
  const deploymentNames = useMemo(() => {
    const names = new Set<string>();
    for (const s of scalingSnapshots) {
      for (const h of s.hpas) {
        if (!meta?.targetDeployments?.length || meta.targetDeployments.includes(h.deployment)) {
          names.add(h.deployment);
        }
      }
    }
    return Array.from(names);
  }, [scalingSnapshots, meta]);

  // Replica timeline chart data
  const replicaChartData = useMemo(() => {
    if (scalingSnapshots.length === 0) return [];
    return scalingSnapshots.map(s => {
      const row: Record<string, any> = {
        time: s.timestamp,
        timeLabel: new Date(s.timestamp).toLocaleTimeString(),
      };
      let total = 0;
      for (const h of s.hpas) {
        if (!meta?.targetDeployments?.length || meta.targetDeployments.includes(h.deployment)) {
          row[h.deployment] = h.currentReplicas;
          row[`${h.deployment}_cpu`] = h.currentCpuPercent;
          total += h.currentReplicas;
        }
      }
      row._totalReplicas = total;
      return row;
    });
  }, [scalingSnapshots, meta]);

  // RPS
  const rps = selectedTest?.results?.rps ?? null;

  // Per-pod efficiency
  const efficiencyChartData = useMemo(() => {
    if (!rps || replicaChartData.length === 0) return [];
    return replicaChartData
      .filter(d => d.time >= testStart && d.time <= (testEnd || Date.now()))
      .map(d => ({
        timeLabel: d.timeLabel,
        rpsPerPod: d._totalReplicas > 0 ? parseFloat((rps / d._totalReplicas).toFixed(1)) : 0,
      }));
  }, [rps, replicaChartData, testStart, testEnd]);

  // CPU timeline data (for detail view)
  const cpuChartData = useMemo(() => {
    if (scalingSnapshots.length === 0) return [];
    return scalingSnapshots.map(s => {
      const row: Record<string, any> = {
        time: s.timestamp,
        timeLabel: new Date(s.timestamp).toLocaleTimeString(),
      };
      for (const h of s.hpas) {
        if (!meta?.targetDeployments?.length || meta.targetDeployments.includes(h.deployment)) {
          row[h.deployment] = h.currentCpuPercent;
          row[`${h.deployment}_target`] = h.targetCpuPercent;
        }
      }
      return row;
    });
  }, [scalingSnapshots, meta]);

  // Baseline vs Peak per-deployment comparison
  const deploymentComparison = useMemo(() => {
    if (scalingSnapshots.length === 0 || !testStart) return [];
    const result: {
      deployment: string;
      baselineReplicas: number;
      peakReplicas: number;
      finalReplicas: number;
      baselineCpu: number | null;
      peakCpu: number | null;
      minReplicas: number;
      maxReplicas: number;
      targetCpu: number;
    }[] = [];

    for (const name of deploymentNames) {
      let baselineReplicas = 0;
      let baselineCpu: number | null = null;
      let peakReplicas = 0;
      let peakCpu: number | null = null;
      let finalReplicas = 0;
      let minReplicas = Infinity;
      let maxReplicas = 0;
      let targetCpu = 50;

      // Find baseline (last snapshot before test started)
      for (const s of scalingSnapshots) {
        if (s.timestamp >= testStart) break;
        for (const h of s.hpas) {
          if (h.deployment === name) {
            baselineReplicas = h.currentReplicas;
            baselineCpu = h.currentCpuPercent;
            minReplicas = h.minReplicas;
            maxReplicas = h.maxReplicas;
            targetCpu = h.targetCpuPercent;
          }
        }
      }

      // Find peak and final
      for (const s of scalingSnapshots) {
        for (const h of s.hpas) {
          if (h.deployment === name) {
            if (h.currentReplicas > peakReplicas) peakReplicas = h.currentReplicas;
            if (h.currentCpuPercent != null && (peakCpu === null || h.currentCpuPercent > peakCpu)) {
              peakCpu = h.currentCpuPercent;
            }
            finalReplicas = h.currentReplicas;
            minReplicas = h.minReplicas;
            maxReplicas = h.maxReplicas;
            targetCpu = h.targetCpuPercent;
          }
        }
      }

      if (baselineReplicas === 0 && peakReplicas === 0) continue;

      result.push({
        deployment: name,
        baselineReplicas: baselineReplicas || (scalingSnapshots[0]?.hpas.find(h => h.deployment === name)?.currentReplicas ?? 0),
        peakReplicas,
        finalReplicas,
        baselineCpu,
        peakCpu,
        minReplicas: minReplicas === Infinity ? 0 : minReplicas,
        maxReplicas,
        targetCpu,
      });
    }
    return result;
  }, [scalingSnapshots, deploymentNames, testStart]);

  // Traffic edges
  const trafficEdges = useMemo(() => {
    if (!traffic) return [];
    return aggregateEdges(traffic.aggregated);
  }, [traffic]);

  // VM resources for selected cluster
  const clusterVms = useMemo(() => {
    return data.vms
      .filter(v => v.cluster === selectedCluster)
      .map(v => ({ ...v, resources: data.vmResources[v.name] }));
  }, [data, selectedCluster]);

  // HPA event log
  const eventLog = useMemo(() => {
    const events: { time: number; phase: string; deployment: string; replicas: number; cpu: number | null }[] = [];
    const prev: Record<string, number> = {};
    for (const s of scalingSnapshots) {
      const phase = s.timestamp < testStart ? 'Baseline'
        : s.timestamp <= (testEnd || Infinity) ? 'Load'
        : 'Cooldown';
      for (const h of s.hpas) {
        if (meta?.targetDeployments?.length && !meta.targetDeployments.includes(h.deployment)) continue;
        if (prev[h.deployment] === undefined) {
          prev[h.deployment] = h.currentReplicas;
          events.push({ time: s.timestamp, phase, deployment: h.deployment, replicas: h.currentReplicas, cpu: h.currentCpuPercent });
        } else if (prev[h.deployment] !== h.currentReplicas) {
          prev[h.deployment] = h.currentReplicas;
          events.push({ time: s.timestamp, phase, deployment: h.deployment, replicas: h.currentReplicas, cpu: h.currentCpuPercent });
        }
      }
    }
    return events;
  }, [scalingSnapshots, testStart, testEnd, meta]);

  // Helpers
  const fmtMs = (ms: number | null) => {
    if (ms === null) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const fmtAgo = (ts: number) => {
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Load Analysis</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Correlate infrastructure behavior during load tests
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

      {/* Test Selector */}
      {scalingTests.length > 0 ? (
        <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 p-4">
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider shrink-0">Select Test</label>
            <select
              value={selectedTest?.id || ''}
              onChange={e => setSelectedTestId(e.target.value)}
              className="flex-1 bg-slate-900/60 text-slate-200 text-sm px-3 py-2 rounded-lg border border-slate-600 focus:outline-none focus:border-blue-500"
            >
              {scalingTests.map(t => (
                <option key={t.id} value={t.id}>
                  {t.scenarioName || t.id} — {t.cluster} — {t.status} — {fmtAgo(t.startedAt)}
                </option>
              ))}
            </select>
            {isLive && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/15 px-2.5 py-1 rounded-lg border border-emerald-500/30 shrink-0">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </span>
            )}
            {selectedTest?.status === 'completed' && (
              <span className="text-xs text-slate-500 shrink-0">
                {((selectedTest.completedAt! - selectedTest.startedAt) / 1000).toFixed(0)}s total
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 p-12 text-center">
          <div className="text-slate-500 text-sm mb-1">No scaling tests found</div>
          <div className="text-slate-600 text-xs">
            Run a Scale Test from the Testing page to see analysis here
          </div>
        </div>
      )}

      {/* Content */}
      {selectedTest && (
        <>
          {/* Summary Cards */}
          {meta && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <SummaryCard label="Scale-up Latency" value={fmtMs(meta.scaleUpLatency)} sub="First pod increase after load start" />
              <SummaryCard label="Peak Replicas" value={String(meta.peakReplicas)} sub="Max total pods during test" />
              <SummaryCard label="Scale-down Start" value={fmtMs(meta.scaleDownStarted)} sub="First pod decrease after load end" />
              <SummaryCard label="RPS / Pod" value={meta.avgRpsPerPod != null ? meta.avgRpsPerPod.toFixed(1) : '—'} sub="Avg throughput per pod" />
            </div>
          )}
          {isLive && !meta && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <SummaryCard label="Scale-up Latency" value="..." sub="Measuring..." />
              <SummaryCard label="Peak Replicas" value="..." sub="Measuring..." />
              <SummaryCard label="Scale-down Start" value="..." sub="Waiting for cooldown" />
              <SummaryCard label="RPS / Pod" value="..." sub="Waiting for results" />
            </div>
          )}

          {/* Pod Scaling Timeline */}
          {replicaChartData.length > 0 ? (
            <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 p-4">
              <h2 className="text-sm font-medium text-slate-300 mb-3">Pod Scaling Timeline</h2>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={replicaChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="timeLabel" stroke="#64748b" fontSize={10}
                    interval="equidistantPreserveStart" tickCount={8}
                    angle={-30} textAnchor="end" height={50}
                    label={{ value: 'Time', position: 'insideBottom', offset: -5, ...AXIS_LABEL }}
                  />
                  <YAxis
                    stroke="#64748b" fontSize={10} allowDecimals={false} domain={[0, 'auto']}
                    label={{ value: 'Replicas', angle: -90, position: 'insideLeft', offset: 10, ...AXIS_LABEL }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                    labelStyle={{ color: '#94a3b8' }} itemStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8', paddingTop: 8 }} />

                  {/* Load phase */}
                  {testStart > 0 && testEnd > 0 && (() => {
                    const startLabel = replicaChartData.find(d => d.time >= testStart)?.timeLabel;
                    const endLabel = [...replicaChartData].reverse().find(d => d.time <= testEnd)?.timeLabel;
                    if (startLabel && endLabel) {
                      return <ReferenceArea x1={startLabel} x2={endLabel} fill="#3b82f6" fillOpacity={0.08} stroke="#3b82f6" strokeOpacity={0.2} strokeDasharray="4 4" />;
                    }
                    return null;
                  })()}
                  {/* Cooldown phase */}
                  {testEnd > 0 && cooldownEnd > 0 && (() => {
                    const startLabel = replicaChartData.find(d => d.time >= testEnd)?.timeLabel;
                    const endLabel = [...replicaChartData].reverse().find(d => d.time <= cooldownEnd)?.timeLabel;
                    if (startLabel && endLabel && startLabel !== endLabel) {
                      return <ReferenceArea x1={startLabel} x2={endLabel} fill="#f59e0b" fillOpacity={0.05} stroke="#f59e0b" strokeOpacity={0.15} strokeDasharray="4 4" />;
                    }
                    return null;
                  })()}

                  {deploymentNames.map((name, i) => (
                    <Area key={name} type="stepAfter" dataKey={name} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.15} strokeWidth={2} dot={false} isAnimationActive={false} />
                  ))}

                  {scalingSnapshots.length > 0 && (() => {
                    const latest = scalingSnapshots[scalingSnapshots.length - 1];
                    return latest.hpas
                      .filter(h => deploymentNames.includes(h.deployment))
                      .map((h, i) => (
                        <ReferenceLine key={`max-${h.deployment}`} y={h.maxReplicas} stroke={COLORS[i % COLORS.length]} strokeDasharray="4 4" strokeOpacity={0.3}
                          label={{ value: `max ${h.maxReplicas}`, position: 'right', fill: '#64748b', fontSize: 10 }} />
                      ));
                  })()}
                </AreaChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-center gap-6 mt-2 text-[10px] text-slate-500">
                <span className="flex items-center gap-1"><span className="inline-block w-4 h-2 bg-blue-500/20 border border-blue-500/40 rounded-sm" /> Load Phase</span>
                <span className="flex items-center gap-1"><span className="inline-block w-4 h-2 bg-amber-500/15 border border-amber-500/30 rounded-sm" /> Cooldown</span>
                <span className="flex items-center gap-1"><span className="inline-block w-4 h-0 border-t border-dashed border-slate-500" style={{ width: 16 }} /> Max Replicas</span>
              </div>
            </div>
          ) : isLive ? (
            <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 p-12 text-center">
              <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <div className="text-slate-400 text-sm">Collecting scaling data...</div>
            </div>
          ) : null}

          {/* 2-column: Throughput vs Pods + Per-Pod Efficiency */}
          {replicaChartData.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 p-4">
                <h2 className="text-sm font-medium text-slate-300 mb-3">Throughput vs Pod Count</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={replicaChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      dataKey="timeLabel" stroke="#64748b" fontSize={9}
                      interval="equidistantPreserveStart" tickCount={5}
                      angle={-30} textAnchor="end" height={45}
                      label={{ value: 'Time', position: 'insideBottom', offset: -5, ...AXIS_LABEL }}
                    />
                    <YAxis yAxisId="left" stroke="#3b82f6" fontSize={10} allowDecimals={false} domain={[0, 'auto']}
                      label={{ value: 'Replicas', angle: -90, position: 'insideLeft', offset: 10, fill: '#3b82f6', fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" stroke="#22c55e" fontSize={10} domain={[0, 'auto']}
                      label={{ value: 'RPS (req/s)', angle: 90, position: 'insideRight', offset: 10, fill: '#22c55e', fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#94a3b8' }} itemStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 10, color: '#94a3b8', paddingTop: 4 }} />
                    <Area yAxisId="left" type="stepAfter" dataKey="_totalReplicas" name="Total Replicas" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} dot={false} isAnimationActive={false} />
                    {rps != null && (
                      <ReferenceLine yAxisId="right" y={rps} stroke="#22c55e" strokeDasharray="6 3" strokeWidth={2}
                        label={{ value: `${rps.toFixed(0)} RPS`, position: 'right', fill: '#22c55e', fontSize: 11, fontWeight: 600 }} />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 p-4">
                <h2 className="text-sm font-medium text-slate-300 mb-3">Per-Pod Efficiency</h2>
                {efficiencyChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={efficiencyChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis
                        dataKey="timeLabel" stroke="#64748b" fontSize={9}
                        interval="equidistantPreserveStart" tickCount={5}
                        angle={-30} textAnchor="end" height={45}
                        label={{ value: 'Time', position: 'insideBottom', offset: -5, ...AXIS_LABEL }}
                      />
                      <YAxis stroke="#64748b" fontSize={10} domain={[0, 'auto']}
                        label={{ value: 'RPS / Pod', angle: -90, position: 'insideLeft', offset: 10, ...AXIS_LABEL }} />
                      <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#94a3b8' }} itemStyle={{ fontSize: 12 }}
                        formatter={(v: number) => [`${v} req/s`, 'RPS/Pod']} />
                      <Line type="monotone" dataKey="rpsPerPod" name="RPS/Pod" stroke="#a855f7" strokeWidth={2} dot={false} isAnimationActive={false} />
                      {meta?.avgRpsPerPod != null && (
                        <ReferenceLine y={meta.avgRpsPerPod} stroke="#a855f7" strokeDasharray="4 4" strokeOpacity={0.5}
                          label={{ value: `avg ${meta.avgRpsPerPod.toFixed(1)}`, position: 'right', fill: '#a855f7', fontSize: 10 }} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[220px] text-slate-500 text-xs">
                    {isLive ? 'Waiting for test results...' : 'No RPS data available'}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== Detail Analysis Button ===== */}
          {(meta || isLive) && (
            <button
              onClick={() => setShowDetail(!showDetail)}
              className="w-full bg-slate-800/80 rounded-xl border border-slate-700/60 px-4 py-3 flex items-center justify-center gap-2 text-sm font-medium text-blue-400 hover:text-blue-300 hover:border-blue-500/40 transition-colors"
            >
              <svg className={`w-4 h-4 transition-transform ${showDetail ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
              {showDetail ? 'Hide Detailed Analysis' : 'Show Detailed Analysis'}
            </button>
          )}

          {/* ===== Detail Analysis Panel ===== */}
          {showDetail && (
            <div className="space-y-4">
              {/* Test Config Summary */}
              <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-700/60">
                  <h2 className="text-sm font-medium text-slate-300">Test Configuration</h2>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    <div>
                      <span className="text-slate-500 block mb-0.5">Scenario</span>
                      <span className="text-slate-200 font-medium">{selectedTest.scenarioName || selectedTest.id}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-0.5">Cluster</span>
                      <span className="text-slate-200 font-medium">{selectedTest.cluster}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-0.5">VUs</span>
                      <span className="text-slate-200 font-medium">{selectedTest.scalingConfig?.vus ?? selectedTest.config?.vus ?? '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-0.5">Duration</span>
                      <span className="text-slate-200 font-medium">{selectedTest.scalingConfig?.duration ?? selectedTest.config?.duration ?? '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-0.5">Ramp-up</span>
                      <span className="text-slate-200 font-medium">{selectedTest.scalingConfig?.rampUp ?? 'None'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-0.5">Cooldown</span>
                      <span className="text-slate-200 font-medium">{selectedTest.scalingConfig?.cooldownSec ?? 60}s</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-0.5">Target URL</span>
                      <span className="text-slate-200 font-medium font-mono truncate block">{selectedTest.scalingConfig?.targetUrl ?? selectedTest.config?.targetUrl ?? '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-0.5">Total Duration</span>
                      <span className="text-slate-200 font-medium">
                        {selectedTest.completedAt
                          ? `${((selectedTest.completedAt - selectedTest.startedAt) / 1000).toFixed(0)}s`
                          : 'Running...'}
                      </span>
                    </div>
                  </div>
                  {/* k6 results summary */}
                  {selectedTest.results && (
                    <div className="mt-4 pt-4 border-t border-slate-700/60">
                      <div className="text-xs text-slate-500 mb-2 uppercase tracking-wider font-medium">k6 Results</div>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-xs">
                        <div><span className="text-slate-500 block">p95</span><span className="text-slate-200 font-mono">{selectedTest.results.p95Latency?.toFixed(1) ?? '—'}ms</span></div>
                        <div><span className="text-slate-500 block">p99</span><span className="text-slate-200 font-mono">{selectedTest.results.p99Latency?.toFixed(1) ?? '—'}ms</span></div>
                        <div><span className="text-slate-500 block">Avg</span><span className="text-slate-200 font-mono">{selectedTest.results.avgLatency?.toFixed(1) ?? '—'}ms</span></div>
                        <div><span className="text-slate-500 block">RPS</span><span className="text-slate-200 font-mono">{selectedTest.results.rps?.toFixed(1) ?? '—'}</span></div>
                        <div><span className="text-slate-500 block">Error Rate</span><span className="text-slate-200 font-mono">{selectedTest.results.errorRate != null ? `${(selectedTest.results.errorRate * 100).toFixed(2)}%` : '—'}</span></div>
                        <div><span className="text-slate-500 block">Total Reqs</span><span className="text-slate-200 font-mono">{selectedTest.results.totalRequests?.toLocaleString() ?? '—'}</span></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Per-Deployment Before/After Comparison */}
              {deploymentComparison.length > 0 && (
                <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-700/60">
                    <h2 className="text-sm font-medium text-slate-300">Per-Deployment Scaling Comparison (Baseline → Peak → Final)</h2>
                  </div>
                  <div className="p-4 space-y-4">
                    {deploymentComparison.map((d, i) => {
                      const replicaDelta = d.peakReplicas - d.baselineReplicas;
                      const scalePercent = d.baselineReplicas > 0 ? ((replicaDelta / d.baselineReplicas) * 100).toFixed(0) : '—';
                      const cpuDelta = d.baselineCpu != null && d.peakCpu != null ? d.peakCpu - d.baselineCpu : null;

                      return (
                        <div key={d.deployment} className="bg-slate-900/60 rounded-xl border border-slate-700/60 p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                            <span className="text-sm font-medium text-slate-200">{d.deployment}</span>
                            <span className="text-[10px] text-slate-500 font-mono">({d.minReplicas}–{d.maxReplicas} range, target CPU {d.targetCpu}%)</span>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                            <div className="text-center">
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Baseline</div>
                              <div className="text-lg font-bold text-slate-400 font-mono">{d.baselineReplicas}</div>
                              <div className="text-[10px] text-slate-600">pods</div>
                            </div>
                            <div className="text-center">
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Peak</div>
                              <div className="text-lg font-bold text-white font-mono">{d.peakReplicas}</div>
                              <div className="text-[10px] text-slate-600">pods</div>
                            </div>
                            <div className="text-center">
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Delta</div>
                              <div className={`text-lg font-bold font-mono ${replicaDelta > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                                {replicaDelta > 0 ? '+' : ''}{replicaDelta}
                              </div>
                              <div className="text-[10px] text-slate-600">{scalePercent !== '—' ? `${scalePercent}% increase` : ''}</div>
                            </div>
                            <div className="text-center">
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Final</div>
                              <div className={`text-lg font-bold font-mono ${d.finalReplicas === d.baselineReplicas ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {d.finalReplicas}
                              </div>
                              <div className="text-[10px] text-slate-600">{d.finalReplicas === d.baselineReplicas ? 'recovered' : 'scaling'}</div>
                            </div>
                            <div className="text-center">
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">CPU Peak</div>
                              <div className={`text-lg font-bold font-mono ${d.peakCpu != null && d.peakCpu > d.targetCpu ? 'text-red-400' : 'text-slate-300'}`}>
                                {d.peakCpu != null ? `${d.peakCpu}%` : '—'}
                              </div>
                              <div className="text-[10px] text-slate-600">
                                {cpuDelta != null ? `${cpuDelta > 0 ? '+' : ''}${cpuDelta}% from ${d.baselineCpu}%` : ''}
                              </div>
                            </div>
                          </div>
                          {/* Mini replica progress bar */}
                          <div className="mt-3 h-2 bg-slate-700 rounded-full overflow-hidden relative">
                            {/* Baseline marker */}
                            <div className="absolute h-full bg-slate-500/30 rounded-full" style={{ width: `${(d.baselineReplicas / d.maxReplicas) * 100}%` }} />
                            {/* Peak fill */}
                            <div className="absolute h-full rounded-full transition-all" style={{ width: `${(d.peakReplicas / d.maxReplicas) * 100}%`, backgroundColor: COLORS[i % COLORS.length], opacity: 0.6 }} />
                            {/* Final marker */}
                            <div className="absolute h-full w-0.5 bg-white/60" style={{ left: `${(d.finalReplicas / d.maxReplicas) * 100}%` }} />
                          </div>
                          <div className="flex justify-between text-[10px] text-slate-600 mt-0.5">
                            <span>0</span>
                            <span>max {d.maxReplicas}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* CPU Utilization Timeline */}
              {cpuChartData.length > 0 && deploymentNames.length > 0 && (
                <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 p-4">
                  <h2 className="text-sm font-medium text-slate-300 mb-3">CPU Utilization Timeline (%)</h2>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={cpuChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis
                        dataKey="timeLabel" stroke="#64748b" fontSize={10}
                        interval="equidistantPreserveStart" tickCount={8}
                        angle={-30} textAnchor="end" height={50}
                        label={{ value: 'Time', position: 'insideBottom', offset: -5, ...AXIS_LABEL }}
                      />
                      <YAxis stroke="#64748b" fontSize={10} domain={[0, 100]} tickFormatter={v => `${v}%`}
                        label={{ value: 'CPU Utilization (%)', angle: -90, position: 'insideLeft', offset: 10, ...AXIS_LABEL }} />
                      <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#94a3b8' }} itemStyle={{ fontSize: 12 }}
                        formatter={(value: number | null) => [value != null ? `${value}%` : 'N/A']} />
                      <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8', paddingTop: 8 }} />

                      {/* Load phase */}
                      {testStart > 0 && testEnd > 0 && (() => {
                        const startLabel = cpuChartData.find(d => d.time >= testStart)?.timeLabel;
                        const endLabel = [...cpuChartData].reverse().find(d => d.time <= testEnd)?.timeLabel;
                        if (startLabel && endLabel) {
                          return <ReferenceArea x1={startLabel} x2={endLabel} fill="#3b82f6" fillOpacity={0.06} />;
                        }
                        return null;
                      })()}

                      {deploymentNames.map((name, i) => (
                        <Line key={name} type="monotone" dataKey={name} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                      ))}
                      {/* Target CPU lines */}
                      {scalingSnapshots.length > 0 && (() => {
                        const latest = scalingSnapshots[scalingSnapshots.length - 1];
                        return latest.hpas
                          .filter(h => deploymentNames.includes(h.deployment))
                          .map((h, i) => (
                            <ReferenceLine key={`target-${h.deployment}`} y={h.targetCpuPercent}
                              stroke={COLORS[i % COLORS.length]} strokeDasharray="4 4" strokeOpacity={0.4}
                              label={{ value: `target ${h.targetCpuPercent}%`, position: 'right', fill: COLORS[i % COLORS.length], fontSize: 10, opacity: 0.6 }} />
                          ));
                      })()}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* HPA Event Log (detail mode always shows) */}
              {eventLog.length > 0 && (
                <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-700/60">
                    <h2 className="text-sm font-medium text-slate-300">HPA Event Log ({eventLog.length} scaling events)</h2>
                  </div>
                  <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-800">
                        <tr className="text-slate-400 border-b border-slate-700/60">
                          <th className="text-left px-4 py-2 font-medium">Time</th>
                          <th className="text-left px-4 py-2 font-medium">Phase</th>
                          <th className="text-left px-4 py-2 font-medium">Deployment</th>
                          <th className="text-center px-4 py-2 font-medium">Replicas</th>
                          <th className="text-center px-4 py-2 font-medium">CPU %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {eventLog.map((ev, i) => (
                          <tr key={i} className="border-b border-slate-700/30 hover:bg-slate-700/20 text-slate-300">
                            <td className="px-4 py-1.5 font-mono text-slate-400">{new Date(ev.time).toLocaleTimeString()}</td>
                            <td className="px-4 py-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                ev.phase === 'Baseline' ? 'bg-slate-500/15 text-slate-400' :
                                ev.phase === 'Load' ? 'bg-blue-500/15 text-blue-400' :
                                'bg-amber-500/15 text-amber-400'
                              }`}>{ev.phase}</span>
                            </td>
                            <td className="px-4 py-1.5 font-mono">{ev.deployment}</td>
                            <td className="px-4 py-1.5 text-center font-bold">{ev.replicas}</td>
                            <td className="px-4 py-1.5 text-center text-slate-400">{ev.cpu != null ? `${ev.cpu}%` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== Summary view sections (when detail is hidden) ===== */}
          {!showDetail && (
            <>
              {/* Traffic Flow */}
              <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-700/60 flex items-center justify-between">
                  <h2 className="text-sm font-medium text-slate-300">Traffic Flow {isLive ? '(Live)' : `— ${selectedCluster}`}</h2>
                  {traffic && <span className="text-xs text-slate-500">{traffic.flows.length} flows captured</span>}
                </div>
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-800">
                      <tr className="text-slate-400 border-b border-slate-700/60">
                        <th className="text-left px-4 py-2 font-medium">Source</th>
                        <th className="text-left px-4 py-2 font-medium">Destination</th>
                        <th className="text-center px-4 py-2 font-medium">Flows</th>
                        <th className="text-center px-4 py-2 font-medium">Forwarded</th>
                        <th className="text-center px-4 py-2 font-medium">Dropped</th>
                        <th className="text-left px-4 py-2 font-medium">Protocol</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trafficEdges.slice(0, 20).map((e, i) => (
                        <tr key={i} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                          <td className="px-4 py-1.5 text-slate-200">
                            <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: nsColor(e.sourceNs) }} />
                            <span className="font-mono">{e.sourceService}</span>
                            <span className="text-slate-600 ml-1">({e.sourceNs})</span>
                          </td>
                          <td className="px-4 py-1.5 text-slate-200">
                            <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: nsColor(e.targetNs) }} />
                            <span className="font-mono">{e.targetService}</span>
                            <span className="text-slate-600 ml-1">({e.targetNs})</span>
                          </td>
                          <td className="px-4 py-1.5 text-center text-slate-300 font-mono font-bold">{e.flowCount}</td>
                          <td className="px-4 py-1.5 text-center text-emerald-400 font-mono">{e.forwardedCount}</td>
                          <td className="px-4 py-1.5 text-center font-mono">
                            {e.droppedCount > 0 ? <span className="text-red-400">{e.droppedCount}</span> : <span className="text-slate-600">0</span>}
                          </td>
                          <td className="px-4 py-1.5 text-slate-400">{e.protocols.join(', ')}</td>
                        </tr>
                      ))}
                      {trafficEdges.length === 0 && (
                        <tr><td colSpan={6} className="text-center py-8 text-slate-500">
                          {!traffic ? 'Loading traffic data...' : 'No traffic flows detected.'}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Infrastructure Impact */}
              {clusterVms.length > 0 && (
                <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-700/60">
                    <h2 className="text-sm font-medium text-slate-300">
                      Infrastructure Impact — {selectedCluster}
                      {isLive && <span className="text-emerald-400 ml-2 text-xs">(Live)</span>}
                    </h2>
                  </div>
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {clusterVms.map(vm => {
                      const r = vm.resources;
                      if (!r) return (
                        <div key={vm.name} className="bg-slate-900/60 rounded-xl border border-slate-700/60 p-4">
                          <div className="text-sm font-mono text-slate-300 mb-2">{vm.name}</div>
                          <div className="text-xs text-slate-500">No resource data</div>
                        </div>
                      );
                      return (
                        <div key={vm.name} className="bg-slate-900/60 rounded-xl border border-slate-700/60 p-4">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-mono text-slate-200">{vm.name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${vm.status === 'running' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>{vm.status}</span>
                          </div>
                          <div className="space-y-2">
                            <ResourceBar label="CPU" value={r.cpuPercent} />
                            <ResourceBar label="Memory" value={r.memoryPercent} detail={`${(r.memoryUsedMb / 1024).toFixed(1)}G / ${(r.memoryTotalMb / 1024).toFixed(1)}G`} />
                            <ResourceBar label="Disk" value={r.diskPercent} detail={`${r.diskUsedGb.toFixed(1)}G / ${r.diskTotalGb.toFixed(1)}G`} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Collapsed event log */}
              {eventLog.length > 0 && (
                <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 overflow-hidden">
                  <button onClick={() => setShowEventLog(!showEventLog)} className="w-full px-4 py-3 flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors">
                    <svg className={`w-3 h-3 transition-transform ${showEventLog ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" />
                    </svg>
                    <span className="font-medium">HPA Event Log</span>
                    <span className="text-xs text-slate-500">({eventLog.length} events)</span>
                  </button>
                  {showEventLog && (
                    <div className="border-t border-slate-700/60 overflow-x-auto max-h-64 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-800">
                          <tr className="text-slate-400 border-b border-slate-700/60">
                            <th className="text-left px-4 py-2 font-medium">Time</th>
                            <th className="text-left px-4 py-2 font-medium">Phase</th>
                            <th className="text-left px-4 py-2 font-medium">Deployment</th>
                            <th className="text-center px-4 py-2 font-medium">Replicas</th>
                            <th className="text-center px-4 py-2 font-medium">CPU %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {eventLog.map((ev, i) => (
                            <tr key={i} className="border-b border-slate-700/30 hover:bg-slate-700/20 text-slate-300">
                              <td className="px-4 py-1.5 font-mono text-slate-400">{new Date(ev.time).toLocaleTimeString()}</td>
                              <td className="px-4 py-1.5">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  ev.phase === 'Baseline' ? 'bg-slate-500/15 text-slate-400' : ev.phase === 'Load' ? 'bg-blue-500/15 text-blue-400' : 'bg-amber-500/15 text-amber-400'
                                }`}>{ev.phase}</span>
                              </td>
                              <td className="px-4 py-1.5 font-mono">{ev.deployment}</td>
                              <td className="px-4 py-1.5 text-center font-bold">{ev.replicas}</td>
                              <td className="px-4 py-1.5 text-center text-slate-400">{ev.cpu != null ? `${ev.cpu}%` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ========== Sub-components ==========

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 p-4">
      <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold text-white font-mono">{value}</div>
      <div className="text-[10px] text-slate-500 mt-1">{sub}</div>
    </div>
  );
}

function ResourceBar({ label, value, detail }: { label: string; value: number; detail?: string }) {
  const color = value >= 90 ? 'bg-red-500' : value >= 70 ? 'bg-yellow-500' : 'bg-emerald-500';
  const textColor = value >= 90 ? 'text-red-400' : value >= 70 ? 'text-yellow-400' : 'text-slate-300';
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-400">{label}</span>
        <span className={textColor}>{value.toFixed(1)}%{detail && <span className="text-slate-600 ml-1">({detail})</span>}</span>
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}
