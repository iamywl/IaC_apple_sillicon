import { LineChart, Line, ResponsiveContainer } from 'recharts';

interface SparkLineProps {
  data: number[];
  color?: string;
  height?: number;
}

export function SparkLine({ data, color = '#3b82f6', height = 30 }: SparkLineProps) {
  const chartData = data.map((v, i) => ({ i, v }));

  if (chartData.length < 2) {
    return <div style={{ height }} className="flex items-center justify-center text-xs text-slate-500">--</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData}>
        <Line type="monotone" dataKey="v" stroke={color} dot={false} strokeWidth={1.5} />
      </LineChart>
    </ResponsiveContainer>
  );
}
