// =============================================================================
// SSRF guard. The registry fetches arbitrary user-submitted URLs during
// verification, so every outbound probe must be vetted: http(s) only, and the
// resolved IP(s) must be public (no loopback, link-local, cloud-metadata, or
// private ranges). Set PIXA_ALLOW_PRIVATE=1 to bypass for local development.
// =============================================================================

import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export interface UrlCheck {
  ok: boolean;
  reason?: string;
}

export function allowPrivateTargets(): boolean {
  return process.env.PIXA_ALLOW_PRIVATE === '1' || process.env.PIXA_ALLOW_PRIVATE === 'true';
}

/** True if an IP literal is in a non-public (blocked) range. */
export function isBlockedAddress(ip: string): boolean {
  let addr = ip.trim();
  if (addr.startsWith('::ffff:')) addr = addr.slice(7); // IPv4-mapped IPv6

  const kind = isIP(addr);
  if (kind === 4) {
    const parts = addr.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0) return true; // "this" network
    if (a === 10) return true; // RFC1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT RFC6598
    if (a >= 224) return true; // multicast / reserved / broadcast
    return false;
  }
  if (kind === 6) {
    const lc = addr.toLowerCase();
    if (lc === '::1' || lc === '::') return true; // loopback / unspecified
    if (lc.startsWith('fe80') || lc.startsWith('fe9') || lc.startsWith('fea') || lc.startsWith('feb')) return true; // link-local fe80::/10
    if (lc.startsWith('fc') || lc.startsWith('fd')) return true; // unique-local fc00::/7
    if (lc.startsWith('ff')) return true; // multicast
    return false;
  }
  return true; // not a valid IP literal -> treat as blocked
}

/**
 * Validate a URL is safe to fetch: http(s) scheme and every DNS-resolved address
 * is public. Returns ok:false with a human reason otherwise.
 */
export async function checkPublicUrl(rawUrl: string): Promise<UrlCheck> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: `scheme "${u.protocol}" not allowed (http/https only)` };
  }
  if (allowPrivateTargets()) return { ok: true };

  const host = u.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (/^(localhost|.*\.localhost|.*\.internal|.*\.local)$/i.test(host)) {
    return { ok: false, reason: `host "${host}" is not a public target` };
  }
  if (isIP(host)) {
    return isBlockedAddress(host) ? { ok: false, reason: `address ${host} is not public` } : { ok: true };
  }
  try {
    const addrs = await lookup(host, { all: true });
    if (addrs.length === 0) return { ok: false, reason: 'host has no DNS records' };
    for (const a of addrs) {
      if (isBlockedAddress(a.address)) return { ok: false, reason: `host resolves to non-public address ${a.address}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'DNS lookup failed' };
  }
}
