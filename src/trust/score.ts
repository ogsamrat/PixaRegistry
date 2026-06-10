// =============================================================================
// Layered trust model (per spec).
//
// Trust is NOT a single vague number. We compute independent signals:
//   operational | schema | domain | community  (+ reliability/uptime)
// and derive a `tier` + presentation `labels`. Ranking blends relevance with
// these so search prioritizes verified, fresh, reliable services.
// =============================================================================

import type { ProbeRun, TrustLabel, TrustScores, TrustTier } from '../types.js';

const RECENT_WINDOW = 20; // how many recent probe runs to consider
const FRESH_MS = 7 * 24 * 60 * 60 * 1000; // results older than this decay

export function defaultScores(): TrustScores {
  return {
    operational: 0,
    schema: 0,
    domain: null,
    community: null,
    reliability: 0,
    uptime: 0,
    tier: 'unverified',
    labels: [],
  };
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export interface ScoreInputs {
  probeRuns: ProbeRun[]; // most recent first OR any order (we sort)
  ratingAverage: number | null;
  reviewCount: number;
  lastSemanticCheckResult?: string | null;
  now?: number;
}

export function computeScores(input: ScoreInputs): TrustScores {
  const now = input.now ?? Date.now();
  const runs = [...input.probeRuns].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  );
  const recent = runs.slice(0, RECENT_WINDOW);
  // Skipped probes (e.g. paid probe with no BuyerAdapter) are non-results:
  // counting them as failures would wrongly drag reliability down / mark flaky.
  const scoreable = recent.filter((r) => r.detail?.skipped !== true);

  if (recent.length === 0) {
    const base = defaultScores();
    // community can exist even before any probe
    base.community = communityScore(input.ratingAverage, input.reviewCount);
    base.labels = base.community != null && base.community >= 0.7 ? ['Community Approved'] : [];
    base.tier = base.community != null && base.community >= 0.7 ? 'community' : 'unverified';
    return base;
  }

  const latest = (kind: ProbeRun['kind']): ProbeRun | undefined =>
    recent.find((r) => r.kind === kind);
  const latestHealth = latest('health');
  const latestUnpaid = latest('unpaid');
  const latestSchema = latest('schema');
  const latestPaid = latest('paid');

  // ── reliability & uptime ──
  const opRuns = scoreable.filter((r) => r.kind === 'health' || r.kind === 'unpaid');
  const uptime = opRuns.length ? opRuns.filter((r) => r.ok).length / opRuns.length : 0;
  const reliability = scoreable.length ? scoreable.filter((r) => r.ok).length / scoreable.length : 0;

  // ── reachability / gating ──
  const reachable =
    (latestHealth?.ok ?? false) ||
    (latestUnpaid ? (latestUnpaid.statusCode ?? 0) > 0 : false);
  const gatingOk = !!latestUnpaid?.ok;

  // ── freshness decay ──
  const lastCheckAt = latestUnpaid?.at ?? latestHealth?.at ?? recent[0]?.at;
  const ageMs = lastCheckAt ? now - Date.parse(lastCheckAt) : Infinity;
  const freshness = ageMs <= FRESH_MS ? 1 : 0.8;

  // ── operational ──
  let operational = 0;
  if (reachable) operational += 0.3;
  if (gatingOk) operational += 0.4;
  operational += 0.2 * reliability;
  const lat = latestUnpaid?.latencyMs ?? latestHealth?.latencyMs;
  if (lat != null) operational += lat < 2000 ? 0.1 : lat < 5000 ? 0.05 : 0;
  operational = clamp01(operational * freshness);

  // ── schema ──
  let schema = 0;
  if (latestSchema) {
    const s = numberDetail(latestSchema, 'score');
    schema = latestSchema.ok ? (s != null ? clamp01(s) : 0.8) : s != null ? clamp01(s) : 0.2;
  }

  // ── domain ──
  let domain: number | null = null;
  const domainRun = latestPaid ?? latestSchema;
  const domainScore = domainRun ? numberDetail(domainRun, 'domainScore') : null;
  if (domainScore != null) domain = clamp01(domainScore);

  // ── community ──
  const community = communityScore(input.ratingAverage, input.reviewCount);

  // ── tier ──
  const tier = deriveTier({ recent: scoreable, reachable, gatingOk, reliability, operational, schema, community });

  // ── labels ──
  const labels = deriveLabels({
    gatingOk,
    paidOk: !!latestPaid?.ok,
    schema,
    domain,
    community,
    reviewCount: input.reviewCount,
    semanticResult: input.lastSemanticCheckResult ?? null,
    tier,
  });

  return { operational, schema, domain, community, reliability, uptime, tier, labels };
}

function numberDetail(run: ProbeRun, key: string): number | null {
  const v = run.detail?.[key];
  return typeof v === 'number' ? v : null;
}

function communityScore(ratingAverage: number | null, reviewCount: number): number | null {
  if (!reviewCount || ratingAverage == null) return null;
  return clamp01(ratingAverage / 5);
}

function deriveTier(args: {
  recent: ProbeRun[];
  reachable: boolean;
  gatingOk: boolean;
  reliability: number;
  operational: number;
  schema: number;
  community: number | null;
}): TrustTier {
  const { recent, reachable, reliability, operational, schema, community } = args;
  if (recent.length === 0) return 'unverified';
  if (!reachable) return 'broken';
  const hasFailure = recent.some((r) => !r.ok);
  if (reliability < 0.6 && hasFailure) return 'flaky';
  if (operational >= 0.8 && schema >= 0.7) return 'verified';
  if (community != null && community >= 0.7) return 'community';
  return 'experimental';
}

function deriveLabels(args: {
  gatingOk: boolean;
  paidOk: boolean;
  schema: number;
  domain: number | null;
  community: number | null;
  reviewCount: number;
  semanticResult: string | null;
  tier: TrustTier;
}): TrustLabel[] {
  const labels: TrustLabel[] = [];
  // "Payment Verified" means a real payment settled (paid probe succeeded);
  // a correct 402 challenge alone only proves gating.
  if (args.paidOk) labels.push('Payment Verified');
  if (args.gatingOk) labels.push('Gating Verified');
  if (args.schema >= 0.7) labels.push('Schema Verified');
  if (args.domain != null && args.domain >= 0.6) labels.push('Category Verified');
  if (args.community != null && args.community >= 0.7 && args.reviewCount >= 1)
    labels.push('Community Approved');
  if (args.semanticResult) labels.push('Semantically Checked');
  if (args.tier === 'experimental') labels.push('Experimental');
  if (args.tier === 'broken') labels.push('Broken');
  if (args.tier === 'flaky') labels.push('Flaky');
  return labels;
}

// ── ranking helpers ──────────────────────────────────────────────────────────

const TIER_RANK: Record<TrustTier, number> = {
  verified: 5,
  community: 4,
  experimental: 3,
  flaky: 2,
  unverified: 1,
  broken: 0,
};

export function tierRank(t: TrustTier): number {
  return TIER_RANK[t] ?? 0;
}

/** A 0..1 "can I actually use this" score for agent result cards. */
export function compatibilityScore(scores: TrustScores): number {
  const community = scores.community ?? 0;
  return clamp01(
    0.5 * scores.operational + 0.25 * scores.reliability + 0.15 * scores.schema + 0.1 * community,
  );
}

/**
 * Blend lexical relevance (0..1) with trust signals for the final search rank,
 * implementing the spec's default ranking priorities.
 */
export function rankBlend(relevance: number, scores: TrustScores): number {
  const community = scores.community ?? 0;
  const domain = scores.domain ?? 0;
  // weights sum to 1.0 so the blended score stays within 0..1
  const base =
    0.5 * relevance +
    0.25 * scores.operational +
    0.1 * scores.reliability +
    0.1 * scores.schema +
    0.025 * community +
    0.025 * domain;
  // Down-rank flaky; broken is hidden by default upstream but penalize if shown.
  if (scores.tier === 'flaky') return base * 0.7;
  if (scores.tier === 'broken') return base * 0.4;
  return base;
}
