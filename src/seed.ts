// =============================================================================
// Seeder — loads the unified Pixa x402 API catalog so the registry is demoable
// out of the box.
//
// All listings point at the REAL deployed resource server (pixa-api.vercel.app,
// Algorand testnet, USDC) and verify live (reachable + 402 gating + chain
// match). Six serve LIVE upstream data (Open-Meteo, Frankfurter/ECB, AlgoNode,
// CSPRNG, homepage metadata); four are launch-day demos with clearly-marked
// simulated data.
// =============================================================================

import type { ServiceSubmission } from './types.js';
import { submitService, listServices } from './registry/service.js';

const PIXA_PAYTO = 'QUQESE54Z6T7KWRNYTUGT3B2NM5HEHTP5DDR2244D5IWA66MHFGPJQINGE';
const FACILITATOR = 'https://facilitator.goplausible.xyz';
const PIXA = 'https://pixa-api.vercel.app';

const COMMON = {
  method: 'GET' as const,
  paymentScheme: 'exact' as const,
  paymentNetworks: ['algorand-testnet'],
  token: 'USDC',
  payTo: PIXA_PAYTO,
  facilitator: FACILITATOR,
};

const SEEDS: { submission: ServiceSubmission; verify: boolean }[] = [
  // ── live-data endpoints ──────────────────────────────────────────────────
  {
    verify: true,
    submission: {
      ...COMMON,
      resourceUrl: `${PIXA}/weather/current`,
      name: 'Pixa — Live Weather',
      description: 'Live current weather for any city via Open-Meteo: temperature (°C), feels-like, humidity, wind speed, and human-readable conditions. Query param: city (default London).',
      category: 'weather',
      tags: ['weather', 'live', 'open-meteo', 'temperature', 'forecast'],
      priceAtomic: '1000',
      priceDisplay: '$0.001 USDC',
      inputSchema: {
        type: 'object',
        properties: { city: { type: 'string', description: 'City name to look up (query param, default: London)' } },
      },
      outputSchema: {
        type: 'object',
        required: ['city', 'tempC', 'conditions'],
        properties: {
          city: { type: 'string' }, country: { type: 'string' },
          tempC: { type: 'number' }, feelsLikeC: { type: 'number' },
          humidityPct: { type: 'number' }, windKph: { type: 'number' },
          conditions: { type: 'string' },
        },
      },
      exampleRequest: { city: 'Tokyo' },
      exampleResponse: { city: 'Tokyo', country: 'Japan', tempC: 17.3, feelsLikeC: 16.8, humidityPct: 71, windKph: 9.4, conditions: 'Overcast' },
    },
  },
  {
    verify: true,
    submission: {
      ...COMMON,
      resourceUrl: `${PIXA}/fx/rates`,
      name: 'Pixa — FX Reference Rates',
      description: 'Latest ECB foreign-exchange reference rates via Frankfurter, rebased to any currency. Query params: base (default USD), symbols (comma-separated, default all).',
      category: 'finance',
      tags: ['fx', 'forex', 'rates', 'ecb', 'currency', 'live'],
      priceAtomic: '1000',
      priceDisplay: '$0.001 USDC',
      inputSchema: {
        type: 'object',
        properties: {
          base: { type: 'string', description: 'Base currency code (query param, default: USD)' },
          symbols: { type: 'string', description: 'Comma-separated currency codes to include (default: all)' },
        },
      },
      outputSchema: {
        type: 'object',
        required: ['base', 'date', 'rates'],
        properties: { base: { type: 'string' }, date: { type: 'string' }, rates: { type: 'object' }, rateCount: { type: 'integer' } },
      },
      exampleRequest: { base: 'USD', symbols: 'EUR,GBP,INR' },
      exampleResponse: { base: 'USD', date: '2026-06-10', rates: { EUR: 0.85, GBP: 0.73, INR: 89.6 }, rateCount: 3 },
    },
  },
  {
    verify: true,
    submission: {
      ...COMMON,
      resourceUrl: `${PIXA}/algorand/account`,
      name: 'Pixa — Algorand Account Lookup',
      description: 'Live on-chain Algorand account state via AlgoNode: ALGO balance, status, opted-in ASA holdings, and current round. Query param: address (default: the seller wallet).',
      category: 'blockchain',
      tags: ['algorand', 'account', 'balance', 'on-chain', 'live'],
      priceAtomic: '1000',
      priceDisplay: '$0.001 USDC',
      inputSchema: {
        type: 'object',
        properties: { address: { type: 'string', description: 'Algorand account address (query param)' } },
      },
      outputSchema: {
        type: 'object',
        required: ['address', 'balanceAlgo', 'status'],
        properties: {
          address: { type: 'string' }, balanceAlgo: { type: 'number' }, balanceMicroAlgo: { type: 'integer' },
          status: { type: 'string' }, totalAssetsOptedIn: { type: 'integer' }, assets: { type: 'array' }, round: { type: 'integer' },
        },
      },
      exampleResponse: { address: PIXA_PAYTO, balanceAlgo: 9.998, status: 'Offline', totalAssetsOptedIn: 1, assets: [{ assetId: 10458941, amount: 3000, frozen: false }] },
    },
  },
  {
    verify: true,
    submission: {
      ...COMMON,
      resourceUrl: `${PIXA}/algorand/asset`,
      name: 'Pixa — Algorand Asset Lookup',
      description: 'Live on-chain parameters of any Algorand Standard Asset via AlgoNode: name, unit, total supply, decimals, creator, and management addresses. Query param: id (default: 10458941 = testnet USDC).',
      category: 'blockchain',
      tags: ['algorand', 'asa', 'asset', 'token', 'on-chain', 'live'],
      priceAtomic: '1000',
      priceDisplay: '$0.001 USDC',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'ASA id (query param, default: 10458941)' } },
      },
      outputSchema: {
        type: 'object',
        required: ['assetId', 'decimals', 'creator'],
        properties: {
          assetId: { type: 'integer' }, name: { type: 'string' }, unitName: { type: 'string' },
          total: { type: 'string' }, decimals: { type: 'integer' }, creator: { type: 'string' }, url: { type: 'string' },
        },
      },
      exampleRequest: { id: '10458941' },
      exampleResponse: { assetId: 10458941, name: 'USDC', unitName: 'USDC', total: '18446744073709551615', decimals: 6, creator: 'X2OZB4UYX2DAY3R6IJ4QFXGT3JLPSGE2WGCIYIIW2BWPVRVL5JJ6BKADPM' },
    },
  },
  {
    verify: true,
    submission: {
      ...COMMON,
      resourceUrl: `${PIXA}/otp/generate`,
      name: 'Pixa — OTP Generator',
      description: 'Cryptographically secure one-time passcode generated server-side (node:crypto CSPRNG), with configurable length and validity window. Query params: digits (4–10, default 6), ttl (seconds, default 300).',
      category: 'otp',
      tags: ['otp', '2fa', 'verification', 'security', 'live'],
      priceAtomic: '1000',
      priceDisplay: '$0.001 USDC',
      inputSchema: {
        type: 'object',
        properties: {
          digits: { type: 'integer', description: 'OTP length 4–10 (query param, default: 6)' },
          ttl: { type: 'integer', description: 'Validity window in seconds 30–3600 (default: 300)' },
        },
      },
      outputSchema: {
        type: 'object',
        required: ['otp', 'expiresInSeconds'],
        properties: {
          otp: { type: 'string' }, digits: { type: 'integer' },
          expiresInSeconds: { type: 'integer' }, expiresAt: { type: 'string' }, entropyBits: { type: 'integer' },
        },
      },
      exampleResponse: { otp: '482913', digits: 6, expiresInSeconds: 300, entropyBits: 20 },
    },
  },
  {
    verify: true,
    submission: {
      ...COMMON,
      resourceUrl: `${PIXA}/company/lookup`,
      name: 'Pixa — Company Lookup',
      description: 'Company / website enrichment from a live fetch of the domain\'s homepage: site name, page title, and meta description. Query param: domain (default pixawallet.xyz).',
      category: 'company',
      tags: ['company', 'enrichment', 'metadata', 'website', 'live'],
      priceAtomic: '2000',
      priceDisplay: '$0.002 USDC',
      inputSchema: {
        type: 'object',
        properties: { domain: { type: 'string', description: 'Company website domain (query param)' } },
      },
      outputSchema: {
        type: 'object',
        required: ['name', 'domain'],
        properties: {
          name: { type: 'string' }, domain: { type: 'string' }, website: { type: 'string' },
          title: { type: 'string' }, description: { type: 'string' },
        },
      },
      exampleRequest: { domain: 'pixawallet.xyz' },
      exampleResponse: { name: 'Pixa', domain: 'pixawallet.xyz', website: 'https://pixawallet.xyz', title: 'Pixa', description: 'The agentic wallet.' },
    },
  },
  // ── simulated launch-day demos (real endpoints, mocked data) ─────────────
  {
    verify: true,
    submission: {
      ...COMMON,
      resourceUrl: `${PIXA}/producthunt/upvotes`,
      name: 'Pixa — Product Hunt Upvotes (simulated)',
      description: 'Simulated Product Hunt launch metrics: upvote count, daily rank (#1–5), comment count, trending flag, and upvote velocity. Demo data — deterministic time-seeded mock.',
      category: 'producthunt',
      tags: ['producthunt', 'upvotes', 'launch', 'demo', 'simulated'],
      priceAtomic: '1000',
      priceDisplay: '$0.001 USDC',
      outputSchema: {
        type: 'object',
        required: ['upvotes', 'rank', 'trending'],
        properties: { upvotes: { type: 'integer' }, rank: { type: 'integer' }, trending: { type: 'boolean' }, commentsCount: { type: 'integer' } },
      },
      exampleResponse: { product: 'Pixa', upvotes: 347, rank: 2, commentsCount: 41, trending: true, delta: { lastHour: 38, last5Min: 7 } },
    },
  },
  {
    verify: true,
    submission: {
      ...COMMON,
      resourceUrl: `${PIXA}/twitter/mentions`,
      name: 'Pixa — Twitter / X Mentions (simulated)',
      description: 'Simulated Twitter/X mention volume (24h), estimated impressions, sentiment score (0–1), top 5 tweets, and hourly breakdown. Demo data — deterministic time-seeded mock.',
      category: 'social',
      tags: ['twitter', 'x', 'mentions', 'sentiment', 'demo', 'simulated'],
      priceAtomic: '2000',
      priceDisplay: '$0.002 USDC',
      outputSchema: {
        type: 'object',
        required: ['totalMentions', 'sentimentScore'],
        properties: { totalMentions: { type: 'integer' }, totalImpressions: { type: 'integer' }, sentimentScore: { type: 'number' } },
      },
      exampleResponse: { query: 'Pixa OR @getpixa', totalMentions: 218, totalImpressions: 87200, sentimentScore: 0.84 },
    },
  },
  {
    verify: true,
    submission: {
      ...COMMON,
      resourceUrl: `${PIXA}/analytics/visitors`,
      name: 'Pixa — Real-Time Visitors (simulated)',
      description: 'Simulated real-time site analytics: active visitors, 24h pageviews, bounce rate, avg session time, top pages, and traffic source split. Demo data — deterministic time-seeded mock.',
      category: 'analytics',
      tags: ['analytics', 'visitors', 'traffic', 'demo', 'simulated'],
      priceAtomic: '1000',
      priceDisplay: '$0.001 USDC',
      outputSchema: {
        type: 'object',
        required: ['activeVisitors'],
        properties: { activeVisitors: { type: 'integer' }, pageviews24h: { type: 'integer' }, bounceRate: { type: 'number' } },
      },
      exampleResponse: { site: 'https://getpixa.app', activeVisitors: 312, pageviews24h: 99840, bounceRate: 0.41 },
    },
  },
  {
    verify: true,
    submission: {
      ...COMMON,
      resourceUrl: `${PIXA}/google/index-status`,
      name: 'Pixa — Google Index Status (simulated)',
      description: 'Simulated Google Search Console report: index status, last crawl time, robots.txt state, sitemap, rich results, coverage issues, and Core Web Vitals. Demo data — deterministic mock.',
      category: 'seo',
      tags: ['google', 'seo', 'index', 'web-vitals', 'demo', 'simulated'],
      priceAtomic: '3000',
      priceDisplay: '$0.003 USDC',
      outputSchema: {
        type: 'object',
        required: ['indexStatus'],
        properties: { indexStatus: { type: 'string' }, lastCrawledAt: { type: 'string' } },
      },
      exampleResponse: { url: 'https://getpixa.app', indexStatus: 'INDEXED', coreWebVitals: { status: 'GOOD' } },
    },
  },
];

async function main(): Promise<void> {
  console.log(`[pixa-registry] Seeding ${SEEDS.length} listings…`);
  for (const { submission, verify } of SEEDS) {
    try {
      const r = await submitService(submission, { verify });
      const v = r.verification ? ` (status=${r.verification.status}, tier=${r.verification.scores.tier})` : ' (not verified)';
      console.log(`  ${r.created ? '+' : '~'} ${r.service.serviceId}${v}`);
      if (r.verification?.warnings.length) console.log(`      warnings: ${r.verification.warnings.join(' | ')}`);
    } catch (err) {
      console.error(`  ! failed to seed ${submission.resourceUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\n[pixa-registry] Done. ${listServices().length} listing(s) in registry.`);
}

main().catch((err) => {
  console.error('[pixa-registry] seed failed:', err);
  process.exit(1);
});
