// Typed client for the PIXA Registry API (mounted at /api by the server and
// proxied there by Vite in dev). Shapes mirror src/types.ts on the backend.

export type TrustTier = 'verified' | 'community' | 'experimental' | 'flaky' | 'broken' | 'unverified';
export type ServiceStatus = 'pending' | 'active' | 'degraded' | 'broken' | 'disabled';

export interface TrustScores {
  operational: number;
  schema: number;
  domain: number | null;
  community: number | null;
  reliability: number;
  uptime: number;
  tier: TrustTier;
  labels: string[];
}

export interface ServiceRecord {
  serviceId: string;
  resourceUrl: string;
  name: string;
  description: string;
  category: string | null;
  tags: string[];
  method: string;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  exampleRequest: unknown;
  exampleResponse: unknown;
  paymentScheme: string;
  paymentNetworks: string[];
  priceAtomic: string | null;
  priceDisplay: string | null;
  token: string | null;
  payTo: string | null;
  facilitator: string | null;
  supportsTestnet: boolean;
  supportsMainnet: boolean;
  walletCompatibility: string;
  status: ServiceStatus;
  scores: TrustScores;
  ratingAverage: number | null;
  ratingCount: number;
  reviewCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Diagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface ProbeRun {
  id: string;
  serviceId: string;
  kind: 'health' | 'unpaid' | 'paid' | 'schema';
  ok: boolean;
  statusCode?: number;
  latencyMs?: number;
  diagnostics: Diagnostic[];
  detail?: Record<string, unknown>;
  at: string;
}

export interface Review {
  id: string;
  serviceId: string;
  rating: number;
  comment: string | null;
  author: string | null;
  createdAt: string;
}

export interface ServiceDetail {
  service: ServiceRecord;
  probeRuns: ProbeRun[];
  reviews: Review[];
}

export interface AgentResultCard {
  serviceId: string;
  name: string;
  resourceUrl: string;
  method: string;
  shortDescription: string;
  priceDisplay: string | null;
  paymentNetworks: string[];
  walletCompatibility: string;
  trustTier: TrustTier;
  labels: string[];
  compatibilityScore: number;
  sampleRequest: unknown;
}

export interface SearchResult {
  card: AgentResultCard;
  score: number;
  relevance: number;
}

export interface NetworkInfo {
  id: string;
  slug: string;
  family: string;
  displayName: string;
  isTestnet: boolean;
  defaultAsset?: string;
  hubPayable: boolean;
  directlyPayable: boolean;
  cdpOnly: boolean;
}

export interface Stats {
  total: number;
  byStatus: Record<string, number>;
  byTier: Record<string, number>;
}

export interface VerifyResponse {
  status: ServiceStatus;
  scores: TrustScores;
  warnings: string[];
  probes: ProbeRun[];
}

export interface SubmitResponse {
  created: boolean;
  service: ServiceRecord;
  verification: { status: ServiceStatus; scores: TrustScores; warnings: string[] } | null;
}

export interface SubmissionPayload {
  resourceUrl: string;
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
  method?: string;
  paymentScheme?: string;
  paymentNetworks?: string[];
  priceAtomic?: string;
  priceDisplay?: string;
  token?: string;
  payTo?: string;
  facilitator?: string;
  outputSchema?: Record<string, unknown>;
  exampleResponse?: unknown;
}

const BASE = '/api';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    const message =
      body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : body && typeof body === 'object' && 'error' in body
          ? String((body as { error: unknown }).error)
          : `HTTP ${status}`;
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const api = {
  stats: () => request<Stats>('/stats'),
  networks: () => request<{ networks: NetworkInfo[] }>('/networks'),
  categories: () => request<{ withValidators: string[]; declared: string[] }>('/categories'),
  search: (params: { q?: string; limit?: number; includeBroken?: boolean; category?: string; network?: string }) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.includeBroken) qs.set('includeBroken', 'true');
    if (params.category) qs.set('category', params.category);
    if (params.network) qs.set('network', params.network);
    return request<{ query: string | null; count: number; results: SearchResult[] }>(`/search?${qs}`);
  },
  services: (limit = 500) => request<{ count: number; services: ServiceRecord[] }>(`/services?limit=${limit}&includeBroken=true`),
  service: (id: string) => request<ServiceDetail>(`/services/${encodeURIComponent(id)}`),
  submit: (payload: SubmissionPayload, verify = true) =>
    request<SubmitResponse>(`/services?verify=${verify}`, { method: 'POST', body: JSON.stringify(payload) }),
  verify: (id: string, paid = false) =>
    request<VerifyResponse>(`/services/${encodeURIComponent(id)}/verify${paid ? '?paid=true' : ''}`, { method: 'POST' }),
  addReview: (id: string, review: { rating: number; comment?: string; author?: string }) =>
    request<{ review: Review }>(`/services/${encodeURIComponent(id)}/reviews`, { method: 'POST', body: JSON.stringify(review) }),
};

export const TIER_COLORS: Record<TrustTier, string> = {
  verified: 'text-tier-verified border-tier-verified/40 bg-tier-verified/10',
  community: 'text-tier-community border-tier-community/40 bg-tier-community/10',
  experimental: 'text-tier-experimental border-tier-experimental/40 bg-tier-experimental/10',
  flaky: 'text-tier-flaky border-tier-flaky/40 bg-tier-flaky/10',
  broken: 'text-tier-broken border-tier-broken/40 bg-tier-broken/10',
  unverified: 'text-tier-unverified border-tier-unverified/40 bg-tier-unverified/10',
};

export function shortNetwork(id: string): string {
  if (id.startsWith('algorand:')) return id.includes('SGO1GKSz') ? 'algorand-testnet' : 'algorand';
  if (id.startsWith('eip155:')) return `evm:${id.slice(7)}`;
  if (id.length > 24) return `${id.slice(0, 21)}…`;
  return id;
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
