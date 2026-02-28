import { useState, useCallback, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceArea, ReferenceLine,
} from 'recharts';
import { usePolling } from '../hooks/usePolling.js';
import type {
  ClusterInfo, TestRun, TestType, CustomLoadConfig, StressConfig,
  TestScenario, ScalingDataPoint, ScalingTestConfig, ScalingTestMeta,
} from '../../shared/types.js';

interface Props {
  clusters: ClusterInfo[];
}

// ============ Preset Scenarios ============
const SCENARIOS: TestScenario[] = [
  {
    name: 'Light Load',
    description: '10 VUs, 15s — baseline performance check',
    type: 'custom-load',
    config: { vus: 10, duration: '15s', targetUrl: 'http://nginx-web.demo.svc.cluster.local' },
  },
  {
    name: 'Standard Load',
    description: '50 VUs, 30s — normal traffic simulation',
    type: 'load',
    config: { vus: 50, duration: '30s', targetUrl: 'http://nginx-web.demo.svc.cluster.local' },
  },
  {
    name: 'Heavy Load',
    description: '200 VUs, 60s — peak traffic stress test',
    type: 'custom-load',
    config: { vus: 200, duration: '60s', targetUrl: 'http://nginx-web.demo.svc.cluster.local' },
  },
  {
    name: 'Ramp-up Test',
    description: '0→100 VUs ramp (10s), sustain 30s',
    type: 'custom-load',
    config: { vus: 100, duration: '30s', targetUrl: 'http://nginx-web.demo.svc.cluster.local', rampUp: '10s' },
  },
  {
    name: 'Httpbin API',
    description: '30 VUs, 20s — target httpbin /get',
    type: 'custom-load',
    config: { vus: 30, duration: '20s', targetUrl: 'http://httpbin.demo.svc.cluster.local/get' },
  },
  {
    name: 'Strict SLA',
    description: '50 VUs, 30s — p95<500ms, err<1%',
    type: 'custom-load',
    config: { vus: 50, duration: '30s', targetUrl: 'http://nginx-web.demo.svc.cluster.local', thresholdP95: 500, thresholdErrorRate: 0.01 },
  },
  // ---------- Scaling Tests ----------
  {
    name: 'Scale Test — Light',
    description: '30 VUs, 60s + 60s cooldown — observe HPA scaling',
    type: 'scaling-test',
    scalingConfig: {
      vus: 30, duration: '60s',
      targetUrl: 'http://nginx-web.demo.svc.cluster.local',
      cooldownSec: 60,
    },
  },
  {
    name: 'Scale Test — Heavy',
    description: '200 VUs, 120s + 60s cooldown — full HPA stress',
    type: 'scaling-test',
    scalingConfig: {
      vus: 200, duration: '120s',
      targetUrl: 'http://nginx-web.demo.svc.cluster.local',
      cooldownSec: 60,
    },
  },
  {
    name: 'Scale Test — Ramp',
    description: '0→150 VUs ramp 30s, sustain 60s + 60s cooldown',
    type: 'scaling-test',
    scalingConfig: {
      vus: 150, duration: '60s', rampUp: '30s',
      targetUrl: 'http://nginx-web.demo.svc.cluster.local',
      cooldownSec: 60,
    },
  },
  // ---------- Stress ----------
  {
    name: 'CPU Light',
    description: '1 worker, 30s — single core',
    type: 'stress-cpu',
    stressConfig: { workers: 1, timeout: '30s' },
  },
  {
    name: 'CPU Heavy',
    description: '2 workers, 60s — multi-core',
    type: 'stress-cpu',
    stressConfig: { workers: 2, timeout: '60s' },
  },
  {
    name: 'Mem 64M',
    description: '1 worker, 30s, 64MB alloc',
    type: 'stress-memory',
    stressConfig: { workers: 1, timeout: '30s', vmBytes: '64M' },
  },
  {
    name: 'Mem 128M',
    description: '2 workers, 60s, 128MB alloc',
    type: 'stress-memory',
    stressConfig: { workers: 2, timeout: '60s', vmBytes: '128M' },
  },
];

function parseDurationSec(d: string): number {
  const m = d.match(/^(\d+)(s|m|h)?$/);
  if (!m) return 30;
  const val = parseInt(m[1]);
  if (m[2] === 'm') return val * 60;
  if (m[2] === 'h') return val * 3600;
  return val;
}

const TYPE_LABELS: Record<string, string> = {
  load: 'Load (k6)',
  'stress-cpu': 'CPU Stress',
  'stress-memory': 'Mem Stress',
  'custom-load': 'Load (k6)',
  'scaling-test': 'Scale Test',
};

function getTypeTag(type: TestType) {
  if (type === 'scaling-test') return { label: 'SCALE', cls: 'bg-purple-500/15 text-purple-400 border-purple-500/30' };
  if (type === 'load' || type === 'custom-load') return { label: 'HTTP', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' };
  if (type === 'stress-cpu') return { label: 'CPU', cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30' };
  return { label: 'MEM', cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30' };
}

const SCALE_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7', '#06b6d4'];

export function TestingPage({ clusters }: Props) {
  const [selectedCluster, setSelectedCluster] = useState('dev');
  const [activeTab, setActiveTab] = useState<'scenarios' | 'custom'>('scenarios');
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // Custom form state
  const [customType, setCustomType] = useState<TestType>('custom-load');
  const [customConfig, setCustomConfig] = useState<CustomLoadConfig>({
    vus: 50, duration: '30s', targetUrl: 'http://nginx-web.demo.svc.cluster.local',
  });
  const [customStress, setCustomStress] = useState<StressConfig>({
    workers: 1, timeout: '30s', vmBytes: '64M',
  });

  const { data: tests } = usePolling<TestRun[]>('/api/tests/status', 2000, { raw: true });
  const { data: scalingData } = usePolling<ScalingDataPoint[]>(
    `/api/scaling/${selectedCluster}`, 3000, { raw: true }
  );

  const latestHpas = useMemo(() => {
    if (!scalingData || scalingData.length === 0) return [];
    return scalingData[scalingData.length - 1].hpas;
  }, [scalingData]);

  const hasRunningTest = useMemo(() => {
    if (!tests) return false;
    return tests.some(t => t.status === 'running' || t.status === 'pending');
  }, [tests]);

  const runTest = useCallback(async (
    type: TestType,
    config?: CustomLoadConfig,
    stressConfig?: StressConfig,
    scenarioName?: string,
    scalingConfig?: ScalingTestConfig,
  ) => {
    setLaunching(true);
    setLaunchError(null);
    try {
      const res = await fetch('/api/tests/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, cluster: selectedCluster, config, stressConfig, scenarioName, scalingConfig }),
      });
      if (!res.ok) {
        const data = await res.json();
        setLaunchError(data.error || 'Failed to start test');
      }
    } catch (e: any) {
      setLaunchError(e.message);
    } finally {
      setLaunching(false);
    }
  }, [selectedCluster]);

  const deleteTest = useCallback(async (id: string) => {
    try {
      await fetch(`/api/tests/${id}`, { method: 'DELETE' });
    } catch (e) {
      console.error('Failed to delete test:', e);
    }
  }, []);

  const downloadCsv = useCallback(() => {
    window.open('/api/tests/export', '_blank');
  }, []);

  const runScenario = useCallback((scenario: TestScenario) => {
    runTest(scenario.type, scenario.config, scenario.stressConfig, scenario.name, scenario.scalingConfig);
  }, [runTest]);

  const runCustom = useCallback(() => {
    const isStress = customType === 'stress-cpu' || customType === 'stress-memory';
    runTest(
      customType,
      isStress ? undefined : customConfig,
      isStress ? customStress : undefined,
      'Custom',
    );
  }, [runTest, customType, customConfig, customStress]);

  const completedTests = useMemo(() =>
    tests?.filter(t => t.status === 'completed' || t.status === 'failed') || [],
  [tests]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">SRE Testing</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Load, stress, and scaling tests with real-time monitoring
          </p>
        </div>
        <div className="flex items-center gap-3">
          {completedTests.length > 0 && (
            <button
              onClick={downloadCsv}
              className="flex items-center gap-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </button>
          )}
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
      </div>

      {/* Status bar */}
      {hasRunningTest && (
        <div className="flex items-center gap-2 text-sm text-yellow-400 bg-yellow-500/15 border border-yellow-500/30 px-4 py-2.5 rounded-xl">
          <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin shrink-0" />
          Test running — wait for completion before starting another
        </div>
      )}
      {launchError && (
        <div className="text-sm text-red-400 bg-red-500/15 border border-red-500/30 px-4 py-2.5 rounded-xl">{launchError}</div>
      )}

      {/* HPA Status Widget */}
      {latestHpas.length > 0 && (
        <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 p-4">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">HPA Status — {selectedCluster}</div>
          <div className="flex flex-wrap gap-4">
            {latestHpas.map(hpa => {
              const isScaling = hpa.currentReplicas !== hpa.desiredReplicas;
              const isAtMax = hpa.currentReplicas >= hpa.maxReplicas;
              const cpuOver = hpa.currentCpuPercent != null && hpa.currentCpuPercent > hpa.targetCpuPercent;
              return (
                <div key={hpa.name} className="flex items-center gap-3 bg-slate-900/60 rounded-xl px-4 py-3 border border-slate-700/60">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-slate-400 truncate">{hpa.deployment}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-sm font-bold text-white">{hpa.currentReplicas}</span>
                      {hpa.currentReplicas !== hpa.desiredReplicas && (
                        <>
                          <span className="text-slate-500">→</span>
                          <span className="text-sm font-bold text-yellow-400">{hpa.desiredReplicas}</span>
                        </>
                      )}
                      <span className="text-[10px] text-slate-600">/ {hpa.maxReplicas} max</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    <span className={`text-xs font-mono ${cpuOver ? 'text-red-400' : 'text-slate-400'}`}>
                      CPU {hpa.currentCpuPercent ?? '—'}%
                    </span>
                    {isScaling && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/15 text-yellow-400 rounded font-medium">SCALING</span>
                    )}
                    {isAtMax && !isScaling && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-red-500/15 text-red-400 rounded font-medium">AT MAX</span>
                    )}
                    {!isScaling && !isAtMax && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 rounded font-medium">STABLE</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Test Controls */}
        <div className="space-y-4">
          {/* Tabs */}
          <div className="flex bg-slate-800/80 rounded-xl overflow-hidden border border-slate-700/60">
            <button
              onClick={() => setActiveTab('scenarios')}
              className={`flex-1 text-sm py-2 font-medium transition-colors ${activeTab === 'scenarios' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >Scenarios</button>
            <button
              onClick={() => setActiveTab('custom')}
              className={`flex-1 text-sm py-2 font-medium transition-colors ${activeTab === 'custom' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >Custom</button>
          </div>

          {activeTab === 'scenarios' ? (
            <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-auto pr-1">
              {SCENARIOS.map((s, i) => {
                const tag = getTypeTag(s.type);
                return (
                  <button
                    key={i}
                    onClick={() => runScenario(s)}
                    disabled={launching || hasRunningTest}
                    className="w-full text-left rounded-xl border border-slate-700/60 hover:border-slate-500 bg-slate-800/80 hover:bg-slate-700/50 p-4 disabled:opacity-40 transition-all group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-white group-hover:text-blue-300 transition-colors truncate">{s.name}</span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${tag.cls}`}>{tag.label}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 truncate">{s.description}</div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-700/60 bg-slate-800/80 p-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1.5">Test Type</label>
                <select
                  value={customType}
                  onChange={e => setCustomType(e.target.value as TestType)}
                  className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="custom-load">Load Test (k6)</option>
                  <option value="stress-cpu">CPU Stress</option>
                  <option value="stress-memory">Memory Stress</option>
                </select>
              </div>

              {customType === 'custom-load' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Virtual Users</label>
                      <input type="number" value={customConfig.vus}
                        onChange={e => setCustomConfig(c => ({ ...c, vus: parseInt(e.target.value) || 10 }))}
                        className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Duration</label>
                      <input type="text" value={customConfig.duration}
                        onChange={e => setCustomConfig(c => ({ ...c, duration: e.target.value }))}
                        className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                        placeholder="30s"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Target URL</label>
                    <input type="text" value={customConfig.targetUrl}
                      onChange={e => setCustomConfig(c => ({ ...c, targetUrl: e.target.value }))}
                      className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Ramp-up</label>
                      <input type="text" value={customConfig.rampUp || ''}
                        onChange={e => setCustomConfig(c => ({ ...c, rampUp: e.target.value || undefined }))}
                        className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                        placeholder="e.g. 10s"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">p95 (ms)</label>
                      <input type="number" value={customConfig.thresholdP95 ?? 2000}
                        onChange={e => setCustomConfig(c => ({ ...c, thresholdP95: parseInt(e.target.value) || 2000 }))}
                        className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                </>
              )}

              {(customType === 'stress-cpu' || customType === 'stress-memory') && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Workers</label>
                      <input type="number" value={customStress.workers}
                        onChange={e => setCustomStress(c => ({ ...c, workers: parseInt(e.target.value) || 1 }))}
                        className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Timeout</label>
                      <input type="text" value={customStress.timeout}
                        onChange={e => setCustomStress(c => ({ ...c, timeout: e.target.value }))}
                        className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                        placeholder="30s"
                      />
                    </div>
                  </div>
                  {customType === 'stress-memory' && (
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">VM Bytes</label>
                      <input type="text" value={customStress.vmBytes || '64M'}
                        onChange={e => setCustomStress(c => ({ ...c, vmBytes: e.target.value }))}
                        className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                        placeholder="64M"
                      />
                    </div>
                  )}
                </>
              )}

              <button
                onClick={runCustom}
                disabled={launching || hasRunningTest}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Run Custom Test
              </button>
            </div>
          )}
        </div>

        {/* Right: Test Results */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-sm font-medium text-slate-300 uppercase tracking-wider">Test Results</h3>
          {(!tests || tests.length === 0) ? (
            <div className="text-center py-16 text-slate-500 text-sm rounded-xl border border-slate-700/60 bg-slate-800/80">
              No tests yet. Select a scenario or configure a custom test.
            </div>
          ) : (
            <div className="space-y-4 max-h-[calc(100vh-240px)] overflow-auto pr-1">
              {[...tests].reverse().map(test => (
                <TestResultCard key={test.id} test={test} onDelete={deleteTest} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Test Result Card ============
function TestResultCard({ test, onDelete }: { test: TestRun; onDelete: (id: string) => void }) {
  const [showLog, setShowLog] = useState(false);
  const [showScaling, setShowScaling] = useState(true);

  const statusStyles: Record<string, { color: string; bg: string; label: string }> = {
    pending:   { color: 'text-slate-400',   bg: 'bg-slate-400/15',   label: 'Pending' },
    running:   { color: 'text-blue-400',    bg: 'bg-blue-400/15',    label: 'Running' },
    completed: { color: 'text-emerald-400', bg: 'bg-emerald-400/15', label: 'Completed' },
    failed:    { color: 'text-red-400',     bg: 'bg-red-400/15',     label: 'Failed' },
  };

  const st = statusStyles[test.status] || statusStyles.pending;

  const elapsed = test.completedAt
    ? ((test.completedAt - test.startedAt) / 1000).toFixed(1)
    : ((Date.now() - test.startedAt) / 1000).toFixed(0);

  const estimatedDuration = useMemo(() => {
    if (test.type === 'scaling-test') {
      const loadDur = parseDurationSec(test.scalingConfig?.duration || test.config?.duration || '60s');
      const rampDur = test.scalingConfig?.rampUp ? parseDurationSec(test.scalingConfig.rampUp) * 2 : 0;
      const cooldown = test.scalingConfig?.cooldownSec ?? 60;
      return loadDur + rampDur + cooldown + 10; // +10 for startup
    }
    if (test.type === 'load') return 30;
    if (test.type === 'custom-load') return parseDurationSec(test.config?.duration || '30s');
    return parseDurationSec(test.stressConfig?.timeout || '30s');
  }, [test]);

  const progress = test.status === 'running' || test.status === 'pending'
    ? Math.min(95, ((Date.now() - test.startedAt) / 1000 / estimatedDuration) * 100)
    : test.status === 'completed' ? 100 : 0;

  const label = test.scenarioName || TYPE_LABELS[test.type] || test.type;

  const borderColor = test.status === 'running' ? 'border-blue-500/40'
    : test.status === 'failed' ? 'border-red-500/30'
    : test.status === 'completed' ? 'border-emerald-500/30'
    : 'border-slate-700/60';

  const isScalingTest = test.type === 'scaling-test';

  return (
    <div className={`rounded-xl border ${borderColor} bg-slate-800/80 p-4`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {(test.status === 'running' || test.status === 'pending') && (
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
          )}
          {test.status === 'completed' && (
            <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
          {test.status === 'failed' && (
            <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          <span className="text-sm font-bold text-white truncate">{label}</span>
          <span className="text-xs text-slate-600 shrink-0">{TYPE_LABELS[test.type]}</span>
          <span className="text-xs text-slate-600 shrink-0">on {test.cluster}</span>
          <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 ${st.color} ${st.bg}`}>{st.label}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className="text-xs text-slate-500 font-mono">{elapsed}s</span>
          <button onClick={() => onDelete(test.id)} className="text-slate-600 hover:text-red-400 text-lg leading-none">&times;</button>
        </div>
      </div>

      {/* Config summary */}
      {(test.config || test.scalingConfig) && (
        <div className="text-xs text-slate-500 mb-2 flex gap-3 flex-wrap">
          {(test.scalingConfig?.vus ?? test.config?.vus) != null && <span>VUs: {test.scalingConfig?.vus ?? test.config?.vus}</span>}
          {(test.scalingConfig?.duration ?? test.config?.duration) && <span>Duration: {test.scalingConfig?.duration ?? test.config?.duration}</span>}
          {(test.scalingConfig?.rampUp ?? test.config?.rampUp) && <span>Ramp: {test.scalingConfig?.rampUp ?? test.config?.rampUp}</span>}
          {isScalingTest && test.scalingConfig?.cooldownSec && <span>Cooldown: {test.scalingConfig.cooldownSec}s</span>}
          {test.config?.thresholdP95 && <span>p95&lt;{test.config.thresholdP95}ms</span>}
        </div>
      )}
      {test.stressConfig && (
        <div className="text-xs text-slate-500 mb-2 flex gap-3 flex-wrap">
          <span>Workers: {test.stressConfig.workers}</span>
          <span>Timeout: {test.stressConfig.timeout}</span>
          {test.stressConfig.vmBytes && <span>Bytes: {test.stressConfig.vmBytes}</span>}
        </div>
      )}

      {/* Progress bar */}
      {(test.status === 'running' || test.status === 'pending') && (
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-500">
              {test.status === 'pending' ? 'Waiting for pod...'
                : isScalingTest && progress > 60 ? 'Cooldown phase...'
                : 'Running...'}
            </span>
            <span className="text-slate-500">{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 bg-slate-900/60 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${
                test.status === 'pending' ? 'bg-slate-500 animate-pulse'
                  : isScalingTest ? 'bg-purple-500'
                  : 'bg-blue-500'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Scaling Test Results */}
      {isScalingTest && test.results?.scalingMeta && (
        <ScalingTestResult
          meta={test.results.scalingMeta}
          expanded={showScaling}
          onToggle={() => setShowScaling(!showScaling)}
        />
      )}

      {/* k6 Metrics */}
      {test.results && (test.type === 'load' || test.type === 'custom-load' || test.type === 'scaling-test') && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
          <MetricBox label="p95 Latency" value={test.results.p95Latency != null ? `${test.results.p95Latency.toFixed(1)}ms` : '-'} color={test.results.p95Latency != null && test.results.p95Latency > 1000 ? 'text-red-400' : 'text-emerald-400'} />
          <MetricBox label="Avg Latency" value={test.results.avgLatency != null ? `${test.results.avgLatency.toFixed(1)}ms` : '-'} />
          <MetricBox label="Error Rate" value={test.results.errorRate != null ? `${(test.results.errorRate * 100).toFixed(2)}%` : '-'} color={test.results.errorRate != null && test.results.errorRate > 0.1 ? 'text-red-400' : 'text-emerald-400'} />
          <MetricBox label="RPS" value={test.results.rps != null ? test.results.rps.toFixed(1) : '-'} />
        </div>
      )}

      {/* stress-ng Metrics */}
      {test.results && (test.type === 'stress-cpu' || test.type === 'stress-memory') && (
        <div className="grid grid-cols-2 gap-2 mt-2">
          {test.results.cpuBogoOps != null && <MetricBox label="CPU Bogo-ops" value={test.results.cpuBogoOps.toLocaleString()} />}
          {test.results.memoryBogoOps != null && <MetricBox label="Memory Bogo-ops" value={test.results.memoryBogoOps.toLocaleString()} />}
        </div>
      )}

      {test.error && (
        <div className="mt-2 text-xs text-red-400 bg-red-500/15 px-3 py-2 rounded-lg">{test.error}</div>
      )}

      {test.results?.rawOutput && (
        <>
          <button onClick={() => setShowLog(!showLog)} className="mt-2 text-xs text-slate-500 hover:text-slate-300 transition-colors">
            {showLog ? 'Hide' : 'Show'} raw output
          </button>
          {showLog && (
            <pre className="mt-2 text-xs text-slate-400 bg-slate-950 p-3 rounded-lg max-h-48 overflow-auto font-mono whitespace-pre-wrap break-all">
              {test.results.rawOutput}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

// ============ Scaling Test Result ============
function ScalingTestResult({ meta, expanded, onToggle }: {
  meta: ScalingTestMeta;
  expanded: boolean;
  onToggle: () => void;
}) {
  const chartData = useMemo(() => {
    if (!meta.scalingSnapshots || meta.scalingSnapshots.length === 0) return [];
    const deployments = new Set<string>();
    for (const s of meta.scalingSnapshots) {
      for (const h of s.hpas) {
        if (meta.targetDeployments.length === 0 || meta.targetDeployments.includes(h.deployment)) {
          deployments.add(h.deployment);
        }
      }
    }
    return meta.scalingSnapshots.map(s => {
      const row: Record<string, any> = {
        time: s.timestamp,
        timeLabel: new Date(s.timestamp).toLocaleTimeString(),
      };
      for (const h of s.hpas) {
        if (deployments.has(h.deployment)) {
          row[h.deployment] = h.currentReplicas;
        }
      }
      return row;
    });
  }, [meta]);

  const deploymentNames = useMemo(() => {
    const names = new Set<string>();
    for (const s of meta.scalingSnapshots) {
      for (const h of s.hpas) {
        if (meta.targetDeployments.length === 0 || meta.targetDeployments.includes(h.deployment)) {
          names.add(h.deployment);
        }
      }
    }
    return Array.from(names);
  }, [meta]);

  // HPA event log: only show points where replicas changed
  const eventLog = useMemo(() => {
    const events: { time: number; phase: string; deployment: string; replicas: number; cpu: number | null }[] = [];
    const prevReplicas: Record<string, number> = {};

    for (const s of meta.scalingSnapshots) {
      const phase = s.timestamp < meta.testStartTimestamp ? 'Baseline'
        : s.timestamp <= meta.testEndTimestamp ? 'Load'
        : 'Cooldown';

      for (const h of s.hpas) {
        if (meta.targetDeployments.length > 0 && !meta.targetDeployments.includes(h.deployment)) continue;
        const key = h.deployment;
        if (prevReplicas[key] === undefined) {
          prevReplicas[key] = h.currentReplicas;
          events.push({ time: s.timestamp, phase, deployment: key, replicas: h.currentReplicas, cpu: h.currentCpuPercent });
        } else if (prevReplicas[key] !== h.currentReplicas) {
          prevReplicas[key] = h.currentReplicas;
          events.push({ time: s.timestamp, phase, deployment: key, replicas: h.currentReplicas, cpu: h.currentCpuPercent });
        }
      }
    }
    return events;
  }, [meta]);

  const fmtMs = (ms: number | null) => {
    if (ms === null) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="mt-3 space-y-3">
      {/* Toggle */}
      <button onClick={onToggle} className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors font-medium">
        <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" />
        </svg>
        Scaling Analysis
      </button>

      {expanded && (
        <>
          {/* 4 Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3">
              <div className="text-[10px] text-purple-300 uppercase tracking-wider mb-1">Scale-up Latency</div>
              <div className="text-lg font-bold text-purple-300 font-mono">{fmtMs(meta.scaleUpLatency)}</div>
            </div>
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3">
              <div className="text-[10px] text-purple-300 uppercase tracking-wider mb-1">Peak Pods</div>
              <div className="text-lg font-bold text-purple-300 font-mono">{meta.peakReplicas}</div>
            </div>
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3">
              <div className="text-[10px] text-purple-300 uppercase tracking-wider mb-1">Scale-down Start</div>
              <div className="text-lg font-bold text-purple-300 font-mono">{fmtMs(meta.scaleDownStarted)}</div>
            </div>
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3">
              <div className="text-[10px] text-purple-300 uppercase tracking-wider mb-1">RPS / Pod</div>
              <div className="text-lg font-bold text-purple-300 font-mono">
                {meta.avgRpsPerPod != null ? meta.avgRpsPerPod.toFixed(1) : '—'}
              </div>
            </div>
          </div>

          {/* Scaling Timeline Chart */}
          {chartData.length > 0 && (
            <div className="bg-slate-900/60 rounded-xl border border-slate-700/60 p-4">
              <h4 className="text-xs font-medium text-slate-400 mb-3">Scaling Timeline</h4>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="timeLabel" stroke="#64748b" fontSize={10}
                    interval="equidistantPreserveStart" tickCount={6}
                    angle={-30} textAnchor="end" height={40}
                  />
                  <YAxis stroke="#64748b" fontSize={10} allowDecimals={false} domain={[0, 'auto']} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                    labelStyle={{ color: '#94a3b8' }} itemStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8', paddingTop: 8 }} />
                  {/* Load phase shading */}
                  {meta.testStartTimestamp > 0 && meta.testEndTimestamp > 0 && (() => {
                    const startLabel = chartData.find(d => d.time >= meta.testStartTimestamp)?.timeLabel;
                    const endLabel = [...chartData].reverse().find(d => d.time <= meta.testEndTimestamp)?.timeLabel;
                    if (startLabel && endLabel) {
                      return (
                        <ReferenceArea
                          x1={startLabel} x2={endLabel}
                          fill="#3b82f6" fillOpacity={0.08}
                          stroke="#3b82f6" strokeOpacity={0.2} strokeDasharray="4 4"
                        />
                      );
                    }
                    return null;
                  })()}
                  {deploymentNames.map((name, i) => (
                    <Area
                      key={name} type="stepAfter" dataKey={name}
                      stroke={SCALE_COLORS[i % SCALE_COLORS.length]}
                      fill={SCALE_COLORS[i % SCALE_COLORS.length]}
                      fillOpacity={0.15} strokeWidth={2} dot={false} isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-2 bg-blue-500/20 border border-blue-500/40 rounded-sm" />
                  Load Phase
                </span>
                <span>Baseline → Load → Cooldown</span>
              </div>
            </div>
          )}

          {/* HPA Event Log */}
          {eventLog.length > 0 && (
            <div className="bg-slate-900/60 rounded-xl border border-slate-700/60 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700/60">
                <h4 className="text-xs font-medium text-slate-400">HPA Event Log ({eventLog.length} events)</h4>
              </div>
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-700/60">
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
                        <td className="px-4 py-1.5 font-mono text-slate-400">
                          {new Date(ev.time).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            ev.phase === 'Baseline' ? 'bg-slate-500/15 text-slate-400' :
                            ev.phase === 'Load' ? 'bg-blue-500/15 text-blue-400' :
                            'bg-amber-500/15 text-amber-400'
                          }`}>{ev.phase}</span>
                        </td>
                        <td className="px-4 py-1.5 font-mono">{ev.deployment}</td>
                        <td className="px-4 py-1.5 text-center font-bold">{ev.replicas}</td>
                        <td className="px-4 py-1.5 text-center text-slate-400">
                          {ev.cpu != null ? `${ev.cpu}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetricBox({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/60">
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div className={`text-sm font-mono font-bold ${color} truncate`}>{value}</div>
    </div>
  );
}
