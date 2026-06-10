import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type NetworkInfo, type SubmitResponse, type SubmissionPayload } from '../lib/api';
import TierBadge from '../components/TierBadge';
import ScoreBar from '../components/ScoreBar';

const STEPS = ['Endpoint', 'Metadata', 'Payment', 'Review & verify'] as const;
const METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;

const VERIFY_STAGES = [
  'Checking endpoint reachability…',
  'Requesting x402 payment challenge…',
  'Validating payment requirements…',
  'Comparing declared vs advertised payment terms…',
  'Checking response schema…',
  'Computing trust scores…',
];

interface FormState {
  resourceUrl: string;
  method: string;
  name: string;
  description: string;
  category: string;
  tags: string;
  network: string;
  payTo: string;
  priceDisplay: string;
  priceAtomic: string;
  token: string;
  facilitator: string;
}

const initialForm: FormState = {
  resourceUrl: '',
  method: 'GET',
  name: '',
  description: '',
  category: '',
  tags: '',
  network: '',
  payTo: '',
  priceDisplay: '',
  priceAtomic: '',
  token: '',
  facilitator: '',
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-snow">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-fog/80">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-edge bg-ink px-3.5 py-2 text-sm text-snow placeholder-fog/50 outline-none transition-colors focus:border-accent/60';

export default function Register() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initialForm);
  const [networks, setNetworks] = useState<NetworkInfo[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.networks().then((r) => setNetworks(r.networks)).catch(() => {});
    api
      .categories()
      .then((c) => setCategories([...new Set([...c.withValidators, ...c.declared])].sort()))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!submitting) return;
    setStageIdx(0);
    const t = setInterval(() => {
      setStageIdx((i) => Math.min(i + 1, VERIFY_STAGES.length - 1));
    }, 900);
    return () => clearInterval(t);
  }, [submitting]);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const urlValid = /^https?:\/\/.+/.test(form.resourceUrl.trim());
  const canNext = step === 0 ? urlValid : true;

  async function submit() {
    setSubmitting(true);
    setError(null);
    const payload: SubmissionPayload = { resourceUrl: form.resourceUrl.trim(), method: form.method };
    if (form.name.trim()) payload.name = form.name.trim();
    if (form.description.trim()) payload.description = form.description.trim();
    if (form.category.trim()) payload.category = form.category.trim();
    const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length) payload.tags = tags;
    if (form.network) payload.paymentNetworks = [form.network];
    if (form.payTo.trim()) payload.payTo = form.payTo.trim();
    if (form.priceDisplay.trim()) payload.priceDisplay = form.priceDisplay.trim();
    if (form.priceAtomic.trim()) payload.priceAtomic = form.priceAtomic.trim();
    if (form.token.trim()) payload.token = form.token.trim();
    if (form.facilitator.trim()) payload.facilitator = form.facilitator.trim();
    try {
      const res = await api.submit(payload, true);
      setResult(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const { service, verification } = result;
    return (
      <div className="mx-auto max-w-2xl py-12">
        <div className="gradient-border glow rise rounded-2xl p-8">
          <p className="font-mono text-xs uppercase tracking-widest text-fog">
            {result.created ? 'Service registered' : 'Service updated'}
          </p>
          <div className="mt-3 flex items-start justify-between gap-4">
            <h1 className="text-2xl font-bold">{service.name}</h1>
            <TierBadge tier={service.scores.tier} />
          </div>
          <p className="mt-1 truncate font-mono text-xs text-fog">{service.resourceUrl}</p>

          {verification && (
            <>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <ScoreBar label="Operational" value={verification.scores.operational} />
                <ScoreBar label="Schema" value={verification.scores.schema} />
                <ScoreBar label="Reliability" value={verification.scores.reliability} />
                <ScoreBar label="Domain" value={verification.scores.domain} />
              </div>
              {verification.scores.labels.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {verification.scores.labels.map((l) => (
                    <span key={l} className="rounded-md border border-tier-verified/30 bg-tier-verified/10 px-2 py-0.5 text-xs text-tier-verified">
                      {l}
                    </span>
                  ))}
                </div>
              )}
              {verification.warnings.length > 0 && (
                <ul className="mt-5 space-y-1.5 rounded-lg border border-tier-experimental/30 bg-tier-experimental/5 p-4">
                  {verification.warnings.map((w) => (
                    <li key={w} className="text-xs text-tier-experimental">
                      ⚠ {w}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <div className="mt-8 flex gap-3">
            <button
              onClick={() => navigate(`/service/${encodeURIComponent(service.serviceId)}`)}
              className="rounded-lg bg-gradient-to-r from-accent to-accent-2 px-5 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
            >
              View service page
            </button>
            <button
              onClick={() => {
                setResult(null);
                setForm(initialForm);
                setStep(0);
              }}
              className="rounded-lg border border-edge bg-panel px-5 py-2 text-sm font-semibold text-snow transition-colors hover:bg-panel-2"
            >
              Register another
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (submitting) {
    return (
      <div className="mx-auto max-w-lg py-24">
        <div className="rounded-2xl border border-edge bg-panel p-8">
          <h2 className="text-lg font-semibold">Verifying your service…</h2>
          <p className="mt-1 text-sm text-fog">Running live probes against {form.resourceUrl}</p>
          <ul className="mt-6 space-y-3">
            {VERIFY_STAGES.map((stage, i) => (
              <li key={stage} className={`flex items-center gap-3 text-sm ${i <= stageIdx ? 'text-snow' : 'text-fog/40'}`}>
                {i < stageIdx ? (
                  <span className="text-tier-verified">✓</span>
                ) : i === stageIdx ? (
                  <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-accent" />
                ) : (
                  <span className="inline-block h-2 w-2 rounded-full bg-edge-2" />
                )}
                {stage}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl py-12">
      <h1 className="text-3xl font-bold tracking-tight">
        List your <span className="gradient-text">x402 API</span>
      </h1>
      <p className="mt-2 text-fog">
        Four quick steps. The registry probes your endpoint live and assigns a trust tier — no manual review queue.
      </p>

      <ol className="mt-8 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <button
              onClick={() => i < step && setStep(i)}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold transition-colors ${
                i < step
                  ? 'bg-tier-verified/20 text-tier-verified'
                  : i === step
                    ? 'bg-gradient-to-br from-accent to-accent-2 text-ink'
                    : 'bg-panel-2 text-fog'
              }`}
            >
              {i < step ? '✓' : i + 1}
            </button>
            <span className={`hidden text-xs sm:block ${i === step ? 'text-snow' : 'text-fog'}`}>{s}</span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-edge" />}
          </li>
        ))}
      </ol>

      <div className="mt-8 rounded-2xl border border-edge bg-panel p-6 sm:p-8">
        {step === 0 && (
          <div className="space-y-5">
            <Field label="Endpoint URL" hint="The x402-gated resource. We'll hit it live to read the payment challenge.">
              <input
                value={form.resourceUrl}
                onChange={set('resourceUrl')}
                placeholder="https://api.example.com/weather/current"
                className={inputCls}
                autoFocus
              />
            </Field>
            <Field label="HTTP method">
              <div className="flex gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setForm((f) => ({ ...f, method: m }))}
                    className={`rounded-lg px-4 py-2 font-mono text-sm transition-colors ${
                      form.method === m ? 'bg-gradient-to-r from-accent to-accent-2 font-semibold text-ink' : 'border border-edge bg-ink text-fog hover:text-snow'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <Field label="Name" hint="Optional — defaults to data discovered from your endpoint.">
              <input value={form.name} onChange={set('name')} placeholder="Weather Oracle" className={inputCls} autoFocus />
            </Field>
            <Field label="Description">
              <textarea
                value={form.description}
                onChange={set('description')}
                placeholder="Current conditions for any city, paid per call."
                rows={3}
                className={inputCls}
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Category" hint="Categories with validators get domain-checked.">
                <input value={form.category} onChange={set('category')} list="categories" placeholder="weather" className={inputCls} />
                <datalist id="categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
              <Field label="Tags" hint="Comma-separated.">
                <input value={form.tags} onChange={set('tags')} placeholder="weather, forecast, climate" className={inputCls} />
              </Field>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <p className="rounded-lg border border-edge bg-ink p-3 text-xs text-fog">
              All payment fields are optional — the registry reads authoritative terms from your endpoint's 402 challenge and
              flags any mismatch with what you declare here.
            </p>
            <Field label="Payment network">
              <select value={form.network} onChange={set('network')} className={inputCls}>
                <option value="">Auto-detect from 402 challenge</option>
                {networks.map((n) => (
                  <option key={n.id} value={n.slug}>
                    {n.displayName} {n.isTestnet ? '(testnet)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Pay-to address">
              <input value={form.payTo} onChange={set('payTo')} placeholder="KLCMAZ7A…" className={`${inputCls} font-mono`} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Display price">
                <input value={form.priceDisplay} onChange={set('priceDisplay')} placeholder="$0.001" className={inputCls} />
              </Field>
              <Field label="Atomic price">
                <input value={form.priceAtomic} onChange={set('priceAtomic')} placeholder="1000" className={`${inputCls} font-mono`} />
              </Field>
              <Field label="Token">
                <input value={form.token} onChange={set('token')} placeholder="USDC" className={inputCls} />
              </Field>
            </div>
            <Field label="Facilitator URL">
              <input value={form.facilitator} onChange={set('facilitator')} placeholder="https://facilitator.goplausible.xyz" className={`${inputCls} font-mono`} />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h3 className="font-semibold">Review</h3>
            <dl className="space-y-2 rounded-lg border border-edge bg-ink p-4 text-sm">
              {(
                [
                  ['Endpoint', `${form.method} ${form.resourceUrl}`],
                  ['Name', form.name || '(auto)'],
                  ['Category', form.category || '(none)'],
                  ['Tags', form.tags || '(none)'],
                  ['Network', form.network || '(auto-detect)'],
                  ['Pay to', form.payTo || '(from challenge)'],
                  ['Price', form.priceDisplay || form.priceAtomic || '(from challenge)'],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="shrink-0 text-fog">{k}</dt>
                  <dd className="truncate font-mono text-xs leading-5 text-snow">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-fog">
              Submitting triggers live verification: health check, x402 challenge inspection, and schema probes. Your service
              gets a trust tier immediately.
            </p>
            {error && <p className="rounded-lg border border-tier-broken/40 bg-tier-broken/10 p-3 text-sm text-tier-broken">{error}</p>}
          </div>
        )}

        <div className="mt-8 flex items-center justify-between">
          {step > 0 ? (
            <button onClick={() => setStep(step - 1)} className="rounded-lg border border-edge px-5 py-2 text-sm font-medium text-fog transition-colors hover:text-snow">
              Back
            </button>
          ) : (
            <Link to="/" className="rounded-lg border border-edge px-5 py-2 text-sm font-medium text-fog transition-colors hover:text-snow">
              Cancel
            </Link>
          )}
          {step < STEPS.length - 1 ? (
            <button
              onClick={() => canNext && setStep(step + 1)}
              disabled={!canNext}
              className="rounded-lg bg-gradient-to-r from-accent to-accent-2 px-6 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={submit}
              className="glow rounded-lg bg-gradient-to-r from-accent to-accent-2 px-6 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
            >
              Submit & verify
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
