export default function StatTile({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <p className={`font-mono text-2xl font-bold ${accent ? 'gradient-text' : 'text-snow'}`}>{value}</p>
      <p className="mt-1 text-xs text-fog">{label}</p>
    </div>
  );
}
