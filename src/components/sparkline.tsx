/** Tiny trend line: history in a quiet stroke, the latest value as an accent dot. */
export function Sparkline({ values, width = 76, height = 24, label }: { values: number[]; width?: number; height?: number; label?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const last = values.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? `Trend: ${values.join(", ")}`}>
      <title>{label ?? values.join(" → ")}</title>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" className="text-stone-400" />
      <circle cx={x(last)} cy={y(values[last])} r="3" className="fill-brand-500 stroke-white" strokeWidth="1.5" />
    </svg>
  );
}
