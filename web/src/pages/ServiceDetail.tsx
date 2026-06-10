import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, shortNetwork, timeAgo, type ProbeRun, type ServiceDetail as Detail } from '../lib/api';
import TierBadge from '../components/TierBadge';
import ScoreBar from '../components/ScoreBar';

const PROBE_LABEL: Record<ProbeRun['kind'], string> = {
  health: 'Health',
  unpaid: '402 Gating',
  paid: 'Paid settlement',
  schema: 'Schema',
};

function probeTxid(run: ProbeRun): string | null {
  const d = run.detail;
  if (!d) return null;
  if (typeof d.txid === 'string') return d.txid;
  const settlement = d.settlement;
  if (settlement && typeof settlement === 'object' && 'transaction' in settlement) {
    const tx = (settlement as { transaction?: unknown }).transaction;
    if (typeof tx === 'string') return tx;
  }
  return null;
}

function ProbeRow({ run }: { run: ProbeRun }) {
  const [open, setOpen] = useState(false);
  const skipped = run.detail?.skipped === true;
  const txid = probeTxid(run);
  const dot = skipped ? 'bg-tier-unverified' : run.ok ? 'bg-tier-verified' : 'bg-tier-broken';
  return (
    <li className="relative pl-6">
      <span className={`absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ${dot}`} />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <button onClick={() => setOpen(!open)} className="text-sm font-medium text-snow hover:text-accent">
          {PROBE_LABEL[run.kind]}
        </button>
        <span className={`font-mono text-xs ${skipped ? 'text-fog' : run.ok ? 'text-tier-verified' : 'text-tier-broken'}`}>
          {skipped ? 'skipped' : run.ok ? 'ok' : 'failed'}
        </span>
        {run.statusCode !== undefined && <span className="font-mono text-xs text-fog">HTTP {run.statusCode}</span>}
        {run.latencyMs !== undefined && <span className="font-mono text-xs text-fog">{run.latencyMs}ms</span>}
        <span className="font-mono text-xs text-fog/60">{timeAgo(run.at)}</span>
      </div>
      {txid && (
        <a
          href={`https://lora.algokit.io/testnet/transaction/${txid}`}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block break-all font-mono text-xs text-accent hover:underline"
        >
          ⛓ {txid}
        </a>
      )}
      {open && run.diagnostics.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg border border-edge bg-ink p-3">
          {run.diagnostics.map((d, i) => (
            <li key={i} className="text-xs">
              <span
                className={`mr-2 font-mono ${
                  d.severity === 'error' ? 'text-tier-broken' : d.severity === 'warning' ? 'text-tier-experimental' : 'text-fog'
                }`}
              >
                [{d.code}]
              </span>
              <span className="text-fog">{d.message}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function ServiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [reviewForm, setReviewForm] = useState({ rating: 5, comment: '', author: '' });
  const [reviewBusy, setReviewBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    api
      .service(id)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load service'));
  }, [id]);

  useEffect(load, [load]);

  async function reverify() {
    if (!id) return;
    setVerifying(true);
    try {
      await api.verify(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  }

  async function submitReview(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setReviewBusy(true);
    try {
      await api.addReview(id, {
        rating: reviewForm.rating,
        comment: reviewForm.comment.trim() || undefined,
        author: reviewForm.author.trim() || undefined,
      });
      setReviewForm({ rating: 5, comment: '', author: '' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed');
    } finally {
      setReviewBusy(false);
    }
  }

  if (error && !detail) {
    return (
      <div className="py-32 text-center">
        <p className="text-tier-broken">{error}</p>
        <Link to="/" className="mt-4 inline-block text-accent hover:underline">
          ← Back to registry
        </Link>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="space-y-4 py-12">
        <div className="h-40 animate-pulse rounded-2xl border border-edge bg-panel" />
        <div className="h-64 animate-pulse rounded-2xl border border-edge bg-panel" />
      </div>
    );
  }

  const { service, probeRuns, reviews } = detail;
  const s = service.scores;

  return (
    <div className="py-10">
      <Link to="/" className="text-sm text-fog transition-colors hover:text-accent">
        ← Registry
      </Link>

      <div className="rise mt-4 rounded-2xl border border-edge bg-panel p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{service.name}</h1>
              <TierBadge tier={s.tier} />
              <span className="font-mono text-xs text-fog">{service.status}</span>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-fog">{service.description}</p>
            <p className="mt-3 break-all font-mono text-xs text-fog/80">
              <span className="mr-2 rounded bg-panel-2 px-1.5 py-0.5 text-accent">{service.method}</span>
              {service.resourceUrl}
            </p>
          </div>
          <button
            onClick={reverify}
            disabled={verifying}
            className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
          >
            {verifying ? 'Verifying…' : 'Re-verify now'}
          </button>
        </div>

        <div className="mt-6 flex flex-wrap gap-1.5">
          {s.labels.map((l) => (
            <span key={l} className="rounded-md border border-tier-verified/30 bg-tier-verified/10 px-2 py-0.5 text-xs text-tier-verified">
              {l}
            </span>
          ))}
          {service.paymentNetworks.map((n) => (
            <span key={n} className="rounded-md border border-edge bg-panel-2 px-2 py-0.5 font-mono text-xs text-fog">
              {shortNetwork(n)}
            </span>
          ))}
          {service.priceDisplay && (
            <span className="rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-xs text-accent">
              {service.priceDisplay}
              {service.token ? ` ${service.token}` : ''}
            </span>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-edge bg-panel p-6">
          <h2 className="font-semibold">Trust scores</h2>
          <div className="mt-4 space-y-4">
            <ScoreBar label="Operational" value={s.operational} />
            <ScoreBar label="Schema" value={s.schema} />
            <ScoreBar label="Reliability" value={s.reliability} />
            <ScoreBar label="Uptime" value={s.uptime} />
            <ScoreBar label="Domain" value={s.domain} />
            <ScoreBar label="Community" value={s.community} />
          </div>
          {service.payTo && (
            <div className="mt-6 border-t border-edge pt-4">
              <p className="text-xs text-fog">Pay to</p>
              <p className="mt-1 break-all font-mono text-xs text-snow">{service.payTo}</p>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-edge bg-panel p-6 lg:col-span-2">
          <h2 className="font-semibold">Probe history</h2>
          {probeRuns.length === 0 ? (
            <p className="mt-4 text-sm text-fog">No probes recorded yet — hit re-verify.</p>
          ) : (
            <ul className="mt-4 space-y-4 border-l border-edge pl-1 [&>li]:-ml-[5px]">
              {probeRuns.slice(0, 20).map((run) => (
                <ProbeRow key={run.id} run={run} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-edge bg-panel p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            Reviews{' '}
            {service.ratingAverage !== null && (
              <span className="ml-2 font-mono text-sm text-tier-experimental">
                ★ {service.ratingAverage.toFixed(1)} <span className="text-fog">({service.ratingCount})</span>
              </span>
            )}
          </h2>
        </div>

        <form onSubmit={submitReview} className="mt-4 grid gap-3 rounded-xl border border-edge bg-ink p-4 sm:grid-cols-[auto_1fr_auto_auto]">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setReviewForm((f) => ({ ...f, rating: n }))}
                className={`text-lg transition-colors ${n <= reviewForm.rating ? 'text-tier-experimental' : 'text-edge-2 hover:text-fog'}`}
              >
                ★
              </button>
            ))}
          </div>
          <input
            value={reviewForm.comment}
            onChange={(e) => setReviewForm((f) => ({ ...f, comment: e.target.value }))}
            placeholder="Share your experience…"
            className="rounded-lg border border-edge bg-panel px-3 py-1.5 text-sm text-snow placeholder-fog/50 outline-none focus:border-accent/60"
          />
          <input
            value={reviewForm.author}
            onChange={(e) => setReviewForm((f) => ({ ...f, author: e.target.value }))}
            placeholder="Name (optional)"
            className="rounded-lg border border-edge bg-panel px-3 py-1.5 text-sm text-snow placeholder-fog/50 outline-none focus:border-accent/60 sm:w-36"
          />
          <button
            type="submit"
            disabled={reviewBusy}
            className="rounded-lg bg-gradient-to-r from-accent to-accent-2 px-4 py-1.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Post
          </button>
        </form>

        {reviews.length === 0 ? (
          <p className="mt-4 text-sm text-fog">No reviews yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-xl border border-edge bg-ink p-4">
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-mono text-tier-experimental">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                  <span className="text-snow">{r.author ?? 'anonymous'}</span>
                  <span className="text-fog/60">{timeAgo(r.createdAt)}</span>
                </div>
                {r.comment && <p className="mt-2 text-sm text-fog">{r.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="mt-4 rounded-lg border border-tier-broken/40 bg-tier-broken/10 p-3 text-sm text-tier-broken">{error}</p>}
    </div>
  );
}
