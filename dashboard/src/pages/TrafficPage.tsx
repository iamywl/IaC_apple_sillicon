import { useState, useMemo } from 'react';
import { usePolling } from '../hooks/usePolling.js';
import type { ClusterInfo, PodInfo, VmInfo, TrafficSummary, AggregatedEdge } from '../../shared/types.js';

interface Props {
  clusters: ClusterInfo[];
  pods: Record<string, PodInfo[]>;
  vms: VmInfo[];
}

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

// ========== Namespace colors ==========
const NS_COLORS: Record<string, string> = {
  'kube-system': '#3b82f6', 'demo': '#10b981', 'monitoring': '#a855f7',
  'argocd': '#f97316', 'istio-system': '#06b6d4', 'istio-ingress': '#14b8a6',
  'cluster': '#64748b', 'default': '#8b5cf6',
};
function nsColor(ns: string): string { return NS_COLORS[ns] || '#64748b'; }

// ========== Service edge aggregation ==========
interface ServiceEdge {
  sourceNs: string;
  sourceService: string;
  targetNs: string;
  targetService: string;
  flowCount: number;
  forwardedCount: number;
  droppedCount: number;
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

// ========== Component ==========
export function TrafficPage({ clusters, pods: _pods, vms: _vms }: Props) {
  const [selected, setSelected] = useState<string>('all');

  const { data: allTraffic } = usePolling<Record<string, TrafficSummary>>(
    '/api/traffic/all', 5000, { raw: true }
  );
  const { data: singleTraffic } = usePolling<TrafficSummary>(
    selected !== 'all' ? `/api/traffic?cluster=${selected}` : '/api/traffic?cluster=__none__',
    5000, { raw: true }
  );

  const traffic = selected === 'all' ? null : singleTraffic;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Traffic Overview</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {selected === 'all' ? 'All clusters — Hubble flow data' : `Cluster: ${selected}`}
          </p>
        </div>
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          className="bg-slate-800 text-slate-200 text-sm px-3 py-1.5 rounded-lg border border-slate-600 focus:outline-none focus:border-blue-500"
        >
          <option value="all">All Clusters</option>
          {clusters.map(c => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
      </div>

      {selected === 'all' ? (
        <AllClustersView clusters={clusters} allTraffic={allTraffic} onSelect={setSelected} />
      ) : (
        <SingleClusterView traffic={traffic} />
      )}
    </div>
  );
}

// ==================== All Clusters View ====================
function AllClustersView({
  clusters,
  allTraffic,
  onSelect,
}: {
  clusters: ClusterInfo[];
  allTraffic: Record<string, TrafficSummary> | null;
  onSelect: (c: string) => void;
}) {
  const combinedFlows = useMemo(() => {
    if (!allTraffic) return [];
    const all: { cluster: string; src: { ns: string; service: string }; dst: { ns: string; service: string }; port: number; protocol: string; verdict: string }[] = [];
    for (const [cluster, summary] of Object.entries(allTraffic)) {
      for (const f of summary.flows.slice(0, 30)) {
        all.push({
          cluster,
          src: resolveIdentity(f.sourceNamespace, f.sourcePod),
          dst: resolveIdentity(f.destinationNamespace, f.destinationPod),
          port: f.destinationPort,
          protocol: f.protocol + (f.l7Protocol ? `/${f.l7Protocol}` : ''),
          verdict: f.verdict,
        });
      }
    }
    return all.slice(0, 100);
  }, [allTraffic]);

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {clusters.map(c => {
          const summary = allTraffic?.[c.name];
          const totalFlows = summary?.flows.length ?? 0;
          const forwarded = summary?.flows.filter(f => f.verdict === 'FORWARDED').length ?? 0;
          const dropped = summary?.flows.filter(f => f.verdict !== 'FORWARDED').length ?? 0;
          const fwdPct = totalFlows > 0 ? (forwarded / totalFlows) * 100 : 0;
          const edges = summary ? aggregateEdges(summary.aggregated) : [];
          const topEdge = edges[0];

          return (
            <button
              key={c.name}
              onClick={() => onSelect(c.name)}
              className="text-left bg-slate-800/80 rounded-xl p-4 border border-slate-700/60 hover:border-blue-500/50 transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-slate-200 group-hover:text-blue-300 transition-colors">{c.name}</span>
                <span className={`w-2 h-2 rounded-full ${c.reachable ? 'bg-emerald-400' : 'bg-red-400'}`} />
              </div>
              <div className="text-2xl font-bold text-white mb-1">{totalFlows}</div>
              <div className="text-xs text-slate-500 mb-2">flows captured</div>

              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden mb-1">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${fwdPct}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-slate-500">
                <span>{forwarded} fwd</span>
                <span>{dropped} drop</span>
              </div>

              {topEdge && (
                <div className="mt-2 text-[10px] text-slate-500 truncate">
                  top: {topEdge.sourceService} → {topEdge.targetService} ({topEdge.flowCount})
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/60">
          <h2 className="text-sm font-medium text-slate-300">All Flows (latest per cluster)</h2>
        </div>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-800/80">
              <tr className="text-slate-400 border-b border-slate-700/60">
                <th className="text-left px-4 py-2 font-medium">Cluster</th>
                <th className="text-left px-4 py-2 font-medium">Source</th>
                <th className="text-left px-4 py-2 font-medium">Destination</th>
                <th className="text-left px-4 py-2 font-medium">Port</th>
                <th className="text-left px-4 py-2 font-medium">Protocol</th>
                <th className="text-left px-4 py-2 font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {combinedFlows.map((f, i) => (
                <tr key={i} className="border-b border-slate-700/30 hover:bg-slate-700/20 text-slate-300">
                  <td className="px-4 py-1.5 font-mono text-slate-400">{f.cluster}</td>
                  <td className="px-4 py-1.5">
                    <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: nsColor(f.src.ns) }} />
                    {f.src.service}
                    <span className="text-slate-600 ml-1">({f.src.ns})</span>
                  </td>
                  <td className="px-4 py-1.5">
                    <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: nsColor(f.dst.ns) }} />
                    {f.dst.service}
                    <span className="text-slate-600 ml-1">({f.dst.ns})</span>
                  </td>
                  <td className="px-4 py-1.5 text-slate-400">{f.port}</td>
                  <td className="px-4 py-1.5 text-slate-400">{f.protocol}</td>
                  <td className="px-4 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded ${
                      f.verdict === 'FORWARDED' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                    }`}>{f.verdict}</span>
                  </td>
                </tr>
              ))}
              {combinedFlows.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-slate-500">No traffic data yet. Run a load test to generate flows.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ==================== Single Cluster View ====================
function SingleClusterView({ traffic }: { traffic: TrafficSummary | null }) {
  const edges = useMemo(() => {
    if (!traffic) return [];
    return aggregateEdges(traffic.aggregated);
  }, [traffic]);

  const services = useMemo(() => {
    const map = new Map<string, { ns: string; service: string }>();
    for (const e of edges) {
      const srcKey = `${e.sourceNs}/${e.sourceService}`;
      const dstKey = `${e.targetNs}/${e.targetService}`;
      if (!map.has(srcKey)) map.set(srcKey, { ns: e.sourceNs, service: e.sourceService });
      if (!map.has(dstKey)) map.set(dstKey, { ns: e.targetNs, service: e.targetService });
    }
    return Array.from(map.entries());
  }, [edges]);

  const namespaces = useMemo(() => {
    const nsMap = new Map<string, { ns: string; service: string; key: string }[]>();
    for (const [key, svc] of services) {
      const arr = nsMap.get(svc.ns) || [];
      arr.push({ ...svc, key });
      nsMap.set(svc.ns, arr);
    }
    return Array.from(nsMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [services]);

  const NODE_W = 130;
  const NODE_H = 34;
  const NODE_GAP_X = 40;
  const NODE_GAP_Y = 24;
  const NS_PADDING = 16;
  const NS_HEADER = 22;
  const NS_GAP = 20;
  const LEFT_MARGIN = 20;
  const TOP_MARGIN = 20;

  const { positions, svgWidth, svgHeight } = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    let curY = TOP_MARGIN;
    let maxW = 400;

    for (const [, svcs] of namespaces) {
      const cols = Math.min(4, svcs.length);
      const blockW = cols * (NODE_W + NODE_GAP_X) - NODE_GAP_X + NS_PADDING * 2;
      maxW = Math.max(maxW, blockW + LEFT_MARGIN * 2);

      curY += NS_HEADER;
      for (let i = 0; i < svcs.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        pos.set(svcs[i].key, {
          x: LEFT_MARGIN + NS_PADDING + col * (NODE_W + NODE_GAP_X),
          y: curY + NS_PADDING + row * (NODE_H + NODE_GAP_Y),
        });
      }
      const blockRows = Math.ceil(svcs.length / cols);
      curY += NS_PADDING * 2 + blockRows * (NODE_H + NODE_GAP_Y) - NODE_GAP_Y + NS_GAP;
    }

    return { positions: pos, svgWidth: maxW, svgHeight: Math.max(curY + TOP_MARGIN, 200) };
  }, [namespaces]);

  return (
    <>
      <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 overflow-auto" style={{ maxHeight: '50vh' }}>
        {services.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-500 text-sm">
            {!traffic ? 'Loading traffic data...' : 'No service connections detected yet.'}
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full traffic-svg"
            style={{ minHeight: Math.min(svgHeight, 400) }}
          >
            <defs>
              <marker id="arrow-g" viewBox="0 0 10 8" refX="10" refY="4" markerWidth="8" markerHeight="6" orient="auto">
                <path d="M 0 0 L 10 4 L 0 8 z" fill="#10b981" />
              </marker>
              <marker id="arrow-r" viewBox="0 0 10 8" refX="10" refY="4" markerWidth="8" markerHeight="6" orient="auto">
                <path d="M 0 0 L 10 4 L 0 8 z" fill="#ef4444" />
              </marker>
            </defs>

            {(() => {
              let curY = TOP_MARGIN;
              return namespaces.map(([ns, svcs]) => {
                const cols = Math.min(4, svcs.length);
                const rows = Math.ceil(svcs.length / cols);
                const blockW = cols * (NODE_W + NODE_GAP_X) - NODE_GAP_X + NS_PADDING * 2;
                const blockH = NS_HEADER + NS_PADDING * 2 + rows * (NODE_H + NODE_GAP_Y) - NODE_GAP_Y;
                const y = curY;
                curY += blockH + NS_GAP;
                return (
                  <g key={ns}>
                    <rect
                      x={LEFT_MARGIN} y={y} width={blockW} height={blockH} rx={8}
                      fill={`${nsColor(ns)}08`} stroke={nsColor(ns)} strokeWidth={1} strokeOpacity={0.2}
                    />
                    <text x={LEFT_MARGIN + 10} y={y + 15} fill={nsColor(ns)} fontSize={11} fontWeight="600" opacity={0.7}>
                      {ns}
                    </text>
                  </g>
                );
              });
            })()}

            {edges.map((edge, i) => {
              const srcKey = `${edge.sourceNs}/${edge.sourceService}`;
              const dstKey = `${edge.targetNs}/${edge.targetService}`;
              const src = positions.get(srcKey);
              const dst = positions.get(dstKey);
              if (!src || !dst) return null;

              const sx = src.x + NODE_W;
              const sy = src.y + NODE_H / 2;
              const tx = dst.x;
              const ty = dst.y + NODE_H / 2;
              const isDropped = edge.droppedCount > 0 && edge.droppedCount >= edge.forwardedCount;
              const color = isDropped ? '#ef4444' : '#10b981';
              const marker = isDropped ? 'url(#arrow-r)' : 'url(#arrow-g)';

              const midX = (sx + tx) / 2;
              const offset = Math.abs(sy - ty) < 10 ? 20 + (i % 3) * 10 : 0;
              const path = `M ${sx} ${sy} C ${midX} ${sy - offset}, ${midX} ${ty - offset}, ${tx} ${ty}`;

              return (
                <g key={`${srcKey}|${dstKey}`}>
                  <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.5} markerEnd={marker} className="flow-edge-animated" />
                  <text x={midX} y={Math.min(sy, ty) - offset - 4} textAnchor="middle" fill="#64748b" fontSize={9}>
                    {edge.flowCount}
                  </text>
                </g>
              );
            })}

            {services.map(([key, svc]) => {
              const pos = positions.get(key);
              if (!pos) return null;
              const color = nsColor(svc.ns);
              return (
                <g key={key}>
                  <rect
                    x={pos.x} y={pos.y} width={NODE_W} height={NODE_H} rx={6}
                    fill="#1e293b" stroke={color} strokeWidth={1.5} strokeOpacity={0.6}
                  />
                  <text
                    x={pos.x + NODE_W / 2} y={pos.y + NODE_H / 2 + 4}
                    textAnchor="middle" fill="#e2e8f0" fontSize={11} fontWeight="500"
                  >
                    {svc.service.length > 16 ? svc.service.substring(0, 15) + '\u2026' : svc.service}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {edges.length > 0 && (
        <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700/60">
            <h2 className="text-sm font-medium text-slate-300">Top Connections</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700/60">
                  <th className="text-left px-4 py-2 font-medium">Source → Destination</th>
                  <th className="text-center px-4 py-2 font-medium">Flows</th>
                  <th className="text-center px-4 py-2 font-medium">Forwarded</th>
                  <th className="text-center px-4 py-2 font-medium">Dropped</th>
                  <th className="text-left px-4 py-2 font-medium">Protocol</th>
                </tr>
              </thead>
              <tbody>
                {edges.slice(0, 15).map((e, i) => (
                  <tr key={i} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                    <td className="px-4 py-1.5 text-slate-200">
                      <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: nsColor(e.sourceNs) }} />
                      {e.sourceService}
                      <span className="text-slate-500 mx-1">→</span>
                      <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: nsColor(e.targetNs) }} />
                      {e.targetService}
                    </td>
                    <td className="px-4 py-1.5 text-center text-slate-300 font-mono">{e.flowCount}</td>
                    <td className="px-4 py-1.5 text-center text-emerald-400 font-mono">{e.forwardedCount}</td>
                    <td className="px-4 py-1.5 text-center text-red-400 font-mono">{e.droppedCount || '-'}</td>
                    <td className="px-4 py-1.5 text-slate-400">{e.protocols.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/60">
          <h2 className="text-sm font-medium text-slate-300">Recent Flows</h2>
        </div>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-800/80">
              <tr className="text-slate-400 border-b border-slate-700/60">
                <th className="text-left px-4 py-2 font-medium">Source</th>
                <th className="text-left px-4 py-2 font-medium">Destination</th>
                <th className="text-left px-4 py-2 font-medium">Port</th>
                <th className="text-left px-4 py-2 font-medium">Protocol</th>
                <th className="text-left px-4 py-2 font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {traffic?.flows.slice(0, 50).map((f, i) => {
                const src = resolveIdentity(f.sourceNamespace, f.sourcePod);
                const dst = resolveIdentity(f.destinationNamespace, f.destinationPod);
                return (
                  <tr key={i} className="border-b border-slate-700/30 hover:bg-slate-700/20 text-slate-300">
                    <td className="px-4 py-1.5">
                      <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: nsColor(src.ns) }} />
                      <span className="font-mono">{src.service}</span>
                      <span className="text-slate-600 ml-1">({src.ns})</span>
                    </td>
                    <td className="px-4 py-1.5">
                      <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: nsColor(dst.ns) }} />
                      <span className="font-mono">{dst.service}</span>
                      <span className="text-slate-600 ml-1">({dst.ns})</span>
                    </td>
                    <td className="px-4 py-1.5 text-slate-400">{f.destinationPort}</td>
                    <td className="px-4 py-1.5 text-slate-400">{f.protocol}{f.l7Protocol ? `/${f.l7Protocol}` : ''}</td>
                    <td className="px-4 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded ${
                        f.verdict === 'FORWARDED' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                      }`}>{f.verdict}</span>
                    </td>
                  </tr>
                );
              })}
              {(!traffic || traffic.flows.length === 0) && (
                <tr><td colSpan={5} className="text-center py-12 text-slate-500">
                  {!traffic ? 'Loading traffic data...' : 'No flows. Run a load test to generate traffic.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
