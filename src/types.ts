// =============================================================================
// PIXA Registry — domain types
//
// Single source of truth for the shapes used across the registry. The SQLite
// schema (db/schema.ts) stores the structured columns plus JSON-encoded text for
// the complex fields; the repository maps DB rows <-> these domain types.
// =============================================================================

// ── Chains / networks ─────────────────────────────────────────────────────────

export type ChainFamily = 'algorand' | 'evm' | 'solana' | 'stellar' | 'other';

/** How a buyer can settle a payment for this listing. */
export type PaymentScheme = 'exact' | 'upto' | 'unknown';

/** What payment infrastructure the seller uses. */
export type AdapterType =
  | 'x402-algorand'
  | 'x402-evm'
  | 'x402-cdp'
  | 'x402-solana'
  | 'x402-stellar'
  | 'x402-generic'
  | 'unknown';

export interface NetworkInfo {
  /** Canonical id — CAIP-2 where known, else a stable slug. */
  id: string;
  /** Short slug used in filters/CLI (e.g. "algorand-testnet", "base-sepolia"). */
  slug: string;
  family: ChainFamily;
  displayName: string;
  isTestnet: boolean;
  /** Default stablecoin asset identifier on this network, if well-known. */
  defaultAsset?: string;
  /** Whether the PIXA Hub (universal payer) can route payments here today. */
  hubPayable: boolean;
  /** Whether a plain end-user wallet on this chain can pay directly. */
  directlyPayable: boolean;
  /** True if this network is only reachable through CDP-supported facilitators. */
  cdpOnly: boolean;
}

// ── Wallet compatibility ────────────────────────────────────────────────────

export type WalletCompatibility =
  | 'directly-payable'
  | 'hub-payable'
  | 'cdp-only'
  | 'algorand-native'
  | 'unsupported';

// ── Verification / probes ────────────────────────────────────────────────────

export type ProbeKind = 'health' | 'unpaid' | 'paid' | 'schema';

/** Structured machine-readable reasons a probe failed or warned. */
export type DiagnosticCode =
  | 'endpoint_unreachable'
  | 'timeout'
  | 'wrong_http_method'
  | 'no_payment_required' // expected 402, got 2xx without payment
  | 'missing_payment_header'
  | 'invalid_payment_header'
  | 'chain_mismatch'
  | 'pay_to_mismatch'
  | 'scheme_mismatch'
  | 'asset_mismatch'
  | 'facilitator_auth_error'
  | 'schema_invalid'
  | 'schema_mismatch'
  | 'example_mismatch'
  | 'settlement_failure'
  | 'server_error' // 5xx
  | 'unexpected_status'
  | 'paid_probe_skipped'
  | 'ok';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface Diagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
}

export interface ProbeResult {
  kind: ProbeKind;
  ok: boolean;
  statusCode?: number;
  latencyMs?: number;
  diagnostics: Diagnostic[];
  /** Free-form structured detail (parsed accepts, headers, body sample, …). */
  detail?: Record<string, unknown>;
  at: string; // ISO timestamp
}

export interface ProbeRun extends ProbeResult {
  id: string;
  serviceId: string;
}

// ── Trust model (layered, per spec) ──────────────────────────────────────────

export type TrustTier =
  | 'verified' // operationally + schema verified, fresh
  | 'community' // community approved
  | 'experimental' // listed, partial verification
  | 'flaky' // intermittent failures
  | 'broken' // currently failing
  | 'unverified'; // never successfully probed

export type TrustLabel =
  | 'Payment Verified'
  | 'Gating Verified'
  | 'Schema Verified'
  | 'Category Verified'
  | 'Community Approved'
  | 'Semantically Checked'
  | 'Experimental'
  | 'Broken'
  | 'Flaky';

export interface TrustScores {
  /** 0..1 — does it work technically (reachable, 402 gating, latency, uptime)? */
  operational: number;
  /** 0..1 — structural consistency with declared interface. */
  schema: number;
  /** 0..1 — domain-specific correctness where a category validator exists. */
  domain: number | null;
  /** 0..1 — user-reported trust. */
  community: number | null;
  /** 0..1 — recent success ratio over probe history. */
  reliability: number;
  /** 0..1 — share of recent checks that succeeded. */
  uptime: number;
  tier: TrustTier;
  labels: TrustLabel[];
}

// ── Service status ───────────────────────────────────────────────────────────

export type ServiceStatus =
  | 'pending' // submitted, not yet verified
  | 'active' // verified and searchable
  | 'degraded' // works but with warnings
  | 'broken' // failing verification
  | 'disabled'; // hidden by moderation

// ── JSON-schema-ish description of request/response shapes ────────────────────

export type JsonSchema = Record<string, unknown>;

// ── Submission input (what a builder provides) ───────────────────────────────

export interface ServiceSubmission {
  resourceUrl: string;
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  exampleRequest?: unknown;
  exampleResponse?: unknown;
  paymentScheme?: PaymentScheme;
  /** Network slugs or CAIP-2 ids; resolved against the network registry. */
  paymentNetworks?: string[];
  priceAtomic?: string;
  priceDisplay?: string;
  token?: string;
  payTo?: string;
  facilitator?: string;
  adapterType?: AdapterType;
  /** Optional builder identity (for reputation). */
  submittedBy?: string;
}

// ── Stored service record (full) ─────────────────────────────────────────────

export interface ServiceRecord {
  serviceId: string;
  resourceUrl: string;
  name: string;
  description: string;
  category: string | null;
  tags: string[];
  method: string;
  inputSchema: JsonSchema | null;
  outputSchema: JsonSchema | null;
  exampleRequest: unknown | null;
  exampleResponse: unknown | null;

  paymentScheme: PaymentScheme;
  paymentNetworks: string[]; // canonical network ids
  priceAtomic: string | null;
  priceDisplay: string | null;
  token: string | null;
  payTo: string | null;
  facilitator: string | null;
  adapterType: AdapterType;

  supportsTestnet: boolean;
  supportsMainnet: boolean;
  walletCompatibility: WalletCompatibility;

  status: ServiceStatus;
  submittedBy: string | null;

  // verification timestamps
  lastUnpaidCheckAt: string | null;
  lastPaidCheckAt: string | null;
  lastSemanticCheckAt: string | null;
  lastSemanticCheckResult: string | null;

  // scores (denormalized snapshot; recomputed on each verification)
  scores: TrustScores;

  // community
  ratingAverage: number | null;
  ratingCount: number;
  reviewCount: number;
  qualityNotes: string | null;

  createdAt: string;
  updatedAt: string;
}

// ── Reviews ──────────────────────────────────────────────────────────────────

export interface Review {
  id: string;
  serviceId: string;
  rating: number; // 1..5
  comment: string | null;
  author: string | null;
  createdAt: string;
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface SearchFilters {
  network?: string; // slug or id
  family?: ChainFamily;
  scheme?: PaymentScheme;
  testnet?: boolean;
  mainnet?: boolean;
  category?: string;
  walletCompatibility?: WalletCompatibility;
  minTrust?: TrustTier;
  maxPriceAtomic?: string;
  includeBroken?: boolean;
}

export interface SearchQuery {
  q?: string;
  filters?: SearchFilters;
  limit?: number;
  offset?: number;
}

/** Compact, agent-optimized result card. */
export interface AgentResultCard {
  serviceId: string;
  name: string;
  resourceUrl: string;
  method: string;
  shortDescription: string;
  priceDisplay: string | null;
  paymentNetworks: string[];
  walletCompatibility: WalletCompatibility;
  trustTier: TrustTier;
  labels: TrustLabel[];
  compatibilityScore: number; // 0..1
  sampleRequest: unknown | null;
}

export interface SearchResult {
  card: AgentResultCard;
  /** Final ranking score (relevance blended with trust). */
  score: number;
  /** Lexical relevance component (0..1) for transparency. */
  relevance: number;
}
