// =============================================================================
// Probe runners — the verification layer's core.
//
//   healthProbe  — is the endpoint reachable / not 5xx?
//   unpaidProbe  — does it correctly return 402 + a valid x402 challenge, and
//                  does that challenge match the declared metadata?
//   paidProbe    — settle a real payment and call it (requires a BuyerAdapter;
//                  cleanly "skipped" when none is configured).
//
// Probes never throw; they always return a structured ProbeResult.
// =============================================================================

import type { Diagnostic, DiagnosticCode, DiagnosticSeverity, ProbeResult, ServiceRecord } from '../types.js';
import { timedFetch, safeJsonParse } from '../util/http.js';
import { parseChallenge, type X402Accept } from '../util/x402.js';
import { canonicalNetworkId, resolveNetwork } from '../config/networks.js';

function dx(code: DiagnosticCode, severity: DiagnosticSeverity, message: string): Diagnostic {
  return { code, severity, message };
}

const now = () => new Date().toISOString();

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

function requestBodyFor(service: ServiceRecord): { body?: string; headers: Record<string, string> } {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (BODY_METHODS.has(service.method) && service.exampleRequest != null) {
    headers['content-type'] = 'application/json';
    return { body: JSON.stringify(service.exampleRequest), headers };
  }
  return { headers };
}

// ── health ───────────────────────────────────────────────────────────────────

export async function healthProbe(service: ServiceRecord, timeoutMs = 8000): Promise<ProbeResult> {
  const { headers } = requestBodyFor(service);
  const res = await timedFetch(service.resourceUrl, { method: service.method, headers, timeoutMs });
  const diagnostics: Diagnostic[] = [];

  if (!res.ok) {
    diagnostics.push(
      res.timedOut
        ? dx('timeout', 'error', `Endpoint did not respond within ${timeoutMs}ms.`)
        : dx('endpoint_unreachable', 'error', `Endpoint unreachable: ${res.error ?? 'unknown error'}.`),
    );
    return { kind: 'health', ok: false, latencyMs: res.latencyMs, diagnostics, at: now() };
  }

  const reachableOk = res.status < 500;
  if (!reachableOk) diagnostics.push(dx('server_error', 'error', `Server returned ${res.status}.`));
  else diagnostics.push(dx('ok', 'info', `Reachable (HTTP ${res.status}).`));

  return {
    kind: 'health',
    ok: reachableOk,
    statusCode: res.status,
    latencyMs: res.latencyMs,
    diagnostics,
    detail: { contentType: res.headers['content-type'] ?? null },
    at: now(),
  };
}

// ── unpaid ───────────────────────────────────────────────────────────────────

// Networks/schemes are case-insensitive; addresses (payTo) are NOT — Algorand &
// other base32/base58 addresses are case-sensitive, so we compare them exactly.
function matchAny(values: (string | undefined)[], target: string, mode: 'canon' | 'ci' | 'exact' = 'ci'): boolean {
  const norm = (s: string) => (mode === 'canon' ? canonicalNetworkId(s) : s);
  const t = mode === 'exact' ? target : norm(target).toLowerCase();
  return values.some((v) => {
    if (!v) return false;
    return mode === 'exact' ? v === t : norm(v).toLowerCase() === t;
  });
}

function compareDeclared(service: ServiceRecord, accepts: X402Accept[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const networks = accepts.map((a) => a.network);
  const payTos = accepts.map((a) => a.payTo);
  const schemes = accepts.map((a) => a.scheme);

  if (service.paymentNetworks.length) {
    const ok = service.paymentNetworks.some((n) => matchAny(networks, n, 'canon'));
    if (!ok)
      diags.push(
        dx(
          'chain_mismatch',
          'warning',
          `Declared networks [${service.paymentNetworks.join(', ')}] not offered by the live 402 challenge [${networks.filter(Boolean).join(', ')}].`,
        ),
      );
  }
  if (service.payTo) {
    if (!matchAny(payTos, service.payTo, 'exact'))
      diags.push(dx('pay_to_mismatch', 'warning', `Declared payTo ${service.payTo} not present in the live challenge.`));
  }
  if (service.paymentScheme !== 'unknown') {
    if (!matchAny(schemes, service.paymentScheme))
      diags.push(dx('scheme_mismatch', 'warning', `Declared scheme "${service.paymentScheme}" not offered in the live challenge.`));
  }
  if (service.token) {
    const assets = accepts.map((a) => a.asset).filter((a): a is string => a != null);
    if (assets.length) {
      const token = service.token.trim();
      const isId = /^\d+$/.test(token) || /^0x[0-9a-fA-F]+$/.test(token);
      let matched = assets.some((a) => a.toLowerCase() === token.toLowerCase());
      if (!matched && !isId) {
        // Symbol declarations (e.g. "USDC") can't be compared to raw asset ids;
        // accept if the challenge offers the network's canonical stablecoin.
        matched = accepts.some(
          (a) => a.asset != null && a.network != null && resolveNetwork(a.network)?.defaultAsset === a.asset,
        );
      }
      if (!matched)
        diags.push(
          dx('asset_mismatch', 'warning', `Declared token/asset "${token}" not among live challenge assets [${assets.join(', ')}].`),
        );
    }
  }
  if (service.priceAtomic) {
    const amounts = accepts.map((a) => a.amount).filter((a): a is string => a != null);
    if (amounts.length) {
      let matched = false;
      for (const amt of amounts) {
        try {
          if (BigInt(amt) === BigInt(service.priceAtomic)) {
            matched = true;
            break;
          }
        } catch {
          /* ignore non-integer amounts */
        }
      }
      if (!matched)
        diags.push(
          dx('asset_mismatch', 'warning', `Declared price (atomic ${service.priceAtomic}) not among live challenge amounts [${amounts.join(', ')}].`),
        );
    }
  }
  return diags;
}

export async function unpaidProbe(service: ServiceRecord, timeoutMs = 10000): Promise<ProbeResult> {
  const { body, headers } = requestBodyFor(service);
  const res = await timedFetch(service.resourceUrl, { method: service.method, headers, body, timeoutMs });

  if (!res.ok) {
    return {
      kind: 'unpaid',
      ok: false,
      latencyMs: res.latencyMs,
      diagnostics: [
        res.timedOut
          ? dx('timeout', 'error', `Endpoint did not respond within ${timeoutMs}ms.`)
          : dx('endpoint_unreachable', 'error', `Endpoint unreachable: ${res.error ?? 'unknown error'}.`),
      ],
      at: now(),
    };
  }

  const diagnostics: Diagnostic[] = [];
  const base = { kind: 'unpaid' as const, statusCode: res.status, latencyMs: res.latencyMs, at: now() };

  // The happy path for a machine-payable API: 402 + a parseable challenge.
  if (res.status === 402) {
    const challenge = parseChallenge(res.headers, res.bodyText);
    if (!challenge || challenge.accepts.length === 0) {
      diagnostics.push(
        dx('invalid_payment_header', 'error', 'Returned 402 but no valid x402 Payment-Required challenge was found.'),
      );
      return { ...base, ok: false, diagnostics };
    }
    diagnostics.push(dx('ok', 'info', `Valid 402 challenge with ${challenge.accepts.length} payment option(s).`));
    diagnostics.push(...compareDeclared(service, challenge.accepts));
    return {
      ...base,
      ok: true,
      diagnostics,
      detail: {
        accepts: challenge.accepts,
        x402Version: challenge.x402Version ?? null,
        networksOffered: challenge.accepts.map((a) => a.network).filter(Boolean),
      },
    };
  }

  // Other statuses — classify for builder diagnostics.
  if (res.status >= 200 && res.status < 300) {
    diagnostics.push(
      dx('no_payment_required', 'error', `Returned ${res.status} with data and NO payment requirement — this is not a gated paid endpoint.`),
    );
    return { ...base, ok: false, diagnostics, detail: { bodySample: res.bodyText.slice(0, 500) } };
  }
  if (res.status === 405) {
    diagnostics.push(dx('wrong_http_method', 'error', `405 Method Not Allowed — declared method "${service.method}" may be wrong.`));
    return { ...base, ok: false, diagnostics };
  }
  if (res.status === 401 || res.status === 403) {
    diagnostics.push(dx('facilitator_auth_error', 'warning', `${res.status} — endpoint requires auth or the facilitator rejected the request.`));
    return { ...base, ok: false, diagnostics };
  }
  if (res.status >= 500) {
    diagnostics.push(dx('server_error', 'error', `Server error ${res.status}.`));
    return { ...base, ok: false, diagnostics };
  }
  diagnostics.push(dx('unexpected_status', 'warning', `Unexpected status ${res.status} (expected 402).`));
  return { ...base, ok: false, diagnostics, detail: { bodySample: res.bodyText.slice(0, 300) } };
}

// ── paid (requires a buyer adapter) ──────────────────────────────────────────

export interface BuyerAdapter {
  id: string;
  /** Can this buyer settle the given accept option? */
  canPay(accept: X402Accept): boolean;
  /**
   * Produce the base64 payment payload sent back to the seller. It is sent as
   * both `payment-signature` (x402 v2) and `x-payment` (v1) headers.
   */
  pay(service: ServiceRecord, accept: X402Accept): Promise<string>;
}

/**
 * Parse the settlement receipt the seller returns on a successful paid call
 * (`payment-response` / `x-payment-response`: base64 JSON with the on-chain
 * transaction id, network, and payer).
 */
function parseSettlement(headers: Record<string, string>): Record<string, unknown> | undefined {
  const raw = headers['payment-response'] ?? headers['x-payment-response'];
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

let _buyer: BuyerAdapter | null = null;
/** Register a buyer so paid probes can actually settle. Seam for real wallets. */
export function registerBuyer(buyer: BuyerAdapter | null): void {
  _buyer = buyer;
}
export function getBuyer(): BuyerAdapter | null {
  return _buyer;
}

export async function paidProbe(service: ServiceRecord, timeoutMs = 15000): Promise<ProbeResult> {
  const buyer = _buyer;
  if (!buyer) {
    return {
      kind: 'paid',
      ok: false,
      diagnostics: [
        dx('paid_probe_skipped', 'info', 'Paid probe skipped — no BuyerAdapter configured. Register one to settle real payments.'),
      ],
      detail: { skipped: true },
      at: now(),
    };
  }

  // 1) Get a fresh challenge (send the body so body-required endpoints reach the gate).
  const probeReq = requestBodyFor(service);
  const challengeRes = await timedFetch(service.resourceUrl, {
    method: service.method,
    headers: probeReq.headers,
    body: probeReq.body,
    timeoutMs,
  });
  const challenge = challengeRes.status === 402 ? parseChallenge(challengeRes.headers, challengeRes.bodyText) : undefined;
  const accept = challenge?.accepts.find((a) => buyer.canPay(a));
  if (!accept) {
    return {
      kind: 'paid',
      ok: false,
      diagnostics: [dx('paid_probe_skipped', 'warning', 'No challenge option this buyer can settle.')],
      detail: { skipped: true },
      at: now(),
    };
  }

  // 2) Settle + 3) call with payment headers (v2 reads `payment-signature`;
  //    v1 servers read `x-payment` — send both for compatibility).
  try {
    const paymentHeader = await buyer.pay(service, accept);
    const { body, headers } = requestBodyFor(service);
    const res = await timedFetch(service.resourceUrl, {
      method: service.method,
      headers: { ...headers, 'x-payment': paymentHeader, 'payment-signature': paymentHeader },
      body,
      timeoutMs,
    });
    const ok = res.ok && res.status >= 200 && res.status < 300;
    const parsed = safeJsonParse(res.bodyText);
    const settlement = parseSettlement(res.headers);
    const txid = typeof settlement?.transaction === 'string' ? settlement.transaction : undefined;
    return {
      kind: 'paid',
      ok,
      statusCode: res.status,
      latencyMs: res.latencyMs,
      diagnostics: ok
        ? [dx('ok', 'info', `Paid call succeeded (HTTP ${res.status})${txid ? ` — settled on-chain, txid ${txid}` : ''}.`)]
        : [dx('settlement_failure', 'error', `Paid call returned ${res.status}.`)],
      detail: {
        responseSample: parsed ?? res.bodyText.slice(0, 800),
        ...(settlement ? { settlement, txid: txid ?? null } : {}),
      },
      at: now(),
    };
  } catch (err) {
    return {
      kind: 'paid',
      ok: false,
      diagnostics: [dx('settlement_failure', 'error', `Payment settlement failed: ${err instanceof Error ? err.message : String(err)}`)],
      at: now(),
    };
  }
}
