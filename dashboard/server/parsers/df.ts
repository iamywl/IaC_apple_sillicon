export function parseDisk(output: string): { totalGb: number; usedGb: number; percent: number } {
  // Expect output from: df -h / --output=size,used,avail,pcent | tail -1
  // Example: "  20G  4.2G   15G   22%"
  const line = output.trim();
  if (!line) return { totalGb: 0, usedGb: 0, percent: 0 };

  const percentMatch = line.match(/(\d+)%/);
  const percent = percentMatch ? parseInt(percentMatch[1]) : 0;

  const sizeMatch = line.match(/([\d.]+)([GMK])/g);
  let totalGb = 0;
  let usedGb = 0;
  if (sizeMatch && sizeMatch.length >= 2) {
    totalGb = parseSize(sizeMatch[0]);
    usedGb = parseSize(sizeMatch[1]);
  }

  return { totalGb, usedGb, percent };
}

function parseSize(s: string): number {
  const match = s.match(/([\d.]+)([GMK])/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  switch (match[2]) {
    case 'G': return val;
    case 'M': return val / 1024;
    case 'K': return val / (1024 * 1024);
    default: return val;
  }
}
