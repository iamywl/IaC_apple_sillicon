export function parseCpuUsage(output: string): number {
  const cpuLine = output.split('\n').find(l => l.includes('%Cpu') || l.includes('Cpu(s)'));
  if (!cpuLine) return -1;
  const idleMatch = cpuLine.match(/([\d.]+)\s*id/);
  if (!idleMatch) return -1;
  return Math.round(100 - parseFloat(idleMatch[1]));
}
