import express from 'express';
import { startCollector, getSnapshot } from './collector.js';

const app = express();
const PORT = 3001;

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/api/snapshot', (_req, res) => {
  const snapshot = getSnapshot();
  res.json({ data: snapshot, timestamp: snapshot.collectedAt, stale: Date.now() - snapshot.collectedAt > 10000 });
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  startCollector();
});
