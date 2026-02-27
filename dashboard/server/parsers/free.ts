export function parseMemory(output: string): { totalMb: number; usedMb: number; percent: number } {
  const memLine = output.split('\n').find(l => l.startsWith('Mem:'));
  if (!memLine) return { totalMb: 0, usedMb: 0, percent: 0 };
  const parts = memLine.split(/\s+/);
  const total = parseInt(parts[1]) || 1;
  const used = parseInt(parts[2]) || 0;
  return { totalMb: total, usedMb: used, percent: Math.round((used / total) * 100) };
}
