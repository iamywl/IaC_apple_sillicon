import type { TestResults } from '../../shared/types.js';

export function parseK6Output(output: string): Partial<TestResults> {
  const result: Partial<TestResults> = {};

  // Parse http_req_duration metrics
  // k6 outputs like: http_req_duration..............: avg=12.34ms min=1.23ms med=10.00ms max=100.00ms p(90)=50.00ms p(95)=75.00ms p(99)=90.00ms
  const durationLine = output.match(/http_req_duration[.\s]*:([^\n]+)/);
  if (durationLine) {
    const line = durationLine[1];
    const avg = line.match(/avg=([\d.]+)(ms|s|µs)/);
    const p95 = line.match(/p\(95\)=([\d.]+)(ms|s|µs)/);
    const p99 = line.match(/p\(99\)=([\d.]+)(ms|s|µs)/);

    if (avg) result.avgLatency = convertToMs(parseFloat(avg[1]), avg[2]);
    if (p95) result.p95Latency = convertToMs(parseFloat(p95[1]), p95[2]);
    if (p99) result.p99Latency = convertToMs(parseFloat(p99[1]), p99[2]);
  }

  // Parse http_req_failed
  // http_req_failed................: 0.00% ✓ 0 ✗ 1234
  const failedLine = output.match(/http_req_failed[.\s]*:\s*([\d.]+)%/);
  if (failedLine) {
    result.errorRate = parseFloat(failedLine[1]) / 100;
  }

  // Parse http_reqs (RPS)
  // http_reqs......................: 12345  205.75/s
  const reqsLine = output.match(/http_reqs[.\s]*:\s*(\d+)\s+([\d.]+)\/s/);
  if (reqsLine) {
    result.totalRequests = parseInt(reqsLine[1]);
    result.rps = parseFloat(reqsLine[2]);
  }

  return result;
}

function convertToMs(value: number, unit: string): number {
  switch (unit) {
    case 's': return value * 1000;
    case 'µs': return value / 1000;
    case 'ms':
    default: return value;
  }
}
