interface GaugeChartProps {
  value: number;
  label: string;
  detail?: string;
  size?: number;
}

export function GaugeChart({ value, label, detail, size = 80 }: GaugeChartProps) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(value, 100) / 100) * circumference;

  const color = value >= 90 ? '#ef4444' : value >= 70 ? '#eab308' : '#22c55e';

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#334155"
          strokeWidth="4"
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth="4"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#f1f5f9"
          fontSize="14"
          fontWeight="bold"
          className="transform rotate-90"
          style={{ transformOrigin: `${size / 2}px ${size / 2}px` }}
        >
          {value >= 0 ? `${value}%` : 'N/A'}
        </text>
      </svg>
      <span className="text-xs text-slate-400">{label}</span>
      {detail && <span className="text-xs text-slate-500">{detail}</span>}
    </div>
  );
}
