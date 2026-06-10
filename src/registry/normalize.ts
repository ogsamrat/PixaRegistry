// =============================================================================
// Normalization — turn a loose builder submission into a canonical ServiceRecord.
// This is the "metadata normalization" step of the ingestion layer: it resolves
// networks, infers adapter/wallet compatibility, derives display fields, and
// assigns a deterministic id so re-submitting the same endpoint upserts.
// =============================================================================

import { createHash } from 'node:crypto';
import type { AdapterType, ServiceRecord, ServiceSubmission } from '../types.js';
import type { X402Accept } from '../util/x402.js';
import { canonicalNetworkId, resolveNetwork, walletCompatibilityFor } from '../config/networks.js';
import { defaultScores } from '../trust/score.js';

/** Deterministic id: host+path slug + short hash of (url|method). */
export function makeServiceId(resourceUrl: string, method: string): string {
  let slug = 'service';
  try {
    const u = new URL(resourceUrl);
    const path = u.pathname.replace(/\/+$/, '').replace(/^\/+/, '');
    slug = [u.hostname.replace(/^www\./, ''), path]
      .filter(Boolean)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  } catch {
    /* fall through to default slug */
  }
  const hash = createHash('sha1').update(`${resourceUrl}|${method}`).digest('hex').slice(0, 6);
  return `${slug || 'service'}-${hash}`;
}

function deriveNameFromUrl(resourceUrl: string): string {
  try {
    const u = new URL(resourceUrl);
    const last = u.pathname.split('/').filter(Boolean).pop();
    const host = u.hostname.replace(/^www\./, '');
    return last ? `${host} ${last}` : host;
  } catch {
    return resourceUrl;
  }
}

function inferAdapterType(networkIds: string[]): AdapterType {
  const fams = networkIds.map((id) => resolveNetwork(id)?.family).filter(Boolean);
  if (fams.includes('algorand')) return 'x402-algorand';
  const evm = networkIds.map(resolveNetwork).filter((n) => n?.family === 'evm');
  if (evm.length) return evm.some((n) => n?.cdpOnly) ? 'x402-cdp' : 'x402-evm';
  if (fams.includes('solana')) return 'x402-solana';
  if (fams.includes('stellar')) return 'x402-stellar';
  return networkIds.length ? 'x402-generic' : 'unknown';
}

const STABLES = new Set(['USDC', 'USDT', 'DAI', 'PYUSD', 'USDP']);

/** Format an integer atomic amount with `decimals` places, using BigInt (no float loss). */
function formatAtomic(atomic: string, decimals: number): string | null {
  let n: bigint;
  try {
    n = BigInt(atomic);
  } catch {
    return null; // non-integer atomic amount
  }
  const neg = n < 0n;
  if (neg) n = -n;
  const base = 10n ** BigInt(decimals);
  const whole = (n / base).toString();
  const frac = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/**
 * Best-effort human price. Assumes 6 decimals (the USDC convention on the chains
 * we index); when a non-standard token is used the display is still informative.
 */
function derivePriceDisplay(
  priceDisplay: string | undefined,
  priceAtomic: string | undefined,
  token: string | undefined,
): string | null {
  if (priceDisplay) return priceDisplay;
  if (!priceAtomic) return null;
  const formatted = formatAtomic(priceAtomic, 6);
  if (formatted == null) return null;
  const sym = (token ?? 'USDC').toUpperCase();
  return STABLES.has(sym) ? `$${formatted} ${sym}` : `${formatted} ${sym}`;
}

export function normalizeSubmission(input: ServiceSubmission): ServiceRecord {
  const now = new Date().toISOString();
  const method = (input.method ?? 'GET').toUpperCase();
  const resourceUrl = input.resourceUrl.trim();

  const paymentNetworks = (input.paymentNetworks ?? [])
    .map((n) => canonicalNetworkId(n))
    .filter((v, i, arr) => arr.indexOf(v) === i);

  const resolved = paymentNetworks.map(resolveNetwork);
  const supportsTestnet = resolved.some((n) => n?.isTestnet === true);
  const supportsMainnet = resolved.some((n) => n?.isTestnet === false);
  const walletCompatibility = walletCompatibilityFor(paymentNetworks);
  const adapterType = input.adapterType ?? inferAdapterType(paymentNetworks);

  return {
    serviceId: makeServiceId(resourceUrl, method),
    resourceUrl,
    name: (input.name ?? deriveNameFromUrl(resourceUrl)).trim(),
    description: (input.description ?? '').trim(),
    category: input.category?.trim() || null,
    tags: (input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
    method,
    inputSchema: input.inputSchema ?? null,
    outputSchema: input.outputSchema ?? null,
    exampleRequest: input.exampleRequest ?? null,
    exampleResponse: input.exampleResponse ?? null,

    paymentScheme: input.paymentScheme ?? 'unknown',
    paymentNetworks,
    priceAtomic: input.priceAtomic ?? null,
    priceDisplay: derivePriceDisplay(input.priceDisplay, input.priceAtomic, input.token),
    token: input.token ?? null,
    payTo: input.payTo ?? null,
    facilitator: input.facilitator ?? null,
    adapterType,

    supportsTestnet,
    supportsMainnet,
    walletCompatibility,

    status: 'pending',
    submittedBy: input.submittedBy ?? null,

    lastUnpaidCheckAt: null,
    lastPaidCheckAt: null,
    lastSemanticCheckAt: null,
    lastSemanticCheckResult: null,

    scores: defaultScores(),

    ratingAverage: null,
    ratingCount: 0,
    reviewCount: 0,
    qualityNotes: null,

    createdAt: now,
    updatedAt: now,
  };
}

// Asset ids we can confidently name (Algorand USDC ASAs).
const KNOWN_ASSET_TOKENS: Record<string, string> = {
  '10458941': 'USDC', // testnet
  '31566704': 'USDC', // mainnet
};

function tokenFromAccept(accept: X402Accept): string | null {
  // EVM exact scheme puts the EIP-3009 token name in extra.name.
  const extraName = accept.extra && typeof accept.extra.name === 'string' ? accept.extra.name : null;
  if (extraName && extraName.length <= 12) return extraName;
  if (accept.asset && KNOWN_ASSET_TOKENS[accept.asset]) return KNOWN_ASSET_TOKENS[accept.asset];
  return null;
}

/**
 * Fill payment fields the submitter left blank from a live 402 challenge.
 * Declared values always win — the challenge only fills gaps, never overwrites,
 * so mismatch *detection* (compareDeclared) keeps something to compare against.
 */
export function enrichFromAccepts(service: ServiceRecord, accepts: X402Accept[]): Partial<ServiceRecord> | null {
  if (accepts.length === 0) return null;
  const patch: Partial<ServiceRecord> = {};
  const first = accepts[0];

  if ((!service.paymentScheme || service.paymentScheme === 'unknown') && (first.scheme === 'exact' || first.scheme === 'upto')) {
    patch.paymentScheme = first.scheme;
  }

  if (service.paymentNetworks.length === 0) {
    const networks = accepts
      .map((a) => a.network)
      .filter((n): n is string => !!n)
      .map(canonicalNetworkId)
      .filter((v, i, arr) => arr.indexOf(v) === i);
    if (networks.length) {
      const resolved = networks.map(resolveNetwork);
      patch.paymentNetworks = networks;
      patch.supportsTestnet = resolved.some((n) => n?.isTestnet === true);
      patch.supportsMainnet = resolved.some((n) => n?.isTestnet === false);
      patch.walletCompatibility = walletCompatibilityFor(networks);
      if (service.adapterType === 'unknown') patch.adapterType = inferAdapterType(networks);
    }
  }

  if (!service.payTo && first.payTo) patch.payTo = first.payTo;

  const token = service.token ?? tokenFromAccept(first);
  if (!service.token && token) patch.token = token;

  if (!service.priceAtomic && first.amount) {
    patch.priceAtomic = first.amount;
    if (!service.priceDisplay && token) {
      patch.priceDisplay = derivePriceDisplay(undefined, first.amount, token);
    }
  }

  return Object.keys(patch).length ? patch : null;
}
