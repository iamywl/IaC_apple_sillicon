import type { TestResults } from '../../shared/types.js';

export function parseStressNgOutput(output: string): Partial<TestResults> {
  const result: Partial<TestResults> = {};

  // stress-ng outputs vary by version:
  //   stress-ng: info:  [1] cpu                5829     30.00     29.90      0.01       194.30       194.88
  //   stress-ng: metrc: [1] cpu                5829     30.00     29.90      0.01       194.30       194.88
  // Match either "info:" or "metrc:" lines with stressor name and bogo ops

  const lines = output.split('\n');
  for (const line of lines) {
    const match = line.match(/(?:info|metrc):.*\]\s+(cpu|vm)\s+(\d+)/);
    if (match) {
      const stressor = match[1];
      const bogoOps = parseInt(match[2]);
      if (stressor === 'cpu') {
        result.cpuBogoOps = bogoOps;
      } else if (stressor === 'vm') {
        result.memoryBogoOps = bogoOps;
      }
    }
  }

  return result;
}
