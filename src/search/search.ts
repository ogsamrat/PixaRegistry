// =============================================================================
// Search — lexical/hybrid ranking with structured filters.
//
// Relevance = field-weighted term matching + query expansion + phrase bonus.
// Final rank = rankBlend(relevance, trustScores) so verified/reliable services
// surface first (the spec's default ranking). Broken/disabled hidden by default.
//
// A vector component slots in here once an Embedder is registered (embeddings.ts).
// =============================================================================

import type {
  AgentResultCard,
  SearchFilters,
  SearchQuery,
  SearchResult,
  ServiceRecord,
} from '../types.js';
import { listServices } from '../registry/repository.js';
import { resolveNetwork } from '../config/networks.js';
import { compatibilityScore, rankBlend, tierRank } from '../trust/score.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'for', 'of', 'to', 'and', 'or', 'with', 'in', 'on', 'at',
  'api', 'apis', 'get', 'post', 'me', 'my', 'is', 'are', 'how', 'do', 'i', 'want',
]);

// Lightweight query expansion so "image" also matches "picture/photo/generation".
const SYNONYMS: Record<string, string[]> = {
  image: ['picture', 'photo', 'generation', 'imagegen', 'render'],
  picture: ['image', 'photo'],
  weather: ['forecast', 'temperature', 'climate'],
  forecast: ['weather'],
  otp: ['2fa', 'code', 'verification', 'pin'],
  company: ['business', 'enrichment', 'firmographic', 'organization'],
  research: ['scrape', 'scraping', 'crawl', 'retrieval', 'search'],
  price: ['cost', 'pricing', 'quote'],
  pizza: ['food', 'restaurant', 'delivery'],
  upvote: ['upvotes', 'producthunt', 'votes'],
  twitter: ['x', 'tweets', 'mentions', 'social'],
  visitors: ['analytics', 'traffic', 'pageviews'],
  index: ['seo', 'google', 'crawl'],
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface FieldTokens {
  weightByToken: Map<string, number>;
}

const FIELD_WEIGHTS = { name: 3, tags: 2.5, category: 2, description: 1.2, networks: 1, url: 0.8 };

function buildFieldTokens(s: ServiceRecord): FieldTokens {
  const weightByToken = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const tok of tokenize(text)) {
      weightByToken.set(tok, Math.max(weightByToken.get(tok) ?? 0, weight));
    }
  };
  add(s.name, FIELD_WEIGHTS.name);
  add(s.tags.join(' '), FIELD_WEIGHTS.tags);
  if (s.category) add(s.category, FIELD_WEIGHTS.category);
  add(s.description, FIELD_WEIGHTS.description);
  add(s.paymentNetworks.map((n) => resolveNetwork(n)?.displayName ?? n).join(' '), FIELD_WEIGHTS.networks);
  add(s.resourceUrl, FIELD_WEIGHTS.url);
  return { weightByToken };
}

function expandTokens(tokens: string[]): { token: string; factor: number }[] {
  const out: { token: string; factor: number }[] = tokens.map((t) => ({ token: t, factor: 1 }));
  const seen = new Set(tokens);
  for (const t of tokens) {
    for (const syn of SYNONYMS[t] ?? []) {
      if (!seen.has(syn)) {
        seen.add(syn);
        out.push({ token: syn, factor: 0.5 });
      }
    }
  }
  return out;
}

function relevanceScore(query: string, fields: FieldTokens, service: ServiceRecord): number {
  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;
  const expanded = expandTokens(tokens);

  let sum = 0;
  for (const { token, factor } of expanded) {
    const w = fields.weightByToken.get(token);
    if (w) sum += w * factor;
  }
  const maxPossible = tokens.length * FIELD_WEIGHTS.name;
  let rel = maxPossible > 0 ? sum / maxPossible : 0;

  // Phrase bonus for contiguous matches in high-value fields.
  const q = query.trim().toLowerCase();
  if (q.length > 2) {
    if (service.name.toLowerCase().includes(q)) rel += 0.3;
    else if (service.description.toLowerCase().includes(q)) rel += 0.15;
  }
  return Math.min(1, rel);
}

export function passesFilters(s: ServiceRecord, f: SearchFilters | undefined): boolean {
  if (s.status === 'disabled') return false;
  const includeBroken = f?.includeBroken ?? false;
  if (!includeBroken && (s.status === 'broken' || s.scores.tier === 'broken')) return false;

  if (!f) return true;

  if (f.network) {
    const target = resolveNetwork(f.network);
    const ok = s.paymentNetworks.some((n) => {
      const r = resolveNetwork(n);
      return target ? r?.id === target.id : n.toLowerCase() === f.network!.toLowerCase();
    });
    if (!ok) return false;
  }
  if (f.family) {
    const ok = s.paymentNetworks.some((n) => resolveNetwork(n)?.family === f.family);
    if (!ok) return false;
  }
  if (f.scheme && s.paymentScheme !== f.scheme) return false;
  if (f.testnet === true && !s.supportsTestnet) return false;
  if (f.testnet === false && s.supportsTestnet) return false;
  if (f.mainnet === true && !s.supportsMainnet) return false;
  if (f.mainnet === false && s.supportsMainnet) return false;
  if (f.category && (s.category ?? '').toLowerCase() !== f.category.toLowerCase()) return false;
  if (f.walletCompatibility && s.walletCompatibility !== f.walletCompatibility) return false;
  if (f.minTrust && tierRank(s.scores.tier) < tierRank(f.minTrust)) return false;
  if (f.maxPriceAtomic != null && s.priceAtomic != null) {
    // atomic amounts can exceed Number.MAX_SAFE_INTEGER — compare as BigInt.
    try {
      if (BigInt(s.priceAtomic) > BigInt(f.maxPriceAtomic)) return false;
    } catch {
      /* non-integer price or filter — don't exclude on a malformed comparison */
    }
  }
  return true;
}

/** Filtered list WITHOUT relevance ranking (for browse/list endpoints). */
export function listFiltered(filters: SearchFilters | undefined, limit = 100): ServiceRecord[] {
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100;
  return listServices()
    .filter((s) => passesFilters(s, filters))
    .slice(0, max);
}

export function toCard(s: ServiceRecord): AgentResultCard {
  return {
    serviceId: s.serviceId,
    name: s.name,
    resourceUrl: s.resourceUrl,
    method: s.method,
    shortDescription: s.description.length > 180 ? s.description.slice(0, 177) + '…' : s.description,
    priceDisplay: s.priceDisplay,
    paymentNetworks: s.paymentNetworks,
    walletCompatibility: s.walletCompatibility,
    trustTier: s.scores.tier,
    labels: s.scores.labels,
    compatibilityScore: compatibilityScore(s.scores),
    sampleRequest: s.exampleRequest ?? null,
  };
}

export function search(query: SearchQuery): SearchResult[] {
  const all = listServices();
  const filtered = all.filter((s) => passesFilters(s, query.filters));
  const hasQuery = !!query.q && query.q.trim().length > 0;

  const scored = filtered.map((s) => {
    const relevance = hasQuery ? relevanceScore(query.q!, buildFieldTokens(s), s) : 0;
    const score = rankBlend(relevance, s.scores);
    return { service: s, relevance, score };
  });

  // When searching, drop zero-relevance matches; when browsing, keep all.
  const results = hasQuery ? scored.filter((r) => r.relevance > 0) : scored;

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return Date.parse(b.service.updatedAt) - Date.parse(a.service.updatedAt);
  });

  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.max(1, Math.min(100, query.limit ?? 20));
  return results.slice(offset, offset + limit).map((r) => ({
    card: toCard(r.service),
    score: Number(r.score.toFixed(4)),
    relevance: Number(r.relevance.toFixed(4)),
  }));
}
