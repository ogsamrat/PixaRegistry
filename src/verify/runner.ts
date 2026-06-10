// =============================================================================
// Verification runner — orchestrates a full verification pass for a service:
//   health -> unpaid -> declared-schema (-> optional paid) -> domain validation
// then recomputes the layered trust scores, derives a status, and persists.
// =============================================================================

import type { ProbeResult, ProbeRun, ServiceRecord, ServiceStatus, TrustScores } from '../types.js';
import type { X402Accept } from '../util/x402.js';
import {
  getProbeRuns,
  getReviews,
  getService,
  recordProbeRun,
  updateServicePayment,
  updateServiceVerification,
} from '../registry/repository.js';
import { enrichFromAccepts } from '../registry/normalize.js';
import { computeScores } from '../trust/score.js';
import { healthProbe, paidProbe, unpaidProbe } from './probe.js';
import { validateDeclaredSchemas, matchesSchema } from './schema-check.js';
import { runDomainValidation } from './domain.js';

export interface VerifyOptions {
  paid?: boolean; // attempt a paid probe (requires a BuyerAdapter)
  timeoutMs?: number;
}

export interface VerifySummary {
  service: ServiceRecord;
  status: ServiceStatus;
  scores: TrustScores;
  probes: ProbeResult[];
  warnings: string[];
}

function countWarnings(probes: ProbeResult[]): string[] {
  return probes.flatMap((p) => p.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message));
}

function deriveStatus(args: { reachable: boolean; gatingOk: boolean; warnings: number }): ServiceStatus {
  if (!args.reachable) return 'broken';
  if (args.gatingOk) return args.warnings > 0 ? 'degraded' : 'active';
  return 'degraded';
}

export async function verifyService(serviceId: string, opts: VerifyOptions = {}): Promise<VerifySummary | undefined> {
  let service = getService(serviceId);
  if (!service) return undefined;

  const probes: ProbeResult[] = [];

  const health = await healthProbe(service, opts.timeoutMs);
  probes.push(health);

  const unpaid = await unpaidProbe(service, opts.timeoutMs);
  probes.push(unpaid);

  // Adopt payment terms the submitter omitted from the live 402 challenge
  // (fills blanks only — declared values stay authoritative for mismatch checks).
  if (unpaid.ok && Array.isArray(unpaid.detail?.accepts)) {
    const patch = enrichFromAccepts(service, unpaid.detail.accepts as X402Accept[]);
    if (patch) {
      updateServicePayment(serviceId, patch);
      service = getService(serviceId)!;
    }
  }

  const schema = validateDeclaredSchemas(service);
  probes.push(schema);

  let paid: ProbeResult | undefined;
  if (opts.paid) {
    paid = await paidProbe(service, opts.timeoutMs);

    // If we got a real paid response, enrich it with domain + schema validation
    // so trust scoring can read domainScore from the paid probe.
    if (paid.ok && paid.detail && 'responseSample' in paid.detail) {
      const body = paid.detail.responseSample;
      const domain = runDomainValidation(service.category, body);
      const responseSchema = matchesSchema(body, service.outputSchema);
      paid = {
        ...paid,
        detail: {
          ...paid.detail,
          ...(domain ? { domainScore: domain.score, domainNotes: domain.notes } : {}),
          responseSchemaScore: responseSchema.score,
        },
      };
    }
    probes.push(paid);
  }

  // Persist each probe run, then score against the full (updated) history.
  for (const p of probes) recordProbeRun(serviceId, p);
  const history: ProbeRun[] = getProbeRuns(serviceId);
  const reviews = getReviews(serviceId);
  const ratingAverage = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;

  const scores = computeScores({
    probeRuns: history,
    ratingAverage,
    reviewCount: reviews.length,
    lastSemanticCheckResult: service.lastSemanticCheckResult,
  });

  const reachable = health.ok || (unpaid.statusCode ?? 0) > 0;
  const gatingOk = unpaid.ok;
  const warnings = countWarnings(probes);
  const status = deriveStatus({ reachable, gatingOk, warnings: warnings.length });

  updateServiceVerification(serviceId, {
    scores,
    status,
    lastUnpaidCheckAt: unpaid.at,
    lastPaidCheckAt: paid?.ok ? paid.at : service.lastPaidCheckAt,
    qualityNotes: warnings.length ? warnings.join(' | ') : null,
  });

  const updated = getService(serviceId)!;
  return { service: updated, status, scores, probes, warnings };
}

export async function verifyAll(opts: VerifyOptions = {}): Promise<VerifySummary[]> {
  const { listServices } = await import('../registry/repository.js');
  const out: VerifySummary[] = [];
  for (const s of listServices()) {
    const summary = await verifyService(s.serviceId, opts);
    if (summary) out.push(summary);
  }
  return out;
}
