import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type SearchResult, type Stats } from '../lib/api';
import ServiceCard from '../components/ServiceCard';
import StatTile from '../components/StatTile';

export default function Landing() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
    api
      .categories()
      .then((c) => setCategories([...new Set([...c.withValidators, ...c.declared])].sort()))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .search({ q: query || undefined, category: category || undefined, limit: 24, includeBroken: true })
        .then((r) => {
          if (!cancelled) {
            setResults(r.results);
            setError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Search failed');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, category]);

  const verified = useMemo(() => stats?.byTier?.verified ?? 0, [stats]);

  return (
    <div>
      <section className="py-16 text-center sm:py-24">
        <p className="rise mx-auto mb-5 inline-block rounded-full border border-edge bg-panel px-4 py-1.5 font-mono text-xs text-fog">
          <span className="pulse-dot mr-2 inline-block h-1.5 w-1.5 rounded-full bg-tier-verified align-middle" />
          x402 protocol · machine-payable web
        </p>
        <h1 className="rise mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl" style={{ animationDelay: '60ms' }}>
          The registry where <span className="gradient-text">agents find paid APIs</span>
        </h1>
        <p className="rise mx-auto mt-5 max-w-2xl text-lg text-fog" style={{ animationDelay: '120ms' }}>
          Discover, verify, and pay for x402 services with on-chain settlement. Every listing is probed, scored, and
          trust-tiered — so your agent knows what it can rely on.
        </p>
        <div className="rise mt-8 flex items-center justify-center gap-3" style={{ animationDelay: '180ms' }}>
          <Link
            to="/register"
            className="glow rounded-lg bg-gradient-to-r from-accent to-accent-2 px-6 py-2.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
          >
            List your API
          </Link>
          <a
            href="#explore"
            className="rounded-lg border border-edge bg-panel px-6 py-2.5 text-sm font-semibold text-snow transition-colors hover:bg-panel-2"
          >
            Explore registry
          </a>
        </div>
      </section>

      {stats && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="services listed" value={stats.total} accent />
          <StatTile label="verified tier" value={verified} />
          <StatTile label="active" value={stats.byStatus?.active ?? 0} />
          <StatTile label="trust tiers tracked" value={Object.keys(stats.byTier ?? {}).length} />
        </section>
      )}

      <section id="explore" className="mt-16 scroll-mt-24">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Explore services</h2>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search: weather, otp, company…"
              className="w-full rounded-lg border border-edge bg-panel px-3.5 py-2 text-sm text-snow placeholder-fog/60 outline-none transition-colors focus:border-accent/60 sm:w-72"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-lg border border-edge bg-panel px-3 py-2 text-sm text-snow outline-none focus:border-accent/60"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="mt-6 rounded-lg border border-tier-broken/40 bg-tier-broken/10 p-4 text-sm text-tier-broken">{error}</p>}

        {loading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-xl border border-edge bg-panel" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-edge p-12 text-center text-fog">
            <p>No services match. Be the first to list one.</p>
            <Link to="/register" className="mt-3 inline-block font-medium text-accent hover:underline">
              Register a service →
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((r, i) => (
              <ServiceCard key={r.card.serviceId} card={r.card} index={i} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-20 grid gap-4 sm:grid-cols-3">
        {[
          {
            title: 'Probed, not promised',
            body: 'Health, gating, and schema probes run against every listing. Paid probes settle real USDC on-chain and record the transaction id.',
          },
          {
            title: 'Trust tiers',
            body: 'Operational, schema, and reliability scores roll up into a tier — verified, community, experimental, flaky, or broken.',
          },
          {
            title: 'Agent-native',
            body: 'Compact result cards with sample requests, wallet compatibility, and CAIP-2 networks. MCP server included.',
          },
        ].map((f) => (
          <div key={f.title} className="gradient-border rounded-xl p-5">
            <h3 className="font-semibold text-snow">{f.title}</h3>
            <p className="mt-2 text-sm text-fog">{f.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
