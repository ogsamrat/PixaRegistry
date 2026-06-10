// =============================================================================
// Test seller — three real x402-gated endpoints used to prove the registry's
// full agent flow (discover -> inspect -> verify -> PAID call) end-to-end on
// Algorand testnet. Mirrors the production pixa-seller wiring: payments are
// verified + settled on-chain by the GoPlausible facilitator.
//
//   GET /weather/current?city=   $0.001  (matches the "weather" domain validator)
//   GET /otp/generate            $0.001  (matches the "otp" domain validator)
//   GET /company/lookup?domain=  $0.001  (matches the "company" domain validator)
//   GET /health                  free
// =============================================================================

import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { paymentMiddleware, x402ResourceServer, type Network } from '@x402/hono';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactAvmScheme } from '@x402/avm/exact/server';
import { ALGORAND_TESTNET_CAIP2 } from '@x402/avm';

const SELLER_ADDRESS =
  process.env.PIXA_SELLER_ADDRESS ?? 'KLCMAZ7ANYPFVDPHIDSOYUZF27M2KJCFI67IPFAKCDC34VBSXNRGLLAONQ';
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'https://facilitator.goplausible.xyz';
const PORT = Number(process.env.PIXA_TEST_SELLER_PORT ?? 4910);
const PRICE = '$0.001';

// The middleware eagerly syncs supported kinds from the facilitator at startup;
// a transient fetch failure must not crash the process (it retries per-request).
process.on('unhandledRejection', (reason) => {
  console.warn('[test-seller] Unhandled rejection (non-fatal):', reason);
});

const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR_URL })).register(
  ALGORAND_TESTNET_CAIP2 as Network,
  new ExactAvmScheme(),
);

const accepts = {
  scheme: 'exact' as const,
  network: ALGORAND_TESTNET_CAIP2 as Network,
  payTo: SELLER_ADDRESS,
  price: PRICE,
};

const routes = {
  'GET /weather/current': {
    accepts,
    description: `[PIXA Test — Weather] Price: ${PRICE} USDC per call. Returns current weather (city, tempC, conditions) for ?city=.`,
  },
  'GET /otp/generate': {
    accepts,
    description: `[PIXA Test — OTP] Price: ${PRICE} USDC per call. Returns a one-time passcode with channel and expiry.`,
  },
  'GET /company/lookup': {
    accepts,
    description: `[PIXA Test — Company Lookup] Price: ${PRICE} USDC per call. Returns company profile (name, domain, description) for ?domain=.`,
  },
};

const app = new Hono();

app.use(async (c, next) => {
  const start = Date.now();
  await next();
  const paid = c.req.header('payment-signature') || c.req.header('x-payment') ? '$' : ' ';
  console.log(`[test-seller] ${paid} ${c.req.method} ${c.req.path} -> ${c.res.status} (${Date.now() - start}ms)`);
});

app.use(paymentMiddleware(routes, resourceServer));

// ── paid endpoints (reached only after settlement) ───────────────────────────

app.get('/weather/current', (c) => {
  const city = c.req.query('city') ?? 'Bengaluru';
  const seed = [...city].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return c.json({
    city,
    tempC: 18 + (seed % 15),
    conditions: ['clear', 'partly cloudy', 'overcast', 'light rain'][seed % 4],
    humidityPct: 40 + (seed % 45),
    observedAt: new Date().toISOString(),
  });
});

app.get('/otp/generate', (c) => {
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  return c.json({
    otp,
    channel: 'api',
    ttl: 300,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  });
});

app.get('/company/lookup', (c) => {
  const domain = c.req.query('domain') ?? 'example.com';
  const name = domain.split('.')[0];
  return c.json({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    domain,
    description: `Company profile for ${domain} (test data).`,
    industry: 'software',
  });
});

// ── free ─────────────────────────────────────────────────────────────────────

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    network: ALGORAND_TESTNET_CAIP2,
    payTo: SELLER_ADDRESS,
    facilitator: FACILITATOR_URL,
    endpoints: Object.keys(routes),
  }),
);

const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[test-seller] x402 test seller on http://localhost:${PORT}`);
  console.log(`[test-seller]   payTo: ${SELLER_ADDRESS}`);
  console.log(`[test-seller]   facilitator: ${FACILITATOR_URL}`);
});
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[test-seller] port ${PORT} is already in use (set PIXA_TEST_SELLER_PORT to change it)`);
  } else {
    console.error('[test-seller] server error:', err);
  }
  process.exit(1);
});
