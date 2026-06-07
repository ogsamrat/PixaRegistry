// =============================================================================
// Seeder — loads sample listings so the registry is demoable out of the box.
//
// The 4 "Pixa" listings are the REAL deployed x402 endpoints (Algorand testnet,
// USDC) — they verify live (reachable + 402 gating + chain match). The extra
// multichain entries are clearly-marked examples left unverified so we never
// fabricate a trust signal for an endpoint we don't control.
// =============================================================================

import type { ServiceSubmission } from './types.js';
import { submitService, listServices } from './registry/service.js';

const PIXA_PAYTO = 'QUQESE54Z6T7KWRNYTUGT3B2NM5HEHTP5DDR2244D5IWA66MHFGPJQINGE';
const FACILITATOR = 'https://facilitator.goplausible.xyz';
const PIXA = 'https://pixa-api.vercel.app';

const SEEDS: { submission: ServiceSubmission; verify: boolean }[] = [
  {
    verify: true,
    submission: {
      resourceUrl: `${PIXA}/producthunt/upvotes`,
      name: 'Pixa — Product Hunt Upvotes',
      description: 'Live Product Hunt upvote count, daily rank (#1–5), comment count, trending flag, and upvote velocity (last 5 min / last hour) for the Pixa launch.',
      category: 'producthunt',
      tags: ['producthunt', 'upvotes', 'launch', 'social', 'rank'],
      method: 'GET',
      paymentScheme: 'exact',
      paymentNetworks: ['algorand-testnet'],
      priceAtomic: '1000',
      priceDisplay: '$0.001 USDC',
      token: 'USDC',
      payTo: PIXA_PAYTO,
      facilitator: FACILITATOR,
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
      resourceUrl: `${PIXA}/twitter/mentions`,
      name: 'Pixa — Twitter / X Mentions',
      description: 'Twitter/X mention volume (24h), estimated impressions, sentiment score (0–1), top 5 tweets, and hour-by-hour breakdown.',
      category: 'social',
      tags: ['twitter', 'x', 'mentions', 'sentiment', 'social'],
      method: 'GET',
      paymentScheme: 'exact',
      paymentNetworks: ['algorand-testnet'],
      priceAtomic: '2000',
      priceDisplay: '$0.002 USDC',
      token: 'USDC',
      payTo: PIXA_PAYTO,
      facilitator: FACILITATOR,
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
      resourceUrl: `${PIXA}/analytics/visitors`,
      name: 'Pixa — Real-Time Visitors',
      description: 'Current active visitors, 24h pageviews, bounce rate, avg session time, top pages, and traffic source split.',
      category: 'analytics',
      tags: ['analytics', 'visitors', 'traffic', 'realtime'],
      method: 'GET',
      paymentScheme: 'exact',
      paymentNetworks: ['algorand-testnet'],
      priceAtomic: '1000',
      priceDisplay: '$0.001 USDC',
      token: 'USDC',
      payTo: PIXA_PAYTO,
      facilitator: FACILITATOR,
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
      resourceUrl: `${PIXA}/google/index-status`,
      name: 'Pixa — Google Index Status',
      description: 'Google index status, last crawl time, robots.txt state, sitemap, rich results, coverage issues, and Core Web Vitals.',
      category: 'seo',
      tags: ['google', 'seo', 'index', 'search-console', 'web-vitals'],
      method: 'GET',
      paymentScheme: 'exact',
      paymentNetworks: ['algorand-testnet'],
      priceAtomic: '3000',
      priceDisplay: '$0.003 USDC',
      token: 'USDC',
      payTo: PIXA_PAYTO,
      facilitator: FACILITATOR,
      outputSchema: {
        type: 'object',
        required: ['indexStatus'],
        properties: { indexStatus: { type: 'string' }, lastCrawledAt: { type: 'string' } },
      },
      exampleResponse: { url: 'https://getpixa.app', indexStatus: 'INDEXED', coreWebVitals: { status: 'GOOD' } },
    },
  },
  // ── multichain examples (unverified placeholders; demonstrate listings only) ──
  {
    verify: false,
    submission: {
      resourceUrl: 'https://example.com/weather/current',
      name: 'Acme Weather (example)',
      description: 'Example listing — current weather by city. Unverified placeholder to demonstrate multichain + domain-category listings.',
      category: 'weather',
      tags: ['weather', 'forecast', 'example'],
      method: 'GET',
      paymentScheme: 'exact',
      paymentNetworks: ['base-sepolia'],
      priceAtomic: '5000',
      token: 'USDC',
      outputSchema: { type: 'object', required: ['temperature', 'condition', 'location'], properties: { temperature: { type: 'number' }, condition: { type: 'string' }, location: { type: 'string' } } },
    },
  },
  {
    verify: false,
    submission: {
      resourceUrl: 'https://example.org/otp/send',
      name: 'Acme OTP (example)',
      description: 'Example listing — send a one-time passcode. Unverified placeholder on Solana to show multichain coverage.',
      category: 'otp',
      tags: ['otp', '2fa', 'verification', 'example'],
      method: 'POST',
      paymentScheme: 'exact',
      paymentNetworks: ['solana'],
      priceAtomic: '10000',
      token: 'USDC',
      inputSchema: { type: 'object', required: ['phone'], properties: { phone: { type: 'string' } } },
      exampleRequest: { phone: '+15551234567' },
      outputSchema: { type: 'object', required: ['otp', 'status'], properties: { otp: { type: 'string' }, status: { type: 'string' } } },
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
