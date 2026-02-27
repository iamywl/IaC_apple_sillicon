import type { PortInfo } from '../../shared/types.js';

export function parsePorts(output: string): PortInfo[] {
  const lines = output.trim().split('\n').slice(1); // skip header
  return lines
    .filter(l => l.includes('LISTEN'))
    .map(line => {
      const parts = line.split(/\s+/);
      const localAddr = parts[3] || '';
      const lastColon = localAddr.lastIndexOf(':');
      const address = localAddr.substring(0, lastColon);
      const port = parseInt(localAddr.substring(lastColon + 1)) || 0;
      const processMatch = line.match(/users:\(\("([^"]+)"/);
      return {
        port,
        address: address || '0.0.0.0',
        process: processMatch ? processMatch[1] : 'unknown',
        state: 'LISTEN',
      };
    })
    .filter(p => p.port > 0);
}
