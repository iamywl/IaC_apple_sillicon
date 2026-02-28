import { execaCommand } from 'execa';
import { getKubeconfigPath } from '../config.js';
import type { TrafficFlow, TrafficSummary, AggregatedEdge } from '../../shared/types.js';

// Cache per cluster
const trafficCache = new Map<string, TrafficSummary>();

export function getCachedTraffic(cluster: string): TrafficSummary | null {
  return trafficCache.get(cluster) || null;
}

export function getAllCachedTraffic(): Record<string, TrafficSummary> {
  const result: Record<string, TrafficSummary> = {};
  for (const [cluster, summary] of trafficCache) {
    result[cluster] = summary;
  }
  return result;
}

export async function collectTrafficFlows(cluster: string): Promise<TrafficSummary> {
  const kubeconfig = getKubeconfigPath(cluster);
  const flows: TrafficFlow[] = [];

  try {
    // Find a cilium agent pod (hubble CLI is available inside cilium agent, not hubble-relay)
    const { stdout: podName } = await execaCommand(
      `kubectl --kubeconfig ${kubeconfig} get pods -n kube-system -l k8s-app=cilium -o jsonpath={.items[0].metadata.name}`,
      { timeout: 10000 }
    );
    if (!podName) throw new Error('No cilium agent pod found');

    const { stdout } = await execaCommand(
      `kubectl --kubeconfig ${kubeconfig} exec -n kube-system ${podName} -- hubble observe --output json --last 200`,
      { timeout: 15000 }
    );

    const lines = stdout.trim().split('\n').filter(l => l.startsWith('{'));
    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        const flow = parseHubbleFlow(raw);
        if (flow) flows.push(flow);
      } catch {
        // skip malformed lines
      }
    }
  } catch (e: any) {
    // Hubble might not be available on all clusters - return empty
    console.log(`[hubble] ${cluster}: ${e.message?.substring(0, 80)}`);
  }

  const aggregated = aggregateFlows(flows);
  const summary: TrafficSummary = {
    flows,
    aggregated,
    collectedAt: Date.now(),
    cluster,
  };

  trafficCache.set(cluster, summary);
  return summary;
}

function parseHubbleFlow(raw: any): TrafficFlow | null {
  const flow = raw.flow;
  if (!flow) return null;

  const src = flow.source || {};
  const dst = flow.destination || {};
  const l4 = flow.l4 || {};
  const l7 = flow.l7 || {};

  // Determine protocol and port
  let protocol = 'TCP';
  let dstPort = 0;
  if (l4.TCP) {
    protocol = 'TCP';
    dstPort = l4.TCP.destination_port || 0;
  } else if (l4.UDP) {
    protocol = 'UDP';
    dstPort = l4.UDP.destination_port || 0;
  } else if (l4.ICMPv4 || l4.ICMPv6) {
    protocol = 'ICMP';
  }

  let l7Protocol: string | undefined;
  if (l7.http) l7Protocol = 'HTTP';
  else if (l7.dns) l7Protocol = 'DNS';
  else if (l7.kafka) l7Protocol = 'Kafka';

  // Map verdict
  let verdict: TrafficFlow['verdict'] = 'FORWARDED';
  if (flow.verdict === 'DROPPED') verdict = 'DROPPED';
  else if (flow.verdict === 'ERROR') verdict = 'ERROR';

  return {
    id: raw.node_name + '-' + (raw.time || Date.now()),
    timestamp: raw.time ? new Date(raw.time).getTime() : Date.now(),
    sourceNamespace: src.namespace || 'unknown',
    sourcePod: src.pod_name || src.identity || 'unknown',
    destinationNamespace: dst.namespace || 'unknown',
    destinationPod: dst.pod_name || dst.identity || 'unknown',
    destinationPort: dstPort,
    protocol,
    l7Protocol,
    verdict,
    httpStatusCode: l7.http?.code,
  };
}

function aggregateFlows(flows: TrafficFlow[]): AggregatedEdge[] {
  const edgeMap = new Map<string, AggregatedEdge>();

  for (const f of flows) {
    const srcKey = `${f.sourceNamespace}/${f.sourcePod}`;
    const dstKey = `${f.destinationNamespace}/${f.destinationPod}`;
    const key = `${srcKey}|${dstKey}`;

    let edge = edgeMap.get(key);
    if (!edge) {
      edge = {
        sourceKey: srcKey,
        destinationKey: dstKey,
        flowCount: 0,
        forwardedCount: 0,
        droppedCount: 0,
        protocols: [],
      };
      edgeMap.set(key, edge);
    }

    edge.flowCount++;
    if (f.verdict === 'FORWARDED') edge.forwardedCount++;
    else if (f.verdict === 'DROPPED') edge.droppedCount++;

    const proto = f.l7Protocol ? `${f.protocol}/${f.l7Protocol}` : f.protocol;
    if (!edge.protocols.includes(proto)) edge.protocols.push(proto);
  }

  return Array.from(edgeMap.values());
}
