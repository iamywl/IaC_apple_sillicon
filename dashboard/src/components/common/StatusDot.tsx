interface StatusDotProps {
  status: 'healthy' | 'degraded' | 'down' | 'running' | 'stopped' | 'Ready' | 'NotReady' | 'Unknown';
  size?: 'sm' | 'md';
}

const colorMap: Record<string, string> = {
  healthy: 'bg-green-500',
  running: 'bg-green-500',
  Ready: 'bg-green-500',
  degraded: 'bg-yellow-500',
  down: 'bg-red-500',
  stopped: 'bg-red-500',
  NotReady: 'bg-red-500',
  Unknown: 'bg-gray-500',
};

export function StatusDot({ status, size = 'md' }: StatusDotProps) {
  const sizeClass = size === 'sm' ? 'w-2 h-2' : 'w-3 h-3';
  const color = colorMap[status] || 'bg-gray-500';
  const pulse = status === 'running' || status === 'healthy' || status === 'Ready' ? 'animate-pulse' : '';

  return <span className={`inline-block rounded-full ${sizeClass} ${color} ${pulse}`} />;
}
