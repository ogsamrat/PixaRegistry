// =============================================================================
// x402 helpers — parse the `Payment-Required` challenge that a gated endpoint
// returns alongside HTTP 402. The challenge is base64-encoded JSON carrying the
// `accepts` array (one entry per acceptable payment rail).
//
// This is the shape emitted by @x402/* servers (x402Version 2). We parse
// defensively because the registry indexes third-party endpoints we don't control.
// =============================================================================

export interface X402Accept {
  scheme?: string;
  network?: string;
  amount?: string;
  asset?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export interface X402Challenge {
  x402Version?: number;
  error?: string;
  resource?: Record<string, unknown>;
  accepts: X402Accept[];
}

// x402 sends the challenge as base64/JSON in `Payment-Required` (or an x- variant).
// `www-authenticate` is deliberately NOT here: it's RFC 7235 auth-scheme syntax,
// not a base64 JSON challenge, so treating it as one would mis-parse.
const HEADER_CANDIDATES = ['payment-required', 'x-payment-required'];

/** Keep only `accepts` entries that are real objects (defend against garbage). */
function sanitizeAccepts(value: unknown): X402Accept[] {
  if (!Array.isArray(value)) return [];
  return value.filter((a): a is X402Accept => !!a && typeof a === 'object' && !Array.isArray(a));
}

/** Pull the raw challenge header value from a lower-cased header map. */
export function getChallengeHeader(headers: Record<string, string>): string | undefined {
  for (const name of HEADER_CANDIDATES) {
    const v = headers[name];
    if (v) return v;
  }
  return undefined;
}

/** Decode a base64 (or raw JSON) challenge string into a structured object. */
export function decodeChallenge(raw: string): X402Challenge | undefined {
  if (!raw) return undefined;
  const tryParse = (s: string): X402Challenge | undefined => {
    try {
      const obj = JSON.parse(s) as Record<string, unknown>;
      const accepts = sanitizeAccepts(obj.accepts);
      return {
        x402Version: typeof obj.x402Version === 'number' ? obj.x402Version : undefined,
        error: typeof obj.error === 'string' ? obj.error : undefined,
        resource: (obj.resource as Record<string, unknown>) ?? undefined,
        accepts,
      };
    } catch {
      return undefined;
    }
  };

  // Some servers send raw JSON; most send base64. Try both.
  const direct = tryParse(raw);
  if (direct) return direct;

  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf-8');
    return tryParse(decoded);
  } catch {
    return undefined;
  }
}

/**
 * Parse a challenge from a header map and/or a 402 response body.
 * Returns undefined if no valid challenge can be recovered.
 */
export function parseChallenge(
  headers: Record<string, string>,
  bodyText?: string,
): X402Challenge | undefined {
  const headerVal = getChallengeHeader(headers);
  if (headerVal) {
    const fromHeader = decodeChallenge(headerVal);
    if (fromHeader && fromHeader.accepts.length > 0) return fromHeader;
  }
  // Fall back to a JSON body that itself carries `accepts` (some servers do this).
  if (bodyText) {
    const fromBody = decodeChallenge(bodyText);
    if (fromBody && fromBody.accepts.length > 0) return fromBody;
  }
  return headerVal ? decodeChallenge(headerVal) : undefined;
}
