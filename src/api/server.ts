// =============================================================================
// HTTP API (Hono) — the public delivery surface.
//
// Every route is mounted at BOTH `/` (back-compat for agents/CLI) and `/api`
// (used by the seller web UI). When `web/dist` exists the server also serves
// the built UI: hashed assets under /assets/* and an SPA fallback that returns
// index.html for browser (text/html) GET navigation.
//
//   GET  /                      service info + endpoint directory (JSON clients)
//   GET  /health                liveness
//   GET  /networks              supported networks (multichain compatibility)
//   GET  /categories            categories with domain validators
//   GET  /stats                 registry counts by status/tier
//   POST /services              submit a listing (validate -> normalize -> verify)
//   GET  /services              list listings (structured filters)
//   GET  /services/:id          full detail (record + probe history + reviews)
//   POST /services/:id/verify   re-run verification
//   POST /services/:id/reviews  add a community review
//   GET  /search                ranked, agent-optimized result cards
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import type { ChainFamily, PaymentScheme, SearchFilters, SearchQuery, TrustTier, WalletCompatibility } from '../types.js';
import { listNetworks } from '../config/networks.js';
import { listValidatedCategories } from '../verify/domain.js';
import { safeParseSubmission } from '../registry/validation.js';
import {
  addServiceReview,
  getServiceDetail,
  listServices,
  reverify,
  submitService,
} from '../registry/service.js';
import { listFiltered, search } from '../search/search.js';

export const app = new Hono();

// ── seller web UI (optional, built into web/dist) ─────────────────────────────
const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const HAS_UI = existsSync(path.join(WEB_DIST, 'index.html'));

// CORS: allowlist via PIXA_CORS_ORIGINS (comma-separated); defaults to open for
// the public read API but echoes only configured origins when set.
const CORS_ORIGINS = (process.env.PIXA_CORS_ORIGINS ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: (origin) => {
      if (CORS_ORIGINS.includes('*')) return origin ?? '*';
      return CORS_ORIGINS.includes(origin) ? origin : null;
    },
  }),
);

// Hashed immutable assets — registered before the rate limiter on purpose: a
// single page load fetches several assets and must not eat into the API budget.
if (HAS_UI) {
  const webRoot = path.relative(process.cwd(), WEB_DIST).split(path.sep).join('/') || '.';
  app.use('/assets/*', serveStatic({ root: webRoot }));
}

// Real client IP. By default trust the socket address (not spoofable); set
// PIXA_TRUST_PROXY=1 to honor X-Forwarded-For when running behind a known proxy.
function clientIp(c: Context): string {
  if (process.env.PIXA_TRUST_PROXY === '1') {
    const xff = c.req.header('x-forwarded-for');
    if (xff) return xff.split(',')[0].trim();
  }
  try {
    return getConnInfo(c).remote.address ?? 'local';
  } catch {
    return 'local';
  }
}

// ── sliding-window rate limiter (per IP), with bucket eviction ────────────────
const rpmRaw = Number(process.env.RATE_LIMIT_RPM ?? 120);
const RPM = Number.isFinite(rpmRaw) && rpmRaw > 0 ? rpmRaw : 120;
const WINDOW_MS = 60_000;
const buckets = new Map<string, number[]>();
const evictTimer = setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [ip, hits] of buckets) {
    if (hits.every((t) => t < cutoff)) buckets.delete(ip);
  }
}, WINDOW_MS);
if (typeof evictTimer.unref === 'function') evictTimer.unref();

app.use(async (c, next) => {
  const ip = clientIp(c);
  const nowT = Date.now();
  const hits = (buckets.get(ip) ?? []).filter((t) => nowT - t < WINDOW_MS);
  hits.push(nowT);
  buckets.set(ip, hits);
  if (hits.length > RPM) return c.json({ error: 'rate_limited', message: 'Too many requests.' }, 429);
  return next();
});

// Optional auth for mutating endpoints. When PIXA_ADMIN_KEY is set, POST routes
// require it via `x-api-key` or `Authorization: Bearer`. Unset = open (MVP default).
const ADMIN_KEY = process.env.PIXA_ADMIN_KEY;
app.use(async (c, next) => {
  if (!ADMIN_KEY) return next();
  if (c.req.method === 'GET' || c.req.method === 'OPTIONS' || c.req.method === 'HEAD') return next();
  const provided = c.req.header('x-api-key') ?? c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (provided !== ADMIN_KEY) return c.json({ error: 'unauthorized', message: 'Valid x-api-key required for write operations.' }, 401);
  return next();
});

app.use(async (c, next) => {
  const start = Date.now();
  await next();
  console.log(`[pixa-registry] ${c.req.method} ${c.req.path} -> ${c.res.status} (${Date.now() - start}ms)`);
});

// SPA fallback: browser GET navigation (Accept: text/html) outside /api gets the
// UI shell; JSON clients (agents, curl) still hit the API routes at the same paths.
if (HAS_UI) {
  app.use(async (c, next) => {
    if (c.req.method !== 'GET') return next();
    const p = c.req.path;
    if (p === '/api' || p.startsWith('/api/') || p.startsWith('/assets/')) return next();
    const accept = c.req.header('accept') ?? '';
    if (!accept.includes('text/html')) return next();
    return c.html(readFileSync(path.join(WEB_DIST, 'index.html'), 'utf8'));
  });
}

function qbool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  return v === 'true' || v === '1' || v === 'yes';
}

/** Parse a query int; returns fallback when missing or non-numeric (avoids NaN). */
function qint(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function parseFilters(c: Context): SearchFilters {
  const q = c.req.query();
  const f: SearchFilters = {};
  if (q.network) f.network = q.network;
  if (q.family) f.family = q.family as ChainFamily;
  if (q.scheme) f.scheme = q.scheme as PaymentScheme;
  const testnet = qbool(q.testnet);
  if (testnet !== undefined) f.testnet = testnet;
  const mainnet = qbool(q.mainnet);
  if (mainnet !== undefined) f.mainnet = mainnet;
  if (q.category) f.category = q.category;
  if (q.walletCompatibility) f.walletCompatibility = q.walletCompatibility as WalletCompatibility;
  if (q.minTrust) f.minTrust = q.minTrust as TrustTier;
  if (q.maxPriceAtomic) f.maxPriceAtomic = q.maxPriceAtomic;
  const includeBroken = qbool(q.includeBroken);
  if (includeBroken !== undefined) f.includeBroken = includeBroken;
  return f;
}

// ── routes (mounted at both / and /api) ───────────────────────────────────────

const api = new Hono();

api.get('/', (c) =>
  c.json({
    service: 'PIXA Registry',
    description: 'Multichain, agent-native, verified discovery layer for machine-payable APIs.',
    version: '0.1.0',
    endpoints: {
      'GET /health': 'liveness',
      'GET /networks': 'supported networks',
      'GET /categories': 'categories with domain validators',
      'GET /stats': 'registry counts',
      'POST /services': 'submit a listing { resourceUrl, ... }',
      'GET /services': 'list listings (filters: network, family, scheme, testnet, mainnet, category, walletCompatibility, minTrust, includeBroken)',
      'GET /services/:id': 'full detail (record + probe history + reviews)',
      'POST /services/:id/verify': 're-run verification',
      'POST /services/:id/reviews': 'add a review { rating, comment?, author? }',
      'GET /search': 'ranked agent result cards (q + same filters + limit/offset)',
    },
  }),
);

api.get('/health', (c) => c.json({ status: 'ok', service: 'pixa-registry', at: new Date().toISOString() }));

api.get('/networks', (c) => c.json({ networks: listNetworks() }));

api.get('/categories', (c) => {
  const withValidators = listValidatedCategories();
  const declared = Array.from(
    new Set(listServices().map((s) => s.category).filter((x): x is string => !!x)),
  ).sort();
  return c.json({ withValidators, declared });
});

api.get('/stats', (c) => {
  const all = listServices();
  const byStatus: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  for (const s of all) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    byTier[s.scores.tier] = (byTier[s.scores.tier] ?? 0) + 1;
  }
  return c.json({ total: all.length, byStatus, byTier });
});

api.post('/services', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON.' }, 400);
  }
  const parsed = safeParseSubmission(body);
  if (!parsed.ok) return c.json({ error: 'validation_error', issues: parsed.errors }, 400);

  const verifyParam = qbool(c.req.query('verify'));
  const paidParam = qbool(c.req.query('paid')) === true;
  const result = await submitService(parsed.data, { verify: verifyParam !== false, paid: paidParam });
  return c.json(
    {
      created: result.created,
      service: result.service,
      verification: result.verification
        ? { status: result.verification.status, scores: result.verification.scores, warnings: result.verification.warnings }
        : null,
    },
    result.created ? 201 : 200,
  );
});

api.get('/services', (c) => {
  const filters = parseFilters(c);
  const limit = Math.min(500, Math.max(1, qint(c.req.query('limit'), 100)));
  const records = listFiltered(filters, limit);
  return c.json({ count: records.length, services: records });
});

api.get('/services/:id', (c) => {
  const detail = getServiceDetail(c.req.param('id'));
  if (!detail) return c.json({ error: 'not_found' }, 404);
  return c.json(detail);
});

api.post('/services/:id/verify', async (c) => {
  const id = c.req.param('id');
  const paid = qbool(c.req.query('paid')) === true;
  const summary = await reverify(id, { paid });
  if (!summary) return c.json({ error: 'not_found' }, 404);
  return c.json({ status: summary.status, scores: summary.scores, warnings: summary.warnings, probes: summary.probes });
});

api.post('/services/:id/reviews', async (c) => {
  const id = c.req.param('id');
  let body: { rating?: number; comment?: string; author?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!body || typeof body !== 'object' || typeof body.rating !== 'number' || body.rating < 1 || body.rating > 5)
    return c.json({ error: 'validation_error', message: 'rating must be a number 1..5' }, 400);
  const review = addServiceReview({ serviceId: id, rating: body.rating, comment: body.comment ?? null, author: body.author ?? null });
  if (!review) return c.json({ error: 'not_found' }, 404);
  return c.json({ review }, 201);
});

api.get('/search', (c) => {
  const query: SearchQuery = {
    q: c.req.query('q'),
    filters: parseFilters(c),
    limit: c.req.query('limit') ? qint(c.req.query('limit'), 20) : undefined,
    offset: c.req.query('offset') ? qint(c.req.query('offset'), 0) : undefined,
  };
  const results = search(query);
  return c.json({ query: query.q ?? null, count: results.length, results });
});

app.route('/api', api);
app.route('/', api);

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));
app.onError((err, c) => {
  console.error('[pixa-registry] error:', err);
  return c.json({ error: 'internal_error', message: err.message }, 500);
});
