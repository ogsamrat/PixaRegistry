// =============================================================================
// HTTP helper — a single timed, SSRF-guarded fetch used by all probe runners.
// Never throws; always returns a structured result so callers can build
// diagnostics deterministically.
//
//   • validates every target (and every redirect hop) via checkPublicUrl
//   • follows redirects MANUALLY so internal targets can't be reached via 30x
//   • caps the body DURING streaming (won't buffer huge/malicious payloads)
// =============================================================================

import { checkPublicUrl } from './ssrf.js';

export interface TimedResponse {
  ok: boolean; // transport succeeded (got an HTTP response); NOT 2xx-ness
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  latencyMs: number;
  /** Set when the transport failed (DNS, TLS, timeout, abort) or the target was blocked. */
  error?: string;
  timedOut: boolean;
  /** True when the SSRF guard refused the target (or a redirect hop). */
  blocked: boolean;
}

export interface TimedFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Cap how much of the body we read into memory (default 256 KB). */
  maxBodyBytes?: number;
  maxRedirects?: number;
}

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) {
    try {
      const t = await res.text();
      return t.length > maxBytes ? t.slice(0, maxBytes) : t;
    } catch {
      return '';
    }
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
  } catch {
    /* partial body is fine */
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, maxBytes));
}

export async function timedFetch(url: string, opts: TimedFetchOptions = {}): Promise<TimedResponse> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 10_000,
    maxBodyBytes = 256 * 1024,
    maxRedirects = 5,
  } = opts;
  const start = Date.now();

  let signal: AbortSignal | undefined;
  try {
    signal = AbortSignal.timeout(timeoutMs);
  } catch {
    signal = undefined;
  }

  const fail = (error: string, partial: Partial<TimedResponse> = {}): TimedResponse => ({
    ok: false,
    status: 0,
    headers: {},
    bodyText: '',
    latencyMs: Date.now() - start,
    timedOut: false,
    blocked: false,
    error,
    ...partial,
  });

  let currentUrl = url;
  let curMethod = method;
  let curBody = body;
  let hops = 0;

  try {
    while (true) {
      const check = await checkPublicUrl(currentUrl);
      if (!check.ok) return fail(`blocked target: ${check.reason}`, { blocked: true });

      const res = await fetch(currentUrl, { method: curMethod, headers, body: curBody, signal, redirect: 'manual' });

      if (REDIRECT_CODES.has(res.status)) {
        const loc = res.headers.get('location');
        if (loc) {
          if (++hops > maxRedirects) return fail('too many redirects');
          currentUrl = new URL(loc, currentUrl).href;
          // 303 (and legacy 301/302 on non-GET) downgrade to GET without a body.
          if (res.status === 303 || ((res.status === 301 || res.status === 302) && curMethod !== 'GET' && curMethod !== 'HEAD')) {
            curMethod = 'GET';
            curBody = undefined;
          }
          try {
            await res.body?.cancel();
          } catch {
            /* ignore */
          }
          continue;
        }
      }

      const headerObj: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headerObj[k.toLowerCase()] = v;
      });
      const bodyText = await readCapped(res, maxBodyBytes);
      return {
        ok: true,
        status: res.status,
        headers: headerObj,
        bodyText,
        latencyMs: Date.now() - start,
        timedOut: false,
        blocked: false,
      };
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const message = err instanceof Error ? err.message : String(err);
    const timedOut = name === 'TimeoutError' || name === 'AbortError';
    return fail(timedOut ? `request timed out after ${timeoutMs}ms` : message, { timedOut });
  }
}

/** Try to JSON-parse text; return undefined on failure (never throws). */
export function safeJsonParse(text: string): unknown | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
