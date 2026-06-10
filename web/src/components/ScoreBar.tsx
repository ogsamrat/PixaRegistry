export default function ScoreBar({ label, value }: { label: string; value: number | null }) {
  const pct = value === null ? 0 : Math.round(value * 100);
  const color =
    value === null
      ? 'bg-edge-2'
      : value >= 0.8
        ? 'bg-tier-verified'
        : value >= 0.5
          ? 'bg-tier-experimental'
          : 'bg-tier-broken';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-fog">{label}</span>
        <span className="font-mono text-snow">{value === null ? 'n/a' : `${pct}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
