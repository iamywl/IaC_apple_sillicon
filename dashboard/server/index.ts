import express from 'express';
import { startCollector, getSnapshot } from './collector.js';
import { runTest, getAllTests, deleteTest, exportTestsCsv } from './jobs.js';
import { getCachedTraffic, getAllCachedTraffic } from './collectors/hubble.js';
import { getCachedServices } from './collectors/services.js';
import { getScalingHistory, getAllScalingHistory } from './collectors/scaling.js';
import type { TestType, CustomLoadConfig, StressConfig, ScalingTestConfig } from '../shared/types.js';

const app = express();
const PORT = 3001;

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/api/snapshot', (_req, res) => {
  const snapshot = getSnapshot();
  res.json({ data: snapshot, timestamp: snapshot.collectedAt, stale: Date.now() - snapshot.collectedAt > 10000 });
});

// ========== Traffic ==========
app.get('/api/traffic/all', (_req, res) => {
  res.json(getAllCachedTraffic());
});

app.get('/api/traffic', (req, res) => {
  const cluster = (req.query.cluster as string) || 'dev';
  const traffic = getCachedTraffic(cluster);
  if (traffic) {
    res.json(traffic);
  } else {
    res.json({ flows: [], aggregated: [], collectedAt: 0, cluster });
  }
});

// ========== Services ==========
app.get('/api/cluster/:name/services', (req, res) => {
  const services = getCachedServices(req.params.name);
  res.json(services);
});

// ========== SRE Testing ==========
app.post('/api/tests/run', async (req, res) => {
  const { type, cluster, config, stressConfig, scenarioName, scalingConfig } = req.body as {
    type: TestType; cluster: string;
    config?: CustomLoadConfig; stressConfig?: StressConfig;
    scenarioName?: string; scalingConfig?: ScalingTestConfig;
  };
  if (!type || !cluster) {
    res.status(400).json({ error: 'type and cluster are required' });
    return;
  }
  try {
    const test = await runTest(type, cluster, config, stressConfig, scenarioName, scalingConfig);
    res.json(test);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/tests/status', (_req, res) => {
  res.json(getAllTests());
});

app.delete('/api/tests/:id', (req, res) => {
  const success = deleteTest(req.params.id);
  res.json({ success });
});

app.get('/api/tests/export', (_req, res) => {
  const csv = exportTestsCsv();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="sre-test-results-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

// ========== Scaling History ==========
app.get('/api/scaling', (req, res) => {
  const cluster = req.query.cluster as string | undefined;
  if (cluster) {
    res.json(getScalingHistory(cluster));
  } else {
    res.json(getAllScalingHistory());
  }
});

app.get('/api/scaling/:cluster', (req, res) => {
  res.json(getScalingHistory(req.params.cluster));
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  startCollector();
});
