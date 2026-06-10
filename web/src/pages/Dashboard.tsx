import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, shortNetwork, timeAgo, type ServiceRecord, type Stats, type TrustTier } from '../lib/api';
import TierBadge from '../components/TierBadge';
import StatTile from '../components/StatTile';

const TIERS: TrustTier[] = ['verified', 'community', 'experimental', 'flaky', 'broken', 'unverified'];

export default function Dashboard() {
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tierFilter, setTierFilter] = useState<TrustTier | ''>('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([api.services(), api.stats()])
      .then(([svc, st]) => {
        setServices(svc.services);
        setStats(st);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return services.filter((s) => {
      if (tierFilter && s.scores.tier !== tierFilter) return false;
      if (q && !`${s.name} ${s.description} ${s.resourceUrl} ${s.tags.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [services, tierFilter, query]);

  async function verifyOne(id: string) {
    setVerifyingId(id);
    try {
      await api.verify(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setVerifyingId(null);
    }
  }

  return (
    <div className="py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-fog">Every service in the registry, including broken and unverified listings.</p>
        </div>
        <Link
          to="/register"
          className="rounded-lg bg-gradient-to-r from-accent to-accent-2 px-5 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
        >
          + New service
        </Link>
      </div>

      {stats && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <StatTile label="total" value={stats.total} accent />
          <StatTile label="active" value={stats.byStatus?.active ?? 0} />
          {TIERS.map((t) => (
            <StatTile key={t} label={t} value={stats.byTier?.[t] ?? 0} />
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter services…"
          className="w-full rounded-lg border border-edge bg-panel px-3.5 py-2 text-sm text-snow placeholder-fog/60 outline-none focus:border-accent/60 sm:w-64"
        />
        <button
          onClick={() => setTierFilter('')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            tierFilter === '' ? 'bg-panel-2 text-snow' : 'text-fog hover:text-snow'
          }`}
        >
          all
        </button>
        {TIERS.map((t) => (
          <button
            key={t}
            onClick={() => setTierFilter(tierFilter === t ? '' : t)}
            className={`rounded-lg px-3 py-1.5 font-mono text-xs transition-colors ${
              tierFilter === t ? 'bg-panel-2 text-snow' : 'text-fog hover:text-snow'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 rounded-lg border border-tier-broken/40 bg-tier-broken/10 p-3 text-sm text-tier-broken">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-edge bg-panel">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-edge font-mono text-xs text-fog">
              <th className="px-4 py-3 font-medium">service</th>
              <th className="px-4 py-3 font-medium">tier</th>
              <th className="px-4 py-3 font-medium">status</th>
              <th className="px-4 py-3 font-medium">price</th>
              <th className="px-4 py-3 font-medium">networks</th>
              <th className="px-4 py-3 font-medium">updated</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-fog">
                  Loading registry…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-fog">
                  No services match the filter.
                </td>
              </tr>
            ) : (
              filtered.map((s) => (
                <tr key={s.serviceId} className="border-b border-edge/60 transition-colors last:border-0 hover:bg-panel-2/50">
                  <td className="max-w-xs px-4 py-3">
                    <Link to={`/service/${encodeURIComponent(s.serviceId)}`} className="font-medium text-snow hover:text-accent">
                      {s.name}
                    </Link>
                    <p className="truncate font-mono text-xs text-fog/70">{s.resourceUrl}</p>
                  </td>
                  <td className="px-4 py-3">
                    <TierBadge tier={s.scores.tier} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-fog">{s.status}</td>
                  <td className="px-4 py-3 font-mono text-xs text-accent">{s.priceDisplay ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {s.paymentNetworks.slice(0, 2).map((n) => (
                        <span key={n} className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-xs text-fog">
                          {shortNetwork(n)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-fog">{timeAgo(s.updatedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => verifyOne(s.serviceId)}
                      disabled={verifyingId !== null}
                      className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
                    >
                      {verifyingId === s.serviceId ? 'verifying…' : 're-verify'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
