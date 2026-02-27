export function parseNetDev(output: string): Record<string, { rxBytes: number; txBytes: number }> {
  const result: Record<string, { rxBytes: number; txBytes: number }> = {};
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*(\w+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
    if (match && match[1] !== 'lo') {
      result[match[1]] = { rxBytes: parseInt(match[2]), txBytes: parseInt(match[3]) };
    }
  }
  return result;
}
